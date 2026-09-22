# Conector NetSuite → FiscalPlatform — planejamento

> Conta NetSuite alvo: `tstdrv1647270` (TSTDRV — demo/release preview, legacy).
> Motor: FiscalPlatform (NestJS), API sob `/api/v1`, autenticação **Bearer**.
> Repositório: SuiteCloud project (SDF), `projecttype=ACCOUNTCUSTOMIZATION`.

**Documentos deste projeto**

| arquivo | o que guarda |
|---|---|
| `PLANEJAMENTO.md` | este — arquitetura, fases, aceite, riscos |
| `ARQUITETURA-COMPATIBILIDADE.md` | camada de de-para: reaproveitar os scriptids do bundle instalado |
| `MEDICOES.md` | **tudo que foi lido no fonte, com arquivo e linha** — a memória do projeto |
| `HANDOFF-FISCALPLATFORM.md` | os 8 pedidos para o lado do motor |

Nada aqui é afirmado de memória: contrato vem do Swagger, campo/scriptid vem do XML do objeto ou do
Records Browser, comportamento do motor vem do método real. `MEDICOES.md` é o registro dessas
leituras — se um fato deste plano não estiver lá com fonte, ele não foi medido.

## 0. Duas correções de abertura

**A descrição do Swagger de `POST /fiscal/emitir` está errada.** Ela afirma "Esta etapa NÃO assina
nem transmite ao autorizador". O método transmite: `emissao.service.ts:421` (`emitir`) chega em
`emissao.service.ts:2456` e chama `this.transmissao.transmitir(txId, xml)` — a única exceção é o
EPEC, que por norma não transmite (`tpEmis` 4 na chave). **O contrato real é one-shot**: rascunho →
resolve filial/modelo/série → reserva o número de forma atômica → monta → assina → transmite →
persiste protocolo. Quando a resposta volta, o número já foi consumido. Todo o desenho abaixo assume
isso; corrigir o texto do endpoint é tarefa do lado do motor.

**`Consumer-Key-Client-ID.txt` está na raiz deste repositório, com 4 segredos em claro.** Ele não era
ignorado — foi adicionado ao `.gitignore` agora. Como o TBA está descartado, o arquivo não tem função:
**apagar do disco** (e rotacionar os tokens no NetSuite, porque estiveram em claro em disco).

## 1. Sentido do tráfego e autenticação

Tráfego **sempre NetSuite → FiscalPlatform**, HTTPS, `Authorization: Bearer <token>`.

**Descartado:** `backend/src/modules/netsuite/` do FiscalPlatform (rotas `/api/v1/netsuite/:companyId/…`
e a entity `company_netsuite_config` com consumerKey/consumerSecret/tokenId/tokenSecret). Com ele
morre o caminho OAuth 1.0a TBA em que o motor puxaria dados do NetSuite. Nada no bundle assina
requisição TBA.

Token:

| item | medido em |
|---|---|
| `POST /api/v1/oauth/token`, `grant_type=client_credentials` | `oauth.controller.ts` |
| body: `client_id`, `client_secret`, `scope` | `oauth.dto.ts:40` (`TokenRequestDto`) |
| resposta: `access_token`, `token_type`, `expires_in`, `scope` | `oauth.dto.ts:59` |
| escopos válidos: `fiscal:read`, `fiscal:write`, `nfe:emit` | `oauth.service.ts:16` |
| TTL default 3600 s, configurável por client (`tokenTtl`) | `oauth.dto.ts:26` |

Escopo do bundle: **`fiscal:read nfe:emit`**. `fiscal:write` é edição de régua — o bundle não escreve
régua, então pedir esse escopo seria conceder poder que a fronteira proíbe usar.

No NetSuite:

- `client_id` e `client_secret` em **Secrets Management** (Setup > Company > Secrets), injetados por
  `https.createSecureString({ input: "{$secret_id}" })`. O valor nunca é legível pelo script, o que é
  exatamente o que se quer: nem log nem exceção conseguem vazá-lo.
