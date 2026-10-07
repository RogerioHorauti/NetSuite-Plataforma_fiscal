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

## 10. O `reclassificar` devolver o VEREDITO da nota do fornecedor contra a régua

**O que:** `POST /transacoes/reclassificar` já reprocessa a nota capturada pelo motor atual, a partir
do XML guardado, com a natureza que o ERP declarou. Falta ele **escrever e devolver as
`divergencias`** — o que o fornecedor destacou × o que a régua espera para a mesma operação.

**Por quê:** a coluna existe (`transaction.entity.ts:394`, `divergencias jsonb`) e **não tem quem a
escreva** — o próprio fonte diz isso em `emissao.service.ts:6663`. O bundle hoje compara a nota
com o `/simular` de compra e mostra os dois lados **sem veredito** (MEDICOES §17): decidir o que é
incoerência — tolerância, quais tributos contam, CST × CSOSN — é régua, e régua não entra no ERP.

**Como conferir:** reclassificar uma nota de fornecedor do Simples com ICMS destacado acima do
permitido devolve `divergencias[]` nomeando o tributo, o destacado, o esperado e a norma.

## 11. Perna contábil no documento reprocessado

**O que:** `TransactionTaxDetail` não tem `sentidoDaPernaFixa` nem `geraLancamento` — só o
resultado do `/simular` tem (`simulacao-nota-result.dto.ts:108-118`).

**Por quê:** na ENTRADA a sublista de impostos do NetSuite recebe o documento do `reclassificar`, e
o GL plug-in lê dela a perna para lançar. Sem os dois campos, a entrada fica sem lançamento — e o
bundle não pode inventar a perna, que é decisão da plataforma.

**Como conferir:** `linhas[].impostos[]` do retorno do `reclassificar` traz os dois campos, com o
mesmo significado do `/simular`.

## 12. `linhas[].impostos` na emissão: override por tributo ou desliga o motor?

**O que:** a descrição do campo no `SimulacaoLinhaDto` diz *"Tributos destacados pelo ERP (emissão).
Se presentes, o emitir NÃO recalcula pelo motor"*. O contrato combinado (CLAUDE.md do bundle) é
**override por tributo**: o declarado sobrepõe o homônimo e o motor continua calculando os outros.

**Por quê:** as duas leituras produzem notas diferentes quando o ERP declara um tributo só. O bundle
hoje não manda `impostos` e não é afetado — mas o dia em que mandar, precisa saber qual vale.

**Como conferir:** emitir com `impostos` declarando só o ICMS devolve a nota com PIS/COFINS
calculados pelo motor (override) — ou a descrição é corrigida para dizer o que o serviço faz.

---

## 13. Substituição de NFS-e: a plataforma resolver o `rpsSubstituido` pela chave

**O que:** quando o `substituicao` chega só com `chaveSubstituida` + `codigoMotivo`, a plataforma
preencher `substRpsNumero`/`Serie`/`Tipo` a partir da transação que ELA emitiu com aquela chave
(`emissao.service.ts:897-916` hoje grava só o que o ERP mandou, e a CHECK
`chk_subst_rps_grupo_inteiro` cobra os três juntos).

**Por quê:** o docblock do DTO diz que o ERP declara o RPS "porque é dele o RPS", mas quem
reservou o número, escolheu a série e definiu o `tsTipoRps` foi a plataforma — e o tipo varia por
padrão municipal (`montar-lote-elotech.ts:65` `1|2|3|4`, `montar-lote-abrasf1.ts:34` `1|2|3`,
`rps-builder.ts:164` default `RPS`). O bundle tem número e série no `DOC_NUMERO`/`DOC_SERIE`, mas
o TIPO ele teria de chutar. Mandar `1` fixo funcionaria até o primeiro município que use outro.

**Como conferir:** emitir uma NFS-e ABRASF com `substituicao: { chaveSubstituida, codigoMotivo }`
e ler `subst_rps_numero/serie/tipo` da nota nova iguais aos da substituída.

---

## 14. ICMS da prestação do CT-e pela régua do motor (e o CFOP pelo resolvedor)

> ✅ **FEITO na plataforma (conferido em 2026-10-07):** `prestacao-cte.dto.ts:30-34` — grupo, CST, base, alíquota e valor saem da régua `icms_prestacao_transporte`; `icms` mandado é descartado; `cfop` opcional.

