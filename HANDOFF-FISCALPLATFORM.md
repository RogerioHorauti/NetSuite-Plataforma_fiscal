# Handoff → agente do FiscalPlatform

Pedidos do bundle NetSuite para o lado do motor, levantados no planejamento do conector
(`PLANEJAMENTO.md`). Repositório alvo: `C:\Users\TI\Documents\GitHub\fiscal-platform`.

Contexto de uma linha: o conector NetSuite fala **só HTTPS com Bearer**, sentido **NetSuite →
FiscalPlatform**. O caminho OAuth 1.0a TBA (motor puxando do NetSuite) está **descartado**.

Cada item tem **o que**, **onde**, **por que** e **como conferir**. Os itens 1–3 são bloqueantes para
a Fase 0 do bundle; 4–8 são de contrato e destravam as fases 1–4.

---

## 1. BLOQUEANTE — expor a API em HTTPS público com certificado de CA reconhecida

**O que:** publicar a API num host HTTPS alcançável da internet, com certificado emitido por CA
pública (Let's Encrypt serve).

**Onde:** deploy / reverse proxy. `backend/src/main.ts` hoje sobe em `PORT` default `3000`, sem TLS.

**Por que:** o NetSuite faz a chamada de saída e **não alcança `localhost`**. Ele também **rejeita
certificado autoassinado** e certificado com cadeia incompleta — `N/https` falha com erro de SSL, sem
opção de desabilitar a verificação. Não há como o bundle contornar isso do lado dele.

Dois detalhes que costumam morder:

- **Cadeia intermediária completa** no chain servido. O NetSuite não completa cadeia sozinho.
- **Sem allowlist de IP de origem**, ou com os *outbound IP ranges* do NetSuite liberados. Os IPs de
  saída são publicados pela Oracle e mudam entre datacenters — allowlist estreita quebra em
  janela de manutenção sem aviso.

**Como conferir:** `curl.exe -v https://<host>/api/v1/fiscal/emitir/status-sefaz?branchId=<uuid>`
de fora da rede, com `-H "Authorization: Bearer <token>"`, retornando `cStat 107` e **sem** flag de
insegurança.

---

## 2. BLOQUEANTE — registrar o client OAuth do bundle

**O que:** criar um client `client_credentials` para o conector NetSuite e entregar `client_id` e
`client_secret`.

**Onde:** `POST /api/v1/oauth/clients` (protegido por `JwtAuthGuard` —
`modules/oauth/oauth.controller.ts`). DTO em `modules/oauth/oauth.dto.ts:9` (`RegisterClientDto`).

**Body pedido:**

```json
{
  "clientName": "NetSuite tstdrv1647270",
  "companyId": "<uuid da company do piloto>",
  "scopes": "fiscal:read nfe:emit",
  "grantType": "client_credentials",
  "tokenTtl": 3600,
  "descricao": "Conector SDF NetSuite -> FiscalPlatform"
}
```

**Por que esses escopos e não mais:** `fiscal:write` é edição de régua
(`modules/oauth/oauth.service.ts:16-19`). O bundle **não escreve régua** — a fronteira do projeto
proíbe. Conceder o escopo seria dar um poder que o código está proibido de usar, e escopo concedido é
escopo que um dia alguém usa.

**Como conferir:** `POST /api/v1/oauth/token` com o par devolvido retorna `access_token`,
`expires_in` e `scope = "fiscal:read nfe:emit"`.

**Entrega do segredo:** o `client_secret` vai para o **Secrets Management do NetSuite** (Setup >
Company > Secrets). **Não** por arquivo no repositório, **não** por custom record, **não** em log.

---

## 3. BLOQUEANTE (de contrato) — publicar `POST /fiscal/simular-nota` no Swagger do ERP

**O que:** remover o `@ApiExcludeEndpoint()` de `simular-nota`.

**Onde:** `backend/src/modules/fiscal/fiscal.controller.ts:45-46`.

**Por que:** o conector chama `simular-nota` no `beforeSubmit` do User Event — é o preview de tributo
na transação do NetSuite, e é o **único** caminho de investigação que não consome numeração. Pelo
próprio critério escrito em `main.ts` ("entra o que o ERP DIRIGE: mandar documento, consultar o que
emitiu"), ele **qualifica**: o ERP manda o documento e recebe o resultado. Não é consulta de régua —
não é `fiscal/referencia`, não devolve tabela para o ERP construir cálculo.

Hoje, um integrador que ler o Swagger publicado não descobre que existe um jeito de conferir tributo
sem emitir — e a alternativa que ele acha é `/emitir`. **Endpoint de investigação escondido empurra
investigação para o endpoint que queima número.**

**Como conferir:** `simular-nota` aparece em `/docs`, e o `/docs/obrigacoes` segue sem ele.

---

## 4. Descrição errada em `POST /fiscal/emitir` — ela nega que transmite

**O que:** corrigir o `description` do `@ApiOperation`.

**Onde:** `backend/src/modules/fiscal/emissao/emissao.controller.ts`, rota `@Post('emitir')`.

**O texto atual afirma:**

> "O QUE ACONTECE AQUI: resolve filial → modelo → série, reserva o número de forma atômica e persiste
> o documento (cabeçalho, linhas e impostos) em RASCUNHO. **Esta etapa NÃO assina nem transmite ao
> autorizador — SEFAZ ou Prefeitura.**"

**O código transmite.** `EmissaoService.emitir` (`emissao.service.ts:421`) desce até
`emissao.service.ts:2456`:

```ts
if (tx.chaveAcesso?.charAt(POS_TP_EMIS_NA_CHAVE) !== TP_EMIS_EPEC) {
  await this.transmissao.transmitir(txId, xml);
}
```

A única saída sem transmissão é o **EPEC**, e por razão normativa (não há autorizador disponível — o
comentário no fonte explica). No caminho normal: rascunho → número atômico → monta → assina →
transmite → persiste protocolo, **numa chamada**.

**Por que isso importa mais do que um texto errado:** o integrador que lê a descrição atual desenha um
fluxo de duas etapas e conclui que pode chamar `/emitir` para "ver o que sai" — e descobre depois que
gastou número. A descrição errada aponta para o comportamento perigoso. Foi por acreditar nela que o
planejamento do bundle quase desenhou um passo de "transmitir" que não existe.

**Como conferir:** a descrição publicada diz que o endpoint transmite e que o número é consumido na
resposta; menciona o EPEC como a exceção; e aponta `simular-nota` (item 3) como o caminho para
conferir sem emitir.

---

## 5. O retorno idempotente do `/emitir` não se distingue de uma emissão nova

**O que:** sinalizar no corpo da resposta que o documento foi **devolvido**, não criado — um campo
como `jaEmitido: true`.

**Onde:** `emissao.service.ts:605` (o retorno antecipado por `idExterno` já existente) e o tipo
`TransactionComLinks` (`emissao.service.ts:115`).

**Por que:** a idempotência por `idExterno` é a espinha do retry do bundle, e ela **devolve a nota
anterior inclusive quando ela foi rejeitada**. Hoje o bundle não tem como saber, pela resposta, se
acabou de emitir ou se recebeu o replay de uma tentativa antiga:

- `avisos` não serve — o próprio docblock de `TransactionComLinks` diz que a devolução idempotente
  **não roda o pré-passo**, então o campo vem `undefined`, que significa "não avaliei", não "é replay".
- `status` não serve: `AUTORIZADA` é o valor esperado nos dois casos.

Sem o sinal, o bundle tem duas opções ruins: gravar "emitido agora" em cima de um replay (e perder o
rastro de quantas tentativas houve), ou consultar antes de cada emissão (uma chamada extra em todo
save). O precedente já existe no próprio motor: o evento da Reforma devolve `jaRegistrado=true`
(`@Post('emitir/:id/evento-reforma')`). **É o mesmo problema, e a solução já foi escolhida uma vez.**

**Como conferir:** dois `POST /fiscal/emitir` com o mesmo `idExterno` — o primeiro retorna sem o
campo (ou `false`), o segundo com `jaEmitido: true` e o mesmo `numero`.

---

## 6. Endpoints que o bundle consome e que estão fora do Swagger

Três rotas com `@ApiExcludeEndpoint()` que o conector precisa. Nenhuma é régua nem maquinário de
plataforma — todas são "o ERP consultando o que emitiu", que é o critério de inclusão do `main.ts`:

| rota | onde | para que o bundle usa |
|---|---|---|
| `GET /fiscal/emitir/{id}/xml` | `emissao.controller.ts` | guardar o **nfeProc** no File Cabinet — é o documento fiscal válido, o que se guarda pelos 5 anos e se entrega ao destinatário |
| `POST /fiscal/emitir/{id}/consultar` | `emissao.controller.ts` | rede de segurança quando a resposta não chega e a nota fica `PROCESSANDO` |
| `GET /transacoes/chave/{chave}` | `transacoes.controller.ts:254` | conferir a natureza declarada depois do `reclassificar` (é o aceite da Fase 4 do bundle) |

**Pedido:** publicar as três, ou dizer qual é o caminho publicado equivalente.

**Bônus (comentário desatualizado):** o docblock do `main.ts` afirma que do `TransacoesModule`
"só o `GET /transacoes/chave/{chave}` fica visível" — mas essa rota está justamente com
`@ApiExcludeEndpoint()` (`transacoes.controller.ts:255`). O comentário descreve o oposto do código.

---

## 7. Remover o módulo `netsuite` (TBA) — decisão de arquitetura, e há segredo em tabela

**O que:** remover o caminho OAuth 1.0a TBA em que o motor puxaria dados do NetSuite.

**Onde:**

- `backend/src/modules/netsuite/` — `netsuite.controller.ts`, `netsuite.service.ts`,
  `netsuite.module.ts`, `netsuite-config.entity.ts`
- `backend/src/app.module.ts` — import e entrada `NetsuiteModule` no `imports`
- `package.json` — a dependência `oauth-1.0a`. **Medido:** ela não é importada em lugar nenhum de
  `src/` — o `netsuite.service.ts` monta o header OAuth 1.0a à mão (linhas 25-45). É dependência
  declarada e nunca usada, removível independentemente do resto deste item.
- tabela `company_netsuite_config`

**Por que:** o sentido do tráfego é NetSuite → FiscalPlatform. O ERP dirige: manda documento, recebe
resultado. Nada no conector assina requisição TBA, e nada no motor precisa chamar o NetSuite.

**O lado incômodo, e a razão de o item existir:** a entity guarda `consumer_secret` e `token_secret`
como colunas comuns `varchar(500)` — **sem criptografia**, ao contrário do certificado, que passa por
`descriptografar` (`modules/certificate/crypto.util`). São credenciais de conta de ERP em claro no
Postgres, num caminho que ninguém vai mais usar. Código morto é dívida; código morto que guarda
segredo em claro é exposição.

**Cuidado — isto é destrutivo e é decisão do Rogerio:** `DROP TABLE company_netsuite_config` apaga
credenciais que podem estar em uso em alguma base. Sequência sugerida: (a) conferir se há linha
gravada em qualquer ambiente; (b) remover módulo e controller; (c) migration de drop **só depois** do
aval, num commit separado e reversível. Se houver dúvida, para no (b) — o módulo fora do
`app.module.ts` já fecha a rota.

**Como conferir:** `GET /api/v1/netsuite/:companyId/test` responde 404 e `npm run build` passa.
O `app.module.contrato.spec.ts` **não** confere a lista de módulos do `app.module` — ele confere a
ordem das chaves do decorador `@Module` por arquivo (`chavesDoDecorador`, linha 40), então tirar o
`NetsuiteModule` do `imports` não o quebra.

---

## 8. Confirmar dois pontos do contrato que o bundle assume

Não são mudanças — são confirmações a medir no fonte, porque o bundle vai depender delas e
"provavelmente" não serve:

1. **`idExterno` é único por filial, não global?** O bundle vai derivá-lo do internal id da transação
   do NetSuite (`INV-14872`). Se a unicidade for global, duas subsidiárias com a mesma sequência de
   internal id colidem — e o bundle precisa prefixar com a filial. Medir na constraint, não no
   docblock.

2. **Vocabulário de natureza declarável:** os códigos aceitos em
   `POST /transacoes/reclassificar` (`naturezaOperacao`) — `COMPRA`, `COMPRA_ATIVO`, e o resto.
   `SELECT codigo, nome FROM natureza_operacao` da base do piloto. O bundle vai montar uma
   *list/record* do NetSuite com eles, e ela tem de casar **por código** (o campo aceita UUID também,
   mas a comparação do outro lado é normalizada em minúscula e UUID em maiúscula **não casa nunca**,
   com falha silenciosa — junção que não acha, não erro).

## 9. BLOQUEANTE — aceitar `client_secret_basic` no `POST /oauth/token`

**O que:** aceitar as credenciais do client no header `Authorization: Basic base64(client_id:client_secret)`,
além do corpo. É a outra forma padrão do RFC 6749 (§2.3.1) — `client_secret_basic` ao lado do
`client_secret_post` que já existe.

**Onde:** `modules/oauth/oauth.controller.ts` (`@Post('token')`) e `OAuthService.issueToken`. O
`TokenRequestDto` (`oauth.dto.ts:40`) marca `client_id` e `client_secret` como obrigatórios no
corpo; eles passam a ser opcionais quando vierem no header.

**Por que — e este é o item mais duro do handoff, porque é uma restrição da plataforma, não uma
preferência nossa.** Medido no SuiteScript 2.x API Reference (`MEDICOES.md` §5.5):

- `https.createSecureString({input: '{custsecret_x}'})` resolve um segredo do **Secrets Management**
  do NetSuite sem que o script consiga **ler** o valor. É a única forma de usar credencial sem
  tê-la numa variável.
- Os **dois** lugares documentados onde uma `SecureString` pode ser usada são **header** e **URL**.
- `https.post` tipa `options.body` como **`string | Object | Uint8Array`**. `SecureString` **não**
  está na lista.

Logo: **não existe caminho por corpo JSON que preserve o segredo.** Para montar
`{"client_secret": "..."}` o script precisa do valor em claro numa variável — e aí ele vaza no
primeiro `log.debug` do payload, na primeira exceção com `JSON.stringify(request)`, ou para quem
abrir o script. Guardar em Secrets Management e depois interpolar em string é teatro de segurança:
o cofre existe, e a chave fica em cima da mesa.

Colocar o segredo na URL (o outro lugar permitido) é pior: URL vai para log de proxy, de gateway e
de servidor.

**O que já está feito do nosso lado:** `fp_client.js` monta o header Basic com `SecureString`
exatamente como o exemplo da referência (`createSecureString` dos dois placeholders →
`convertEncoding` BASE_64 → `appendSecureString({keepEncoding: true})` sobre `'Basic '`). Ele
**falha alto** com mensagem acionável enquanto o motor devolver 401, e **não tem fallback por
corpo** — de propósito. Fallback que funciona hoje com o segredo em claro é o que acaba em produção.

**Como conferir:**

```bash
curl.exe -s -X POST https://<host>/api/v1/oauth/token   -u "<client_id>:<client_secret>"   -H "Content-Type: application/json"   -d '{"grant_type":"client_credentials","scope":"fiscal:read nfe:emit"}'
```

Retorna `access_token` com `scope = "fiscal:read nfe:emit"`. O caminho por corpo continua
funcionando (não é substituição, é adição), e credencial no corpo **e** no header ao mesmo tempo
deve ser recusada — é o que o RFC manda, e evita ambiguidade sobre qual valeu.

---

## Fora de escopo deste handoff

Nada aqui pede régua nova, CST, alíquota, cBenef ou fórmula de base. O conector **traduz e
transporta**: declara identidade da operação e natureza, e guarda o retorno. Se algum item acima
parecer estar pedindo régua para o ERP, é erro de redação — aponte e reescrevemos.