- `access_token` em **`N/cache`**, escopo `PROTECTED`, TTL = `expires_in − 300`. Renovação preguiçosa:
  cache miss ou `401` do motor dispara um único refresh. Sem isso, cada linha de um Map/Reduce
  pediria token novo.
- O token **também não vai para log**. O log de payload é obrigatório (§5), o header não entra nele.

## 2. A fronteira, aplicada a este repositório

O bundle **traduz e transporta**. Não classifica, não calcula, não numera.

Fica **proibido em SuiteScript**: CST, CSOSN, cClassTrib, alíquota, MVA, cBenef, redução de base,
fórmula de base, derivação de regime, tabela por UF, decisão crédito × custo. Se aparecer uma
comparação literal de CST ou um mapa de alíquota por UF, é régua do motor duplicada — e régua
duplicada diverge em silêncio na primeira mudança de convênio.

O NetSuite declara, legitimamente:

1. **identidade da operação** — filial, destinatário, itens, quantidade, valor, frete, seguro,
   desconto, pagamento, documento referenciado;
2. **natureza de operação** — o dado que só o ERP tem, porque quem abriu o pedido decidiu
   insumo × revenda × ativo × uso e consumo;
3. **override por tributo** (`linhas[].impostos[]`) só com motivo declarado (valor de terceiro
   destacado, imposto já apurado no ERP). Sem motivo, o motor calcula — esse é o default correto.
   Override é **por tributo, não interruptor**: sobrepõe o homônimo e o motor segue calculando os
   outros.

E o NetSuite **não recalcula para conferir**. Divergência entre ERP e motor investiga-se no
**payload**, não na régua.

## 3. Arquitetura decidida

| frente | onde roda | por quê |
|---|---|---|
| **`/fiscal/simular`** — preview de tributo | **User Event, `beforeSubmit`** | é o único ponto em que se grava campo na transação sem um segundo submit |
| **`/fiscal/emitir`** + carta de correção + cancelamento + inutilização + evento da Reforma + consulta/reconciliação | **Suitelet** (botão injetado por User Event `beforeLoad`) | consome numeração e é irreversível: tem de ser ato deliberado, nunca efeito colateral de um save |
| **entrada** — documento capturado + `POST /transacoes/reclassificar` | **Map/Reduce** | é lote por natureza (competência inteira de notas de terceiro), e volume alto |

### 3.1 O furo do `beforeSubmit`, e como fechá-lo

A escolha tem razão real (gravar sem segundo submit), mas põe **latência de rede externa dentro do
save do usuário**, e a nota grande é justamente a do cliente que reclama. Cinco guardas, todas
obrigatórias:

1. **Nunca derrubar o save.** Todo o bloco em `try/catch`. Falha de rede, `5xx`, timeout → grava
   `custbody_fp_sim_status = INDISPONIVEL` + o motivo, e **deixa passar**. Simulação é conveniência;
   impedir o usuário de salvar um pedido porque o motor caiu é trocar um problema por um pior.
2. ⚠ **Não existe timeout configurável — esta guarda, como eu a havia escrito, é impossível.**
   MEDIDO: `N/https` não tem parâmetro de timeout; os limites são fixos da plataforma — **5 s para
   negociar a conexão, 45 s para a requisição**, estouro em `SSS_REQUEST_TIME_EXCEEDED`. (O
   `options.timeout` que existe na referência é do `N/documentCapture`.) Motor **inalcançável**
   bloqueia o save por ~5 s, tolerável; motor **lento a responder** pode bloquear **45 s**, e não
   há como encurtar. Risco declarado, não mitigado — o que sobra de mitigação real é a guarda 4.
3. **Guarda de contexto** por `runtime.executionContext`: roda em `USERINTERFACE` e
   `WEBSERVICES`/`RESTLET`; **não** roda em `CSVIMPORT`, `SCHEDULED`, `MAPREDUCE`, `WORKFLOW`,
   `BUNDLEINSTALLATION`. Sem isso, uma carga de 5.000 pedidos por CSV faz 5.000 chamadas externas e
   estoura tudo — e as gravações do próprio bundle (Suitelet e Map/Reduce) reentrariam no simulador.