> **Estado em 06/10/2026:** ICMS ✅ ENTREGUE (o `prestacao.icms` saiu do DTO; quem ainda o manda
> recebe 200 e o campo é descartado; régua das 27 UFs no item 17). **CFOP ✅ ENTREGUE** (plataforma
> `CT-8`): `prestacao.cfop` é OPCIONAL. Ausente, a plataforma resolve pelo Anexo II do Conv. s/nº/1970:
> `7358` fim no exterior · `x932` início fora da UF do emitente · `x359` carga dispensada de nota
> (`prestacao.carga.dispensadaDeNotaFiscal: true`) · `x360` quando a régua do ICMS põe a ST no tomador ·
> `x351` subcontratação/redespacho (`tipoServico` 1–3) · `352`–`357` pela **classe do tomador**, campo
> novo `participantes.tomador.classe` (`INDUSTRIAL` · `COMERCIAL` · `COMUNICACAO` · `ENERGIA_ELETRICA` ·
> `PRODUTOR_RURAL` · `OUTRA`). Tomador contribuinte sem classe → **400 nomeando o campo**; não
> contribuinte (`indIeToma: '9'`) → 357; produtor rural declarado → 356. Declarado, o CFOP vale e é
> conferido no 1º dígito (rejeição 519) e no 932 (524/908).
> **Ação do bundle:** parar de mandar `prestacao.cfop` e mandar `participantes.tomador.classe`.
> Provado pela API: SC→SP com `INDUSTRIAL` → `6352`; SC interna a não contribuinte → `5357`; BA→SE
> com ST do tomador (art. 298) → `6360`; SC→SP sem classe → 400; `cfop: '5353'` em SC→SP → 400 (519).

**O que:** o `prestacao.icms` deixa de ser obrigatório. O motor resolve `grupo`, `cst`,
`baseCalculo` e `valor` (a alíquota já resolve: `resolverAliquotaDaPrestacao`,
`aliquota-do-frete.ts`), e o `icms` do payload vira OVERRIDE, como `linhas[].impostos[]` na NF-e.
Idem `prestacao.cfop`: o resolvedor de CFOP a partir da natureza + UF de início e fim, com o
declarado como override.

**Onde:** `cte-emissao.service.ts:213-223` (`icms()` copia `grupo/CST/vBC/vICMS` do payload) e
`prestacao-cte.dto.ts` (`icms` e `cfop` obrigatórios).

**Por quê:** CST e base vindos do ERP é exatamente a régua duplicada que o bundle não pode ter
(CLAUDE.md do bundle). O `grupo` é leiaute sobre o CST + contexto (regime da filial → ICMSSN;
`inicioPrestacao` em UF diferente da do emitente → ICMSOutraUF). Base e valor são conta. Só o CST
pede régua nova, por UF de início × tipo de serviço × tomador contribuinte × regime — dado em
tabela, como a `aliquota_interna_transporte`. Sem linha para a UF: RECUSA citando a UF, nunca
CST 00 por default.

**Como conferir:** emitir um CT-e sem `icms` nem `cfop` devolve o XML com `ICMS00`, CST, vBC e
vICMS resolvidos; com `icms.cst` declarado, o declarado prevalece.

---

## 15. Município da prestação do CT-e por nome + UF

> ⚠ **PARCIAL (conferido em 2026-10-07):** o `MunicipioMdfeDto` aceita `{ nome, uf }`; o `MunicipioPrestacaoDto` do CT-e (`prestacao-cte.dto.ts:36-44`) **ainda** exige `codigo` de 7 dígitos e não tem `uf`. O bundle já manda `{ nome, uf }` no CT-e.

**O que:** `MunicipioPrestacaoDto` aceitar `{ nome, uf }` sem `codigo` e resolver o IBGE, como a
NFS-e já faz com `municipioPrestacaoNome` + `ufPrestacao` (recusando nome ambíguo).

**Por quê:** o NetSuite não guarda IBGE no endereço, e o bundle não o digita nota a nota — foi o
que a NFS-e já resolveu. Hoje `codigo` é `@Length(7, 7)` obrigatório (`prestacao-cte.dto.ts`).

**Como conferir:** CT-e com `inicioPrestacao: { nome: 'SAO PAULO', uf: 'SP' }` sai com `cMunIni`
3550308.

**Estender ao MDF-e:** ✅ **ENTREGUE pela plataforma em 06/10/2026 (commit `2f51405d`).** Em
`manifesto.municipiosCarrega[]` e `manifesto.municipiosDescarga[]`, o `codigo` ficou opcional: mande
`{ nome, uf }` (e as `chavesNFe` na descarga) e a plataforma resolve o IBGE; nome sem UF ou fora da
referência nacional é recusado apontando a posição (`manifesto.municipiosDescarga[1]: …`).