4. **Short-circuit por mudança relevante.** Compara `context.oldRecord` × `context.newRecord`: se não
   mudou item, quantidade, valor, desconto, frete, destinatário, subsidiária ou natureza declarada,
   não chama. Save de campo de texto não paga chamada de rede.
5. **`/simular`, jamais `/emitir`.** Mesmo motor, devolve `linhas[].impostos[]` com CST resolvido e
   **não consome numeração** — e é por isso que ele pode morar num caminho que roda a cada save.

> Dependência do lado do motor: `POST /fiscal/simular` está com `@ApiExcludeEndpoint()`
> (`fiscal.controller.ts:46`) — fora do Swagger do ERP. Se o bundle vai consumi-lo, ele precisa entrar
> no contrato publicado. Pedido registrado em `HANDOFF-FISCALPLATFORM.md`.

### 3.1.1 Resposta síncrona ao usuário (`fp_msg.js`)

`beforeSubmit` não tem tela — não existe `form` ali, e o `beforeLoad` que tem tela roda **antes**, no
load do formulário. O mecanismo que resolve isso é o mesmo do `AVLR_SuiteTax_UE`, e está implementado
em `fp_msg.js`:

1. **primeira linha do `beforeSubmit`:** gera um id de correlação e grava **no próprio registro**
   (`custbody_fp_corrid`), que viaja com o save;
2. o resultado da chamada vai para a **sessão do usuário**, na chave `<canal><corrid>`;
3. o save termina, o NetSuite **re-renderiza** o registro e dispara `beforeLoad` — que agora tem
   `form`, lê o corrid **do registro** e pinta `form.addPageInitMessage()`;
4. a chave é **zerada** depois de pintar: a mensagem aparece uma vez e não cola no registro.

Precedência de pintura: **erro** (leva os avisos junto) > **aviso** > **sucesso**. Nunca dois
`addPageInitMessage` — o segundo cobre o primeiro e o usuário lê o menos importante.

O que vem do AVLR sem mudança, porque é a melhor parte dele: **a origem no cabeçalho da mensagem**.
`MENSAGEM DO FISCALPLATFORM` = o motor recusou (quase sempre cadastro) · `MENSAGEM DO NETSUITE` = o
nosso código quebrou antes de o motor opinar. Sem isso, "deu erro no fiscal" manda o usuário abrir
chamado para o lado errado — e a segunda hipótese é a mais frequente.

Três divergências deliberadas, cada uma com motivo no docblock de `fp_msg.js`:

- **`garantirCorrId()` recupera o id do registro no caminho de exceção.** No AVLR o `catch` usa a
  variável local `_randomString`, que fica `undefined` se a exceção subiu antes do `setControlString`
  — a chave vira `errorresponseundefined`, o renderizador procura outra, e **o erro é engolido em
  silêncio**. É justamente o caminho que mais precisa de mensagem.
- **TTL de 120 s no envelope da sessão**, para que uma chave que nunca foi pintada (usuário deu
  "voltar" no navegador) não reapareça num load futuro como se fosse de agora.
- **`escaparHtml` no dado interpolado.** A mensagem é HTML e carrega nome de destinatário e texto de
  cadastro. Nosso markup fica; o dado é escapado. O texto do motor não é alterado de outra forma —
  `cStat` e `xMotivo` vão **inteiros**, sem traduzir nem resumir.

### 3.2 Módulos SuiteScript

`src/FileCabinet/SuiteScripts/FiscalPlatform/`

| arquivo | responsabilidade | regra |
|---|---|---|
| `fp_client.js` | transporte: token, `N/https`, timeout, retry com backoff, correlação de log | **único** lugar do bundle que sabe o que é HTTP |
| `fp_config.js` | leitura da régua de ambiente: base URL, mapa subsidiária ↔ CNPJ da filial, secret id | zero comparação literal de subsidiária — vem de custom record |
| `fp_map_emitir.js` | transação NetSuite → `EmitirNotaDto` | **whitelist**: campo não montado aqui não chega ao motor |
| `fp_map_simular.js` | transação → `SimulacaoNotaInputDto` (o mesmo mapa, sem série/tipo) | reaproveita `fp_map_emitir` |
| `fp_map_reclassificar.js` | recebimento/fatura de compra → `ReclassificarDto` | endereça por **chave de acesso** |
| `fp_persist.js` | grava chave, protocolo, status, cStat, xMotivo, UUID; XML e DANFE no File Cabinet | grava **assim que chega**, antes de qualquer passo seguinte |
| `fp_msg.js` | resposta síncrona ao usuário: id de correlação, sessão, `addPageInitMessage` | **escrito** — §3.1.1 |
| `fp_fields.js` | nome lógico → scriptid, por perfil do bundle instalado | **escrito** — `ARQUITETURA-COMPATIBILIDADE.md` |
| `perfis/fp_perfil_*.json` | o de-para em si (`original`, `oracle_ei`) | **escritos** |
| `fp_ue_simular.js` | User Event `beforeSubmit` (§3.1) + `beforeLoad` que pinta a mensagem | **escrito** — as 5 guardas |
| `fp_sl_emissao.js` | Suitelet: emitir, cancelar, CC-e, inutilizar, evento da Reforma, consultar, reconciliar | ação explícita, com confirmação no que consome numeração |
| `fp_mr_entrada.js` | Map/Reduce: `GET /transacoes` → declara natureza por `POST /transacoes/reclassificar` | idempotente por chave |

### 3.3 Objetos SDF a criar

O `src/` hoje tem só `manifest.xml` e `deploy.xml`. Faltam `Objects/`, `FileCabinet/` e
`AccountConfiguration/`.

**Custom records**

- `customrecord_fp_config` — uma linha por subsidiária: CNPJ da filial no motor, `branchId` (UUID),
  ambiente (homologação/produção), base URL, secret id, série por tipo de documento, ativo.
  *É aqui que vive o mapeamento subsidiária ↔ filial. Nunca em código.*
- `customrecord_fp_doc` — o rastro fiscal por transação: transação, `idExterno`, UUID do documento no
  motor, tipo, série, número, chave (44), status, `cStat`, `xMotivo`, protocolo, arquivo XML, arquivo
  DANFE, tentativa, documento que substituiu / foi substituído por.
- `customrecord_fp_log` — endpoint, método, **payload enviado**, corpo da resposta, HTTP status,
  duração, usuário, id de correlação. **Sem header, sem token.**

**Campos de transação** (os que se consultam e se filtram ficam na própria transação; o histórico
completo fica no `customrecord_fp_doc`)

`custbody_fp_chave` · `custbody_fp_status` · `custbody_fp_cstat` · `custbody_fp_xmotivo` ·
`custbody_fp_protocolo` · `custbody_fp_uuid` · `custbody_fp_idexterno` · `custbody_fp_danfe` ·
`custbody_fp_natureza` (natureza declarada — *list/record* alimentada do vocabulário do motor) ·
`custbody_fp_sim_status` · `custbody_fp_sim_resumo` · `custbody_fp_sim_payload` (o payload enviado) ·
`custbody_fp_corrid` (id de correlação — §3.1.1).

Dois desses têm exigência de tipo, não só de nome:

- **`custbody_fp_corrid`** — *Free-Form Text*, 40+, **oculto** no formulário e **não** vazio por
  padrão. O mecanismo do §3.1.1 inteiro depende dele estar gravável no `beforeSubmit` e legível no
  `beforeLoad`, em todos os tipos de transação da lista de `fp_ue_simular.js`. Campo que não existe
  num tipo faz a mensagem simplesmente não aparecer naquele tipo — falha silenciosa, e é por isso
  que `fp_msg.garantirCorrId` registra no log quando não consegue ler.
- **`custbody_fp_sim_payload`** — *Long Text*. O payload de uma nota de 200 linhas não cabe em
  Free-Form Text, e truncar o payload destrói exatamente a prova que ele existe para dar.

### 3.4 Camada de compatibilidade — **frente diferida**, mas a política vale desde já

⚠ Reaproveitar os ids de bundle de terceiro é **outra frente** (decisão do Rogerio, 04/09/2026): o
cenário será replicar os componentes com os mesmos scriptids, **desligar todos os scripts** do bundle
antigo e instalar o nosso com merge dos componentes. **Nenhum perfil de terceiro é ativado nesta
etapa.** Detalhes em `ARQUITETURA-COMPATIBILIDADE.md`.