---

## 16. ~~BLOQUEANTE do MDF-e~~ ✅ ENTREGUE em 06/10/2026 — `POST /fiscal/mdfe/:chave/encerrar`

> **Contrato entregue (commit `2f51405d` da plataforma):**
> - `POST /fiscal/mdfe/:chave/encerrar` — corpo `{ municipio: { codigo } | { nome, uf }, dataEncerramento? }`
>   (`dataEncerramento` AAAA-MM-DD; ausente = hoje no fuso da filial; futura ou anterior à emissão = 400).
> - `POST /fiscal/mdfe/:chave/cancelar` — corpo `{ justificativa (15–255), ignorarPrazo? }`; acima de 24 h
>   da autorização = 400 (K04, rejeição 220), salvo `ignorarPrazo`.
> - Resposta dos dois: `{ id, chaveAcesso, tpEvento, nSeqEvento, situacao: REGISTRADO|REJEITADO, cStat,
>   xMotivo, nProt }`. Registrado, o MDF-e passa a `ENCERRADO`/`CANCELADO` e o `GET :chave/situacao`
>   mostra. O `nProt` da autorização, o `nSeqEvento` e o CNPJ são da plataforma; o A1 é o da filial emitente.
> - O município é ONDE a viagem terminou (o fato), não o UFFim do manifesto — por isso vem do ERP.

**O que:** expor em HTTP o encerramento do MDF-e, que a plataforma já implementa por dentro
(`mdfe-encerramento.ts`, `mdfe-eventos.ts`, evento pelo `MDFeRecepcaoEvento`). Hoje o
`mdfe.controller.ts` só tem `GET :chave/situacao`, `POST reconciliar`, `POST :chave/reconciliar`,
`POST :chave/reprocessar` e `GET :chave/damdfe` (medido em 06/10/2026).

**Por quê:** o MDF-e precisa ser encerrado no fim da viagem; enquanto não for, fica pendente contra o
emitente, e a SEFAZ tem um serviço só para cobrar isso (`MDFeConsNaoEnc`, `mdfe-encerramento.ts:5-6`).
O próprio `mdfe-endpoints.ts:24` diz que a frente vive em pares — emitir e encerrar. Se o NetSuite
emitir MDF-e sem poder encerrar, cada viagem vira uma pendência que só se resolve fora do ERP. **O
bundle não começa a emissão de MDF-e antes deste item.**

**Como conferir:** emitir um MDF-e em homologação, chamar o `encerrar` com UF e município de
encerramento e receber o protocolo do evento; o `GET :chave/situacao` passa a devolver o manifesto
encerrado.

---

## 17. CT-e — os FATOS da carga que a régua do ICMS pede (contrato medido em 06/10/2026)

**O que:** o CST da prestação sai da régua `icms_prestacao_transporte` (27 UFs, lida contra o
RICMS de cada uma). Cada linha de desoneração depende de um FATO da carga ou dos participantes. Fato
ausente não vale "não": a plataforma **recusa com 400 nomeando o campo** e não consome numeração.
Exemplo real: *"A régua do ICMS da prestação depende de `prestacao.carga.caracteristicas` para
decidir o CST (RCTE/GO, Anexo IX, art. 6o, CIV, "b")..."*. Uma lista vazia (`[]`) é a declaração
explícita de "nenhuma" e destrava a linha geral.

**Caminho sem recusa: o bundle manda SEMPRE os campos de `prestacao.carga` abaixo.**