O que vale **agora**, e é o que muda o desenho de tudo acima:

**Nenhum módulo do bundle escreve scriptid literal.** Todos resolvem por `fp_fields.js`, que aplica
três camadas de origem, nesta ordem: **nativo do NetSuite** → **scriptid do SuiteApp instalado** →
**scriptid nosso**.

E isso não é preferência, é medição. O bundle 436209 (Electronic Invoicing) foi aberto e inventariado
(`MEDICOES.md` §3): **o NetSuite não tem campo nativo de NF-e** — a própria Oracle teve de criar
`custbody_fiscal_doc_number`, `custbody_operation_nature`, `custbody_psg_ei_status`,
`custbody_icms_total`. Se houvesse nativo, ela teria usado. Logo **"usar o máximo de standard" e
"reaproveitar os ids do bundle instalado" são a mesma política em duas camadas**.

O motivo de negócio: quando o cliente troca o bundle da Oracle pelo nosso, o que dói não é o dado —
é tudo que **aponta** para os ids antigos (saved search, relatório, formulário, workflow, CSV import
salvo, integração de terceiro). Mesmo scriptid = acervo intacto.

Três coisas que o documento detalha e que **não** são opcionais:

- **o de-para preserva os ids, não os dados.** Desinstalar bundle apaga os campos dele e o conteúdo.
  Histórico é projeto separado;
- **`somenteLeitura`**: campo do outro bundle que o outro bundle ainda escreve é somente-leitura
  para nós — campo em disputa perde dado, e quem ganha depende de ordem de User Event;
- **mapa de valor**, não só de campo. Gravar a nossa string `'AUTORIZADA'` num List/Record dele
  **grava e não reclama**, e a saved search do cliente não acha nada.

## 4. Endpoints consumidos (medidos no fonte)

| endpoint | quem chama | observação |
|---|---|---|
| `POST /oauth/token` | `fp_client` | client_credentials |
| `POST /fiscal/simular` | UE `beforeSubmit` | não consome numeração · hoje `@ApiExcludeEndpoint` |
| `GET /fiscal/cadastro/{branchId}/{uf}` | Suitelet, **antes** de emitir | CadConsultaCadastro4, read-only. Rejeições 209/210 chegam **depois** do número reservado, e número gasto não volta |
| `GET /fiscal/emitir/status-sefaz` | Suitelet | `cStat` 107 = em operação; cache de 60 s por filial |
| `POST /fiscal/emitir` | Suitelet | one-shot: número + assina + transmite |
| `POST /fiscal/emitir/{id}/consultar` | Suitelet + job | rede de segurança para `PROCESSANDO` |
| `POST /fiscal/nfe/{chave}/reconciliar` | Suitelet + job | resolve nota em limbo pela chave |
| `GET /fiscal/emitir/{id}/xml` · `/danfe` | `fp_persist` | vão para File Cabinet |
| `POST /fiscal/emitir/{id}/carta-correcao` | Suitelet | `nSeqEvento` é do motor, não se informa |
| `POST /fiscal/emitir/{id}/cancelar` | Suitelet | justificativa 15–255 |
| `POST /fiscal/emitir/{id}/inutilizar` | Suitelet | fecha o número preso numa rejeitada |
| `POST /fiscal/emitir/{id}/evento-reforma` | Suitelet | fase 4 |
| `GET /transacoes` | Map/Reduce | filtros: `branchId`, `status`, `entradaSaida`, `chave`, `dataDe`, `dataAte`, `page`, `limit` |
| `POST /transacoes/reclassificar` | Map/Reduce | endereça por **chave**, não por id |

Os endpoints por `{id}` usam o **UUID do documento no motor** — que vem na resposta do `/emitir`,
por isso ele é persistido em `custbody_fp_uuid`. O `reclassificar` usa a **chave de acesso**, porque
na entrada o ERP nunca viu o id do motor.

## 5. Invariantes que o código tem de honrar

**Idempotência por `idExterno`, único por filial.** Derivado de identidade **estável** da transação —
`{tipo}-{internalid}`, por exemplo `INV-14872` — nunca de tentativa nem de timestamp. Retry **reusa**
a chave. E a armadilha: reenviar o mesmo `idExterno` **devolve a nota anterior, inclusive rejeitada**.
Logo o fluxo de correção é explícito: rejeição → corrige cadastro → **`idExterno` novo**, com o
`customrecord_fp_doc` gravando qual documento substituiu qual. Sem isso, "corrigi e reenviei" devolve
a mesma rejeição para sempre.

**Persistir cada avanço antes de prosseguir.** Chave e protocolo gravados no instante em que chegam.
Autorização não se perde porque a gravação seguinte falhou.

**Guardar o payload enviado junto do retorno.** Sem ele, "o motor errou" e "eu mandei errado" são
indistinguíveis — e a segunda é a hipótese mais frequente.

**Propagar a rejeição inteira.** `cStat` + `xMotivo` literais, sem traduzir nem resumir. Rejeição é
quase sempre cadastro, e quem opera precisa do texto da SEFAZ, não da nossa interpretação.

**Retry com backoff, e nunca cego em cima de emissão.** Motor e SEFAZ são síncronos; retry sem
backoff multiplica carga exatamente quando algo já está degradado. Timeout sem resposta **não** é
retry de `/emitir` — é `reconciliar` pela chave.

**Precedência na declaração de natureza** (entrada): **linha declarada > cabeçalho declarado >
resolvedor de CFOP do motor**. Cabeçalho declarado **não** silencia o resolvedor nas linhas que
calaram. **O body substitui, não incrementa**: havendo declaração, ela é a declaração inteira do
documento. Se a natureza for informada por UUID, **caixa importa** — o outro lado normaliza em
minúscula e maiúscula não casa nunca, com falha silenciosa (junção que não acha, não erro). Preferir
**código** (`COMPRA`, `COMPRA_ATIVO`) a UUID.

**Objeto criado na UI tem de ser importado para o projeto** (`object:import`), senão o próximo deploy
o sobrescreve.

## 6. Entregas, em ordem, com aceite medível na fronteira

Cada fase fecha com aceite verificável **no payload que sai e na resposta que volta** — não em
variável interna.

### Fase 0 — fundação e conectividade
Estrutura do SDF (`Objects/`, `FileCabinet/`), `customrecord_fp_config`, `customrecord_fp_log`,
`fp_config.js`, `fp_client.js` com token + cache + backoff, Secrets Management configurado.
**Aceite:** um Suitelet de diagnóstico obtém token, chama `GET /fiscal/emitir/status-sefaz` da filial
piloto e devolve `cStat 107`; o `customrecord_fp_log` tem a chamada registrada **sem** o header
`Authorization`.

### Fase 1 — simulação no `beforeSubmit`
`fp_map_simular.js` (falta), `fp_ue_simular.js` (escrito), `fp_msg.js` (escrito), campos
`custbody_fp_sim_*` + `custbody_fp_corrid`.
**Aceite:** salvar um Invoice de 3 linhas grava resumo de tributo por linha **e mostra
`CONFIRMATION` na tela do registro salvo**; um destinatário sem IE devolve `ERROR` com o texto
**literal** do motor sob o cabeçalho `MENSAGEM DO FISCALPLATFORM`; **derrubar o motor e salvar de
novo conclui o save** com `sim_status = INDISPONIVEL` e `ERROR` sob `MENSAGEM DO NETSUITE`; recarregar
a página **não repinta** a mensagem (a chave de sessão foi zerada); importar 50 pedidos por CSV faz
**zero** chamadas ao motor (contadas no `customrecord_fp_log`).

### Fase 2 — emissão de NF-e de saída
`fp_map_emitir.js`, `fp_sl_emissao.js` (emitir + consultar + reconciliar), `fp_persist.js`,
`customrecord_fp_doc`, botão na transação.
**Aceite:** um Invoice emite em **homologação** e a transação fica com chave de 44 dígitos,
`cStat 100`, protocolo, XML e DANFE no File Cabinet; reenviar o mesmo botão **não gera número novo**
(idempotência); uma nota com destinatário sem IE é **barrada por `/fiscal/cadastro`** antes de reservar
número; uma rejeição chega ao usuário com o `xMotivo` literal da SEFAZ.