| campo | valores | onde a régua lê (medido na tabela vigente) |
|---|---|---|
| `isencaoDaMercadoria` | lista de códigos (`CONV_ICM_26_1975_CALAMIDADE`, `CONV_ICMS_43_2010_DEPEN`, `CONV_ICMS_81_2015_PROSUB`, `CONV_ICMS_15_2021_VACINA_SARS_COV_2`...) ou `[]` | **todas as 27 UFs**: convênio impositivo vale em todas (LC 24/1975, art. 7º) |
| `exportacao` | `DIRETA` · `FIM_ESPECIFICO` · `NAO` | AC, CE, DF, GO, MG, MT, PI, PR, RN, RO, RS, SC, SE, SP |
| `destinoExportacao` | `PORTO` · `AEROPORTO` · `PONTO_DE_FRONTEIRA` (quando `exportacao` ≠ `NAO`) | AC, DF, MG, MT, RS, SC, SE, SP |
| `caracteristicas` | lista (`EMBALAGEM_AGROTOXICO_DO_PRODUTOR_A_CENTRAL`, `EMBALAGEM_AGROTOXICO_DA_CENTRAL_AO_RECICLADOR`, `RESIDUO_ELETRONICO_LOGISTICA_REVERSA`, `DO_DESEMBARQUE_DE_IMPORTACAO`, `TRANSITO_FERROVIARIO_INTERNACIONAL_ATIT`...) ou `[]` | ferroviário (modal `04`): **27 UFs**; interna e interestadual: BA, CE, ES, GO, MG, MS, MT, PI, RN, RO, SC (ES, PI e RN desde 06/10/2026, CT-6: ZPE e embalagem de agrotóxico); só interna: AM, PE, RR |
| `ncm` | NCM predominante da carga (8 dígitos) | interestadual: BA, MG, PE, RN; interna: AM, AP, MA, PA, PI, PR, RN |
| `modalidadeFrete` · `stDaMercadoria` | CIF/FOB · se a mercadoria está sob ST | PI, SE; BA (art. 289, §§ 4º e 5º, também depois de 13/05/2026) |
| `destinacao` · `terminalDestino` · `hidrovia` · `remessaArmazenagem` | ver Swagger | interna de PA/PI · RN · PA · GO |

Nos participantes (`remetente`, `destinatario`, `expedidor`, `recebedor`), a régua de ST e de
benefício por pessoa lê `regimeTributario`, `produtorRural`, `porte`, `atividades`,
`credenciamentos` e `emiteNfe`. O mesmo vale aqui: mandar sempre o que o cadastro do NetSuite tem.

**Onde:** `prestacao-cte.dto.ts` (enums exportados de `condicoes-da-regua-do-icms.ts`, que é a
fonte do vocabulário fechado: valor fora dele dá 400 de validação).

**Como conferir (provado em 06/10/2026 pela API em `dist/main`, tenant de prova):**
- CE interna com `caracteristicas: ['RESIDUO_ELETRONICO_LOGISTICA_REVERSA']` → `ICMS45/CST 40`;
- RO com `exportacao: 'DIRETA', destinoExportacao: 'PORTO'` → `CST 41`;
- GO interestadual com `caracteristicas: []`, `exportacao: 'NAO'` → `ICMS00`, 12 %;
- GO interestadual sem `caracteristicas` → 400 nomeando o campo.

✅ **MT, MG, MS e PR emitem CT-e** (06/10/2026, plataforma `CT-7`): cada uma vai ao autorizador
PRÓPRIO, com os endereços da lista oficial do Portal CT-e. Recusas de contrato medidas nessas UFs
(400, sem numeração): MT e PR sem `carga.exportacao`; MS sem `carga.caracteristicas`; MG interna sem
o `regimeTributario` do tomador. MG: o item 162 do Anexo X (isenção opcional) só vale com a opção
declarada na filial (`enquadramentos_transporte` com `MG_ANEXO_X_162_OPCAO_ISENCAO`).

---

## 17. Natureza da conta (`COD_NAT_CC`) no CSV do plano de contas

**O que:** o layout `contratos/importacao-csv/plano_de_contas.v1.md` não tem coluna de TIPO de
conta, e a `natureza` é opcional. Sem ela a conta grava `natureza = NULL`
(`receber-plano-contas.service.ts:203`) e o `0500` sai sem `COD_NAT_CC` (`gerar-bloco-0.service.ts:534-545`),
campo obrigatório — sem pendência no `/situacao`. Antes, o importador derivava do `Account Type`
(`importar-plano-contas.ts:101-108`, `naturezaDoTipo`).

**Pedido:** ou o layout aceita o tipo de conta do ERP (o rótulo do NetSuite, que a `naturezaDoTipo`
já lê) e a plataforma deriva, ou a natureza ausente vira pendência `impede` no `/situacao`. O
bundle NÃO classifica: a natureza é régua.

**E a regex:** `Deferred Expense` cai em `04` (casa com "expense"), mas no NetSuite é conta de
ATIVO (despesa antecipada); `Deferred Revenue` cai em `04` (casa com "revenue"), mas é PASSIVO.
A sandbox tem 2 contas `DeferExpense`.

---

## Fora de escopo deste handoff

Nada aqui pede régua nova, CST, alíquota, cBenef ou fórmula de base. O conector **traduz e
transporta**: declara identidade da operação e natureza, e guarda o retorno. Se algum item acima
parecer estar pedindo régua para o ERP, é erro de redação — aponte e reescrevemos.