### Fase 3 — eventos do documento emitido
Cancelamento, carta de correção, inutilização do número preso, download de XML de evento.
**Aceite:** cancelar grava `CANCELADA` + XML do evento; CC-e grava o `nSeqEvento` devolvido pelo
motor; inutilizar um número de nota rejeitada fecha a lacuna com `cStat 102`.

### Fase 4 — entrada: declaração de natureza em lote
`fp_mr_entrada.js` (Map/Reduce), `fp_map_reclassificar.js`, campo de natureza no item/pedido de compra.
**Aceite:** o Map/Reduce lê `GET /transacoes?entradaSaida=E&dataDe=…&dataAte=…` paginado, declara
natureza por linha via `POST /transacoes/reclassificar` e o retorno do `GET /transacoes/chave/{chave}`
mostra a natureza declarada; rodar duas vezes **não muda nada na segunda** (idempotente); um item sem
natureza no ERP **não é declarado** (o resolvedor de CFOP do motor decide) em vez de receber um chute.

### Fase 5 — reflexo contábil e valor fiscal no NetSuite
**Depende de medição** (§7): a conta usa SuiteTax ou tributo legado? O caminho muda inteiro.
- **Sem SuiteTax:** valores em campos/custom record + lançamento pela natureza contábil que **o motor
  devolveu** (crédito × custo × débito). A natureza contábil não se re-deriva no ERP.
- **Com SuiteTax:** os valores entram pelo caminho de *tax detail*, e chamada HTTP **não cabe** ali —
  o padrão é `/simular` persistido (Fase 1 ou Map/Reduce) e o caminho de tax lendo o **resultado
  persistido**.

## 7. Medições pendentes

**Bloqueiam a Fase 5, e só ela.** As fases 0–4 seguem sem elas:

1. **A conta `tstdrv1647270` tem SuiteTax habilitado?** E quais SuiteApps de localização Brasil estão
   instalados, em que versão? (versão de SuiteApp muda comportamento sem deploy nosso).
2. **Subsidiárias existentes e o CNPJ de cada uma**, e se a filial correspondente existe do lado do
   motor (`branches` + `companies`) — é o que popula `customrecord_fp_config`.
3. **Nome real de campo e scriptid** de tudo que já exista de fiscal nessa conta legacy: vem do XML do
   objeto ou de Record Types, nunca de memória.

**Bloqueia a Fase 0:**

4. **URL pública HTTPS do FiscalPlatform** com certificado válido de CA reconhecida. Hoje o motor sobe
   em `localhost:3000` (`main.ts`) — o NetSuite não alcança localhost e **não aceita certificado
   autoassinado**. Sem isso a Fase 0 não roda.
5. **Client OAuth registrado** para o bundle (`POST /oauth/clients`, escopos `fiscal:read nfe:emit`),
   e o `client_id`/`client_secret` resultante gravados em Secrets Management.

## 8. Riscos

| risco | mitigação |
|---|---|
| latência do motor dentro do save (§3.1) | timeout curto + `try/catch` que nunca derruba o save + short-circuit por mudança relevante |
| numeração queimada em investigação | `/simular` para investigar, **sempre**. Uma investigação por `/emitir` já queima sete números |
| `idExterno` reenviado devolvendo rejeição antiga | fluxo de correção com `idExterno` novo e rastro de substituição, desenhado na Fase 2 |
| conta legacy sem a localização esperada | medição §7.1 **antes** da Fase 5; fases 0–4 não dependem dela |
| governança em Map/Reduce de entrada | paginação de `GET /transacoes` + `reclassificar` por chave no `map`, um documento por unidade de trabalho |
| objeto criado na UI e não importado | `object:import` obrigatório no fim de cada fase; `project:validate --server` antes de todo deploy |
| régua vazando para o ERP | revisão de cada PR contra a lista de proibidos do §2 |
