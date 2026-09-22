# Medições — o que foi lido no fonte, e onde

> Regra do projeto: **contrato vem do Swagger, campo/scriptid vem do XML do objeto ou do Records
> Browser, comportamento do motor vem do método real.** Nunca de memória. Este arquivo é o registro
> dessas leituras, para não viverem só no contexto de uma conversa.
>
> Cada item diz **onde foi lido** e **quando**. Item sem fonte não entra aqui.
> Toda medição feita em **2026-09-04** salvo indicação.

---

## 1. FiscalPlatform — repositório `C:\Users\TI\Documents\GitHub\fiscal-platform`

### 1.1 Autenticação

| fato | fonte |
|---|---|
| `POST /api/v1/oauth/token`, `grant_type=client_credentials` | `backend/src/modules/oauth/oauth.controller.ts` |
| body: `client_id`, `client_secret`, `scope` | `oauth.dto.ts:40` (`TokenRequestDto`) |
| resposta: `access_token`, `token_type`, `expires_in`, `scope` | `oauth.dto.ts:59` (`TokenResponseDto`) |
| escopos válidos: **`fiscal:read`, `fiscal:write`, `nfe:emit`** — e só esses três | `oauth.service.ts:16` (`AVAILABLE_SCOPES`) |
| escopo default quando não informado: `fiscal:read` | `oauth.service.ts:49` |
| TTL do token: `tokenTtl` por client, exemplo 3600 s | `oauth.dto.ts:26` |
| registro de client: `POST /oauth/clients`, protegido por `JwtAuthGuard` | `oauth.controller.ts` |

`API_PREFIX` default `api/v1`; `PORT` default `3000`; **sem TLS no processo** — `backend/src/main.ts`.

### 1.2 Emissão — `POST /fiscal/emitir` é one-shot

| fato | fonte |
|---|---|
| `emitir()` reserva número, monta, assina e **transmite** na mesma chamada | `modules/fiscal/emissao/emissao.service.ts:421` → **:2456** (`this.transmissao.transmitir(txId, xml)`) |
| única exceção: **EPEC** — `tpEmis` 4 na chave, não transmite por norma | `emissao.service.ts:2450-2456` |
| **a descrição do Swagger nega isso** ("Esta etapa NÃO assina nem transmite") | `modules/fiscal/emissao/emissao.controller.ts`, `@Post('emitir')` |
| retorno idempotente por `idExterno` sai antes, por outro caminho | `emissao.service.ts:605` |
| retorno = `Transaction` + `danfeUrl` + `xmlUrl` + `avisos?` | `emissao.service.ts:115` (`TransactionComLinks`), `:2512` (`comLinks`) |
| `avisos` **ausente** = "esta resposta não avaliou avisos"; `[]` = avaliou e nada a dizer | docblock em `emissao.service.ts:115` |
| o retorno idempotente **não roda o pré-passo**, logo `avisos` vem `undefined` — e **não há flag** distinguindo replay de emissão nova | idem |
| precedente de flag no próprio motor: evento da Reforma devolve `jaRegistrado=true` | `emissao.controller.ts`, `@Post('emitir/:id/evento-reforma')` |

Métodos públicos de `EmissaoService`: `emitir` (:421), `consultar` (:2464), `statusSefaz` (:2475),
`gerarDanfe` (:2528), `baixarXml` (:2733), `enviarCartaCorrecao` (:2757), `gerarDacce` (:2800),
`cancelar` (:2854), `cancelarPorSubstituicao` (:2948), `pendentesDeTransmissao` (:2980),
`enviarEventoReforma` (:3023), `gerarXmlPreview` (:6959), `inutilizarFaixa` (:6969).

### 1.3 Campos do documento no motor — `Transaction`

`modules/transacoes/transaction.entity.ts`: `serie` (:45), `numero` (:48), `chaveAcesso` (:52),
`status` (:64, default `RASCUNHO`), `xmlAssinado` (:383), `cStat` (:397), `xMotivo` (:440),
`xmlProc` (:447, `<nfeProc>` — "documento fiscal VÁLIDO").

`baixarXml` devolve o `nfeProc` quando existe e cai no assinado quando não — `emissao.service.ts:2733`.

### 1.4 Simulação

| fato | fonte |
|---|---|
| `POST /fiscal/simular-nota`, body `SimulacaoNotaInputDto` | `modules/fiscal/fiscal.controller.ts:46` |
| **está com `@ApiExcludeEndpoint()`** — fora do Swagger do ERP | `fiscal.controller.ts:45` |
| `POST /fiscal/simular` (um produto) também existe | `fiscal.controller.ts:21` |
| critério declarado do que entra no Swagger do ERP: "entra o que o ERP DIRIGE" | docblock em `main.ts` |

`EmitirNotaDto extends OmitType(SimulacaoNotaInputDto, ['linhas'])` + `serie` + `tipoDocumento` —
`modules/fiscal/emissao/emitir-nota.dto.ts:334`.

Campos de cabeçalho do `SimulacaoNotaInputDto` (`modules/fiscal/engine/dto/simulacao-nota-input.dto.ts:1456`):
`branchId`, `companyId`, `cnpjEmpresa`, `destinatario{}`, `naturezaOperacaoId`, `dataEmissao`,
`dataSaidaEntrada`, `competenciaOriginal`, `dataReajuste`, `linhas[]`.

Campos de linha usados pelo mapeador (`SimulacaoLinhaDto`, mesmo arquivo, :154): `valorProduto`,
`numeroItem`, `unidade`, `quantidade`, `codigoProduto`, `descricao`, `ncm`, `cest`, `origemProduto`,
`exTipi`, `tipoItem`, `cfopCodigo`, `valorFrete`, `valorSeguro`, `valorDesconto`,
`chaveAcessoReferencia`, `numeroLinhaReferencia`, `codigoBarras`, `impostos[]`, `di{}`.

Campos só do `EmitirNotaDto`: `serie`, `tipoDocumento`, `idExterno` (:449), `pagamento[]`,
`transporte{}`, `contingencia{}`, `exportacao{}`, `substituicao{}`, `indPres`, `indFinal`,
`infAdicFisco`, `infAdicContrib`.

### 1.5 Declaração de natureza na entrada

`POST /transacoes/reclassificar` — `modules/transacoes/transacoes.controller.ts:159`.

`ReclassificarDto` (`reclassificar.dto.ts:171`): `chaveAcesso`, `naturezaOperacao`, `dataEntrada`,
`linhas[]`. `ReclassificarLinhaDto` (:13): `numeroItem`, `naturezaOperacao`, `tipoItem`,
`fatorConversao`, `naturezaReceita`, `codigoItemDeclarante`.

`GET /transacoes` (:187) — filtros `id`, `companyId`, `branchId`, `status`, `entradaSaida` (`S`/`E`),
`q`, `chave`, `dataDe`, `dataAte`, `page`, `limit`. **Está no Swagger.**

`GET /transacoes/chave/{chave}` (:254) e `/existe` (:236) — **ambos `@ApiExcludeEndpoint()`**, apesar
de o docblock do `main.ts` afirmar que o primeiro é o único visível do controller.

### 1.6 Módulo `netsuite` do motor — descartado

`modules/netsuite/`: controller `/api/v1/netsuite/:companyId/{test,customers,invoice}`
(`@ApiExcludeController`), entity `company_netsuite_config` com `consumer_key`, `consumer_secret`,
`token_id`, `token_secret` — **`varchar` comuns, sem criptografia** (`netsuite-config.entity.ts`),
ao contrário do certificado, que passa por `descriptografar` (`modules/certificate/crypto.util`).

O header OAuth 1.0a é montado à mão em `netsuite.service.ts:25-45`. A dependência **`oauth-1.0a` do
`package.json` não é importada em nenhum lugar de `src/`** — declarada e nunca usada.

`app.module.contrato.spec.ts` **não** confere a lista de módulos do `AppModule`; confere a ordem das
chaves do decorador `@Module` por arquivo (`chavesDoDecorador`, :40).

---

## 2. Este repositório

`src/` tem apenas `manifest.xml` (`projecttype=ACCOUNTCUSTOMIZATION`, `frameworkversion=1.0`,
`projectname=NetSuite`) e `deploy.xml`. **Não existem** `Objects/`, `FileCabinet/` (criado agora) nem
`AccountConfiguration/`.

`git ls-files` no início: **só `README.md`** rastreado. `Consumer-Key-Client-ID.txt` estava presente
e **não ignorado** — corrigido no `.gitignore`, arquivo ainda em disco.

Conta alvo: `https://tstdrv1647270.app.netsuite.com` — TSTDRV (demo / release preview), legacy.

---

## 3. Bundle 436209 — Electronic Invoicing

**Como foi medido:** `unzip` de `~/Downloads/suitesuccess/Bundle 436209.zip`.

**Descoberta principal:** a raiz do zip é `com.netsuite.electronicinvoicing/` — ou seja, **bundle
numérico 436209 e application id `com.netsuite.electronicinvoicing` são o mesmo SuiteApp**. Versão
informada pelo Rogerio: 10.4.1, gerenciado (*managed*).

### 3.1 Campos de transação (`custbody_*`) presentes no fonte do bundle

```
custbody_cofins_total          custbody_icms_st_taxbase       custbody_pis_total
custbody_discount_total        custbody_icms_st_total         custbody_prod_svc_total
custbody_edoc_gen_trans_pdf    custbody_icms_taxbase          custbody_psg_ei_certified_edoc
custbody_edoc_generated_pdf    custbody_icms_total            custbody_psg_ei_content
custbody_fiscal_doc_number     custbody_insurance_total       custbody_psg_ei_edoc_recipient
custbody_fiscal_doc_series     custbody_ipi_total             custbody_psg_ei_generated_edoc
custbody_freight_mode          custbody_nfe_total             custbody_psg_ei_inbound_edocument
custbody_freight_total         custbody_operation_nature      custbody_psg_ei_sending_method
custbody_fuso                  custbody_other_accessory_total custbody_psg_ei_status
                               custbody_paymentterms          custbody_psg_ei_template
                                                              custbody_psg_ei_trans_edoc_standard
```

### 3.2 Custom records

```
customrecord_alf_third_party              customrecord_psg_ei_response_status
customrecord_ei_ctt_map                   customrecord_psg_ei_standards
customrecord_ei_sending_method            customrecord_psg_ei_sub_prefs_data
customrecord_ei_tr_status_clari_action     customrecord_psg_ei_template
customrecord_ei_tr_status_clari_reason     customrecord_psg_ei_trans_res
customrecord_nseb_av_mandate              customrecord_psg_ei_transres_template
customrecord_psg_ei_email_recipient
customrecord_psg_ei_email_recipient_vend
customrecord_psg_ei_inbound_edoc
customrecord_psg_ei_peppol_tax_category
```

### 3.3 O que este bundle **não** tem

**Nenhum campo de chave de acesso de 44 dígitos, cStat, xMotivo ou protocolo.** Ele é o motor de
e-document genérico (UBL, Peppol, `customrecord_psg_ei_standards`). A parte especificamente
brasileira deve estar em `com.netsuite.brazillocalization` — **não medido ainda**.

### 3.4 Conclusão que sustenta a política de "máximo de standard"

**O NetSuite não tem campo nativo de NF-e.** A Oracle criou os dela por SuiteApp. Se houvesse
nativo, ela teria usado. Logo: padrão onde existe nativo, id do SuiteApp instalado onde o domínio é
fiscal, id nosso só onde nem um nem outro tem — ver `ARQUITETURA-COMPATIBILIDADE.md` §3.

### 3.5 O que ficou **não medido** neste bundle

- **tipo** de cada campo (Free-Form Text × List/Record × Document), tamanho, obrigatoriedade;
- se o campo é **gravável por script de terceiro** (bundle gerenciado pode ter objeto bloqueado);
- **internal id dos valores** de `custbody_psg_ei_status` — o vocabulário dele é do fluxo de
  e-document (*Ready for Sending*, *Sent*, *Certified*), não o nosso;
- quais desses campos o **User Event do próprio bundle escreve** (define a lista `somenteLeitura`).

Os quatro se medem **na conta**: Customization > Lists, Records & Fields > Transaction Body Fields,
e o Records Browser da versão da conta.

---

## 4. Prefixos de scriptid inventariados

| prefixo | dono | onde foi visto |
|---|---|---|
| `psg_ei_`, `ei_`, `edoc_`, `alf_` | Electronic Invoicing (436209 / `com.netsuite.electronicinvoicing`) | zip do bundle |
| `brl_` | `com.netsuite.brazillocalization` | `manifest.xml` do projeto Avalara: `custompurchase_brl_inbound_delivery`, `custompurchase_brl_inbound_dlvry_cred`, `customsale_brl_outbound_delivery` |
| `ecs_` | `com.netsuite.edoccertificationservice` | idem: `customrecord_ecs_edoc_category` |
| `avlr_` | Avalara Brazil (AvaTax / Tax Compliance) | `~/OneDrive/NetSuite/bitbucket-ryh/avalara-brazil-suitesuccess-tco/src/Objects/` — 62 objetos |
| `enl_` | camada sobre a qual o Avalara se apoia | `customrecord_enl_fiscaldocumenttype`, `custbody_enl_order_documenttype`, `customrecord_enl_operationtype`, `custrecord_enl_sendtofiscal`, `custrecord_enl_issuereceiptdocument` — usados no `AVLR_SuiteTax_UE.js` |

O `manifest.xml` do projeto Avalara declara dependência por `<application id=...>`, **sem** bloco
`<bundles>` numérico — mas o Electronic Invoicing aparece na conta como bundle 436209. **As duas
formas de identificar coexistem**, e a camada de compatibilidade registra ambas no perfil.

---

## 5. `AVLR_SuiteTax_UE` — mecanismo de mensagem síncrona

**Arquivos:** `~/Downloads/AVLR_SuiteTax_UE.js` (700 linhas) ·
`~/OneDrive/BringIT/new eInvoice v3/AVLR_SuiteTax_Functions.js` · `AVLR_UtilV3.js`.

| passo | fonte |
|---|---|
| `setControlString` grava random de 32 chars em `custbody_avlr_randomstring` **no registro** | `AVLR_SuiteTax_Functions.js:1072` |
| `randomString(32, '#aA')` — `Math.random()` sobre máscara | `AVLR_UtilV3.js:106` |
| `https.post` síncrono para `<baseURL>/v3/calculations` | `AVLR_SuiteTax_UE.js:327-332` |
| HTTP ≠ 200 → `getMessageError` + sessão `errorresponse<random>`, prefixo `MENSAGEM SW FISCAL :` | `AVLR_SuiteTax_UE.js:336-352` |
| HTTP 200 → `sucessponse<random>` = "Impostos calculados com sucesso" | `AVLR_SuiteTax_UE.js:354-362` |
| `catch` → `errorresponse<random>`, prefixo `MENSAGEM NETSUITE :` | `AVLR_SuiteTax_UE.js:386-400` |
| **o save nunca é abortado** em nenhum dos três caminhos | idem |
| `beforeLoad` chama `messageError` só em `USERINTERFACE` | `AVLR_SuiteTax_UE.js:101` |
| `messageError` lê o random **do registro**, busca a sessão, pinta `addPageInitMessage` e **zera a chave** | `AVLR_SuiteTax_Functions.js:984-1070` |
| precedência: erro > glimpact > warning > sucesso; sucesso **só em `type == 'view'`** | `AVLR_SuiteTax_Functions.js:1022-1068` |
| guarda de contexto: sai fora em `CSVIMPORT` e `WEBSERVICES` | `AVLR_SuiteTax_UE.js:131` |

**Defeito encontrado:** no `catch` do `beforeSubmit`, `_randomString` fica `undefined` se a exceção
subiu antes do `setControlString` — a chave de sessão vira `errorresponseundefined`, o
`messageError` procura outra, e **o erro não chega à tela**. Corrigido no nosso `fp_msg.js` por
`garantirCorrId()`, que recupera do registro (ou cria) no caminho de exceção.

---

## 5.1 Schema dos objetos SDF — medido em objetos reais

**Fonte:** `~/OneDrive/NetSuite/bitbucket-ryh/avalara-brazil-suitesuccess-tco/src/Objects/` — 62
objetos reais, já validados contra uma conta. Os nossos 21 objetos em `src/Objects/` foram gerados
com **exatamente** esta ordem de elementos, e não de memória.

| item | medido |
|---|---|
| `transactionbodycustomfield` — **58 elementos**, ordem fixa | `custbody_avlr_acct_message.xml` |
| `customrecordcustomfield` — **37 elementos**, ordem fixa | `customrecord_avlr_dfe_log.xml` |
| `subtab` — 3 elementos: `parent`, `tabtype` (`TRANSACTION`), `title` | `custtab_303_t1490237_274.xml` |
| `fieldtype` em uso: `TEXT` (32×`SELECT`, 18×`TEXT`, 15×`CLOBTEXT`, 6×`DOCUMENT`, 5×`DATE`, 4×`INTEGER`, 3×`MULTISELECT`, 3×`FLOAT`, 2×`URL`) | varredura nos 62 |
| `displaytype` em uso: `NORMAL` (71×), `STATICTEXT` (16×), `HIDDEN` (1×) | idem |
| campo de texto longo é **`CLOBTEXT`**, não `TEXTAREA` | idem |

**`selectrecordtype` — confirmado em 10+ arquivos independentes:**

| valor | record |
|---|---|
| `-117` | Subsidiary |
| `-30` | Transaction |
| `-103` | Location |
| `-10` | Item |
| `-9` | Partner / Entity |
| `-417` | Client Script |

Referência a objeto de outro SuiteApp usa a forma
`[appid=com.netsuite.edoccertificationservice, scriptid=customrecord_ecs_edoc_category]` — e é assim
que um perfil de compatibilidade aponta para campo de bundle de terceiro, quando chegar a hora.

⚠ **Bem formado não é válido.** Os 21 objetos passam em parser XML; a validação de schema é
`suitecloud project:validate --server`, que ainda **não pôde rodar** (§5.2).

## 5.2 Toolchain local

| item | estado |
|---|---|
| JDK 17 (`java version "17.0.20.1"`) | **instalado** |
| `JAVA_HOME` = `C:\Program Files\Java\jdk-17.0.20.1` | **definido na sessão** |
| SuiteCloud CLI | **NÃO instalada** — `suitecloud: command not found`; o pacote é `@oracle/suitecloud-cli` (o `npx suitecloud` dá 404 porque o nome sem escopo não existe) |

Sem a CLI não há `project:validate --server` nem `object:import` — é o que bloqueia fechar a Fase 0.

## 5.3 Como o AVLR resolve autenticação — padrão a **não** copiar

`AVLR_UtilV3.getHeaderRequest(subsidiary)` (`~/OneDrive/BringIT/new eInvoice v3/AVLR_UtilV3.js:10`)
chama um **Restlet próprio** por `https.requestRestlet({scriptId: 'customscript_avlr_easytalk_rl', ...})`
e usa o `response.token` para montar `Authorization: Bearer <token>` + `Content-Type: application/json`.
A base URL vem de um campo da subsidiária, `custrecord_enl_urlswfiscal` (`:45`).

**O que confirma o nosso desenho:** header `Bearer` + JSON, e base URL por subsidiária (no nosso caso,
`customrecord_fp_config`, que também guarda filial e ambiente).

**O que não copiar:** o segredo não está protegido — apenas mudou de lugar, para dentro de outro
script. O nosso vai para **Secrets Management**, onde o valor não é legível pelo script.

**Não medido:** a forma exata de injetar o segredo (`https.createSecureString`) — nenhum script local
usa Secrets Management. Fica em §7.10.

## 5.4 Organização de formulário — idiomas medidos no Brazil Localization

**Fonte:** `com.netsuite.brazillocalization.zip` (`~/Downloads/suitesuccess/`), descompactado — 872
arquivos, **fonte completo dos User Events**, ao contrário do 436209, que só distribui Client
Scripts e Plug-ins. Arquivo lido: `src/entrypoints/ue/brl_ue_transaction.js` — **629.097 chars em 7
linhas** (webpack minificado). SuiteApp **Brazil Localization v1.11.0**.

Replicado em `src/FileCabinet/SuiteScripts/FiscalPlatform/fp_form.js`.

### O idioma central: `insertField` só sabe inserir ANTES

`Form.insertField({field, nextfield})` insere **antes** de `nextfield`. Não existe "insira depois".
A Oracle resolve com **dois movimentos** (`positionFederalTaxRegistration`):

```js
form.insertField({field: nosso,  nextfield: nativo});  // [nosso] [nativo]
form.insertField({field: nativo, nextfield: nosso});   // [nativo] [nosso]
```

Sem o segundo, o campo aparece **antes** do nativo. É o erro clássico de quem posiciona campo no
NetSuite pela primeira vez.

### O segundo detalhe: o laço corre de trás para frente

`positionFieldsInOrder(form, anchor, fields, moveAnchorAfter)`:

```js
var next = anchor;
for (var i = fields.length - 1; i >= 0; i--) {        // DE TRÁS PARA FRENTE
  var f = form.getField({id: fields[i]});
  if (f) { form.insertField({field: f, nextfield: next}); next = fields[i]; }
}
if (moveAnchorAfter) {
  var a = form.getField({id: anchor});
  if (a) form.insertField({field: a, nextfield: fields[0]});
}
```

Correndo para frente, a ordem final sai **invertida**. O `for` decrescente não é estilo.

Com `anchor = memo`, `fields = [tipodoc, natureza]`, `moveAnchorAfter = true`, o resultado é
`memo, tipodoc, natureza` — que é exatamente o pedido.

### O resto do toolkit dela

| função da Oracle | o que faz | nosso equivalente |
|---|---|---|
| `positionFieldsInOrder` | bloco de campos depois de uma âncora | `posicionarDepoisDe` |
| `positionFieldsInOrderWhenReferenceFound` | usa o **primeiro** dos âncoras candidatos que existir | `posicionarDepoisDaPrimeiraAncora` |
| `positionSublistFieldsInOrder` | idem para coluna de sublist (`sublist.insertField`) | não replicado ainda |
| `hideFieldsIfExist` / `updateDisplayFieldsIfExist` | esconde / muda display só se o campo existir | `esconderSeExistir` / `exibicaoSeExistir` |
| `setFormFieldsDisabled` | DISABLED ↔ NORMAL em lote | `desabilitarSeExistir` |
| `createFieldGroup` | `addFieldGroup` + os 4 flags fixos (`isCollapsed=false`, `isCollapsible=false`, `isSingleColumn=false`, `isBorderHidden=false`) | `criarGrupo` |
| `createHiddenField` | placeholder de pegada zero: `FieldType.HELP` + `HIDDEN` | não replicado ainda |
| `replaceByCustpage` | cria campo `custpage_` sombra copiando label/tipo/opções/valor do original, insere antes e **esconde o original** | não replicado — é para reescrever campo nativo, não é o nosso caso |
| `toggleCustBodyCustPageFieldVisibility` | alterna qual dos dois (o real × o sombra) aparece | idem |

**Padrão transversal em toda função dela:** `getField` sempre dentro de guarda, e **campo
inexistente é pulado em silêncio**. O mesmo User Event roda em muitos tipos de transação e nem todo
campo está em todo formulário — lançar ali derrubaria o load do registro por um campo que
legitimamente não existe naquele tipo.

**Guarda de contexto:** `beforeLoad` inteiro dentro de
`Runtime.getExecutionContext() === ContextType.USER_INTERFACE`.

### Atribuição declarativa vence posicionamento imperativo

Campo com `<subtab>` preenchido no XML renderiza **na subtab**, e `insertField` **não** o traz para
a aba principal. Daí a divisão dos nossos objetos:

- `custbody_fp_tipodoc` e `custbody_fp_natureza` → `<subtab></subtab>` **vazio**, posicionados no
  `beforeLoad` logo depois do `memo`. São **declaração**: o usuário digita.
- chave, número, série, status, cStat, xMotivo, protocolo, uuid, XML, DANFE, `sim_*` →
  `<subtab>[scriptid=custtab_fp_fiscal]</subtab>`. São **retorno**: consulta, não digitação.

## 5.5 `N/https` e Secrets Management — medido no SuiteScript 2.x API Reference

**Fonte:** `doc/SuiteScript2xAPI.pdf` deste repositório (também em `~/Downloads/`), extraído com
`pdftotext -layout` → 122.486 linhas. Números de linha abaixo são do texto extraído.

### Secrets Management: o segredo entra por placeholder

```js
const nameToken = "custsecret_myName";
const secString = https.createSecureString({ input: "{" + nameToken + "}" });
```

O script **nunca lê** o valor. Membros da `SecureString`: `appendString`, `appendSecureString`,
`convertEncoding`, `replaceString`, `hash`, `hmac` — **só em script de servidor** (linha 32600).

Exemplo de header Basic da própria referência (linhas 32898-32945):

```js
const par = https.createSecureString({ input: "{" + nameToken + "}:{" + passwordToken + "}" });
par.convertEncoding({ toEncoding: encode.Encoding.BASE_64, fromEncoding: encode.Encoding.UTF_8 });
const auth = https.createSecureString({ input: "Basic " });
auth.appendSecureString({ secureString: par, keepEncoding: true });
https.get({ url: "myUrl", headers: { "Authorization": auth } });
```

A referência avisa: **"Secrets with these two Script IDs must be existing and allowed for this
script"** — o segredo precisa ser explicitamente permitido para o script/deployment. É passo de
setup, não de código.

### O achado que muda a Fase 0: SecureString não vai no corpo

| fato | linha |
|---|---|
| `https.post` → `options.body` é **`string \| Object \| Uint8Array`** | 35950 |
| `SecureString` **não** está entre os tipos aceitos de `body` | idem |
| os dois lugares documentados onde uma SecureString entra são **header** e **URL** | 32898-32945 (header) · 32975-32985 (URL) |

**Consequência:** não existe caminho por corpo JSON que preserve o segredo. Montar
`{"client_secret": "..."}` como string exige o valor em claro numa variável — e aí ele vaza no
primeiro `log.debug` do payload ou na primeira exceção com `JSON.stringify`. Guardar em Secrets
Management e depois interpolar em string é teatro de segurança.

Como o `POST /oauth/token` do motor exige as credenciais **no corpo** (`TokenRequestDto`,
`oauth.dto.ts:40`), ele precisa passar a aceitar **`client_secret_basic`** (RFC 6749 §2.3.1).
Pedido em `HANDOFF-FISCALPLATFORM.md` item 9. O `fp_client.js` já está escrito para Basic e
**falha alto** com mensagem acionável enquanto o motor não aceitar — sem fallback por corpo, de
propósito: fallback que funciona hoje com segredo em claro é o que acaba em produção.

### Timeout: fixo, não configurável

Citação literal de `https.post(options)` (linhas 37486-37489), idem `https.request` (36476-36479):

> "If negotiating a connection to the destination server exceeds **5 seconds**, a connection
> timeout occurs. If transferring a payload to the server exceeds **45 seconds**, a request
> timeout occurs." → `SSS_REQUEST_TIME_EXCEEDED`

**`N/https` não tem parâmetro de timeout.** O `options.timeout` que aparece na referência (default
30.000 ms, e não se pode especificar MENOR que isso) pertence ao **`N/documentCapture`** — confirmado
pelo cabeçalho de página `N/documentCapture Module 373` acima da tabela (linha 22453).

Isso **corrigiu a guarda 2** do `fp_ue_simular.js` e do `PLANEJAMENTO.md` §3.1, que pediam "timeout
curto e explícito": não é implementável. Motor inalcançável bloqueia o save ~5 s; motor lento a
responder pode bloquear 45 s, sem mitigação por timeout.

### Sem `sleep` em script de servidor

Varredura no PDF inteiro: **nenhuma API de sleep/wait**. Logo não há backoff dentro de uma chamada,
e busy-wait queimaria governança sem esperar. `fp_client.js` faz **uma tentativa por chamada**;
repetição é de quem orquestra (Map/Reduce reprocessa a unidade, Suitelet devolve ao usuário).

### Outros fatos úteis colhidos

- `https.post` sem header `Content-Type` recebe um default do NetSuite (linha 32434).
- `https.requestRestlet({scriptId, deploymentId, method, body})` existe desde 2023.1 (linha 37015)
  — é o que o AVLR usa para buscar token (§5.3).
- Governança de `https.get`/`post`: **10 unidades** por chamada.

## 6. SuiteApps disponíveis em disco

`~/Downloads/suitesuccess/` — `Bundle 237702.zip`, `Bundle 436209.zip`,
`NETSUITE_BRAZIL_LOCALIZATION.md` (100 KB), e os zips:
`com.netsuite.brazillocalization` (10,5 MB), `brazilcertificationtaxauth`,
`brazilfasttaxenginedatarecords`, `brazilreports`, `edoccertificationservice`, `fasttaxengine`,
`latamfilebuilder`, `localizationassistant`, `accountmatchingreport`, `appperfmgmt`, `cash360`,
`item360`, `supply360`, `com.suitesuccess.{brff,configdataimport,ffstd,procurementworkbooks}`.

**São a fonte para os próximos perfis** — `oracle_brl` sai de `com.netsuite.brazillocalization.zip`
pelo mesmo método do §3.

Projetos SDF em disco (`~/OneDrive/NetSuite/`): `avalara-brazil-suitesuccess-tco`,
`nfse-avalara-connector`, `ns-br/Avatax_V2`, `atp-cashflow`, `atp-van-accesstage`,
`bit-customizations-agroclub`, `AccountCustomization`, `Localization Grvppe Solvit`.

---

## 6.1 Documentação oficial em `doc/` deste repositório

Ainda **não lida** — registrada aqui porque é a autoridade para vários itens do §7:

| PDF | responde |
|---|---|
| `NetSuiteSuiteTaxEngineSetupGuide.pdf` | §7.1 (SuiteTax) e o caminho de *tax detail* da Fase 5 |
| `Taxation.pdf` | idem — tributo legado × SuiteTax |
| `REST_Web_Services_Records_Guide.pdf` | §7.3 (ids nativos de transação), substituindo o Records Browser que respondeu 404 |
| `CustomGLLinesPlugIn.pdf` | reflexo contábil da Fase 5 sem tocar em lançamento manual |
| `MultiBookAccounting.pdf` | impacto de multi-book no reflexo contábil |
| `AccountSetupGuide.pdf`, `ItemRecordManagement.pdf`, `InventoryManagement.pdf`, `REST_Web_Services.pdf` | cadastro e integração |

## 7. Aberto — o que ainda não foi medido

| # | o que | bloqueia |
|---|---|---|
| 1 | SuiteTax habilitado na `tstdrv1647270`? SuiteApps de localização instalados e versão? | Fase 5 |
| 2 | Subsidiárias e CNPJ de cada; filial correspondente existe no motor (`branches` + `companies`)? | `customrecord_fp_config` |
| 3 | Ids **nativos** de transação, no Records Browser da versão da conta (`invoice.html` do browser 2018_1 e 2024_1 responderam 404 nos caminhos tentados) | `fp_fields.NATIVOS` |
| 4 | Tipo / gravabilidade / valores dos campos do 436209 (§3.5) | ativar perfil `oracle_ei` |
| 5 | Prefixo de publisher (`psg_`, `avlr_`) é criável por projeto nosso? | cenário de substituição |
| 6 | URL pública HTTPS do motor, com cert de CA | Fase 0 |
| 7 | Client OAuth do bundle registrado (`client_id` / `client_secret`) | Fase 0 |
| 8 | `idExterno` é único por filial ou global? (ler a constraint, não o docblock) | derivação do `idExterno` |
| 9 | Vocabulário de `natureza_operacao` do motor (`SELECT codigo, nome`) | list/record de natureza |
| ~~10~~ | ~~API de Secrets Management~~ | **FECHADO** — §5.5 |
| 11 | Códigos reais de `tipo_documento` no motor (`SELECT codigo FROM tipo_documento`), para reconciliar com `customlist_fp_tipodoc` | valor de `tipoDocumento` |
| 12 | O motor aceitar `client_secret_basic` no `/oauth/token` | **Fase 0** — handoff item 9 |

---

## 8. Custom GL Lines Plug-in — o manual, lido página a página (2026-09-22)

> Fonte: `doc\CustomGLLinesPlugIn.pdf` (release **2026.1**, 27/mai/2026, md5 `8ff20c1e…`) e
> `C:\Users\TI\Downloads\CustomGLLinesPlugIn.pdf` (release **2026.2**, 16/set/2026, md5 `00cb50c7…`).
> Os dois textos foram diferenciados por inteiro: **não há divergência de conteúdo** em assinatura,
> API, governança, balanceamento, tipos de transação ou tabelas de erro. Só muda boilerplate
> jurídico e o nome de uma seção. Números de página são os **impressos no cabeçalho**.

### 8.1 Assinatura e objetos

| fato | fonte |
|---|---|
| SuiteScript 2.x tem **um** parâmetro: `customizeGlImpact(context)`. Os 4 posicionais são do 1.0 e **não** são compatíveis | p.20, p.50 |
| `context` é `CustomGlLinesPluginContext`, propriedades **read-only**: `standardLines`, `customLines`, `transactionRecord`, `book` | p.50–51 |
| `transactionRecord` é do tipo **`ReadOnlyTransactionRecord`**, não `Record` | p.51, p.58 |
| "You cannot change this function signature" | p.20 |
| O único exemplo 2.x do manual declara `@NApiVersion 2.x` e `@NScriptType customglplugin` — **não há exemplo com 2.1**; a 2026.2 remete a "SuiteScript 2.1 API Governance" | p.51; p.11–12 |

### 8.2 `customLines` — atribuição, não setter

| fato | fonte |
|---|---|
| `addNewLine()` sem parâmetros devolve a `CustomLine`; `getLine(options)`; propriedade `count` | p.53 |
| **No 2.x não há setters.** `accountId`, `debitAmount`, `creditAmount`, `memo`, `entityId`, `classId`, `departmentId`, `locationId`, `isBookSpecific` são **propriedades atribuíveis** | p.53–57 |
| `debitAmount`/`creditAmount` são **string** e **têm de ser positivos**; arredondados à precisão da moeda | p.55 |
| `isBookSpecific = false` copia a linha para os books secundários; omitir ou `true` prende ao primário | p.56 |
| **Não existe subsidiária na `CustomLine`.** "You cannot distribute credits and debits across subsidiaries" | p.53–54, p.82 |
| Mínimo por linha: **conta e valor**. Sem eles: "Account cannot be empty" / "Debit/Credit cannot be empty" | p.82, p.86 |

### 8.3 `standardLines` — tudo read-only, e o que **não** dá para saber

| fato | fonte |
|---|---|
| `count` (propriedade) e `getLine({index})`. `getCount()`/`getLine(index)` são forma **1.0** | p.66; p.22–23 |
| `StandardLine` é **inteiramente read-only**: `accountId`, `amount`, `creditAmount`, `debitAmount`, `entityId`, `id`, `isPosting`, `isTaxable`, `locationId`, `memo`, `subsidiaryId`, `taxAmount`, `taxableAmount`, `taxItemId`, `taxType`, `classId`, `departmentId` | p.66–71 |
| ⚠ **NÃO HÁ como correlacionar uma standard line com a linha do sublist `item`.** Nenhuma propriedade de item, sublist ou número de linha existe. É a razão do rateio proporcional em `fp_gl_lines_plugin.js` | p.66–67 (lista completa) |
| Índice **0 é a linha-resumo**, com o total de débitos e créditos; não traz informação de imposto | p.68–69, p.82 |
| `count` conta **linhas ocultas** do GL Impact. Filtro literal do manual: `(debitAmount || creditAmount) && accountId` | p.66, p.82–83 |
| **Não dá para modificar standard line.** O plug-in "adds lines"; só `customLines` é mutável | p.1, p.52, p.66–71 |

### 8.4 `transactionRecord` e a armadilha do síncrono

| fato | fonte |
|---|---|
| `getValue({fieldId})`, `getSublistValue({sublistId, fieldId, line})`, `getLineCount({sublistId})`, `findSublistLineWithValue` — indexação a partir de **0** | p.59–62 |
| "You can only use functions to **read** values… You cannot write data to the transaction record" | p.58 |
| ⚠ **`getText` e `getSublistText` NÃO estão disponíveis na configuração SÍNCRONA** | p.60, p.61, p.64, p.65 |
| ⚠ Em modo **síncrono, criando** transação, **`transactionRecord.id` não existe**. No assíncrono existe mesmo na criação | p.58, p.11 |
| Sublist de **child custom record (recmach)**: **o manual não diz**. `sublists` devolve os ids de todas as sublists e `getSublistValue` aceita qualquer `sublistId` | p.58–61 |

### 8.5 Limites, execução e erro

| fato | fonte |
|---|---|
| **Governança: 1000 unidades** para o arquivo do plug-in | p.10, p.12, p.83 |
| `N/record` e **`N/query`** explicitamente suportados. **Não há lista de módulos não suportados**; `N/search`, `N/log` e `N/https` não são citados | p.11 |
| "searching yields better performance than loading" / "Limit the use of these APIs" | p.11–12, p.82 |
| **As custom lines fecham entre si**: "the total debits and credits **for the custom lines** don't balance" → "Transaction was not in balance. Total = {amount}" | p.82, p.84 |
| Limite de **quantidade** de custom lines: **o manual não diz** | — |
| Roda **no save**, síncrono por padrão; assíncrono se marcado | p.2–3, p.16 |
| **Roda de novo** quando há atualização de custo (COGS update) — o GL Impact pode mudar depois | p.4, p.94 |
| Roda **uma vez por accounting book**; `book` representa um book diferente a cada execução | p.10, p.51, p.2–3 |
| Se um plug-in falha, **os outros continuam rodando**; não há ordem de prioridade | p.17 |
| ⚠ Se exceção em modo síncrono **derruba o save**: **o manual não diz**. Só nomeia as mensagens | p.83–86 |
| Falha assíncrona vai para **Customization > Plug-ins > Review Custom GL Plug-in Executions** (Incomplete/Failed), com "Execute Selected" | p.94–95 |
| Atualizar implementação instalada: criar **nova implementação com outro nome**, não empurrar update | p.82 |
| Desinstalar **não remove** as custom lines já gravadas | p.16, p.95 |
| Entidade em linha AP/AR: vendor **não** vale em Accounts Payable, customer **não** vale em Accounts Receivable; entidade tem de ser da mesma subsidiária, mesma moeda e estar ativa | p.55–56, p.84–87 |

### 8.6 Plano de contas da `tstdrv1647270` — contas fiscais que existem

> Fonte: `C:\Users\TI\Downloads\ChartofAccounts597.xlsx`, exportado da própria conta, 2026-09-22.
> Internal ids na última coluna. **Não há conta de CBS, IBS nem IS** — hoje não trava nada, porque
> o motor devolve os três como `SEM_EFEITO`.

| número | conta | tipo | id |
|---|---|---|---|
| 1310.4 | ICMS on Purchases - Credit | Other Current Asset | 162 |
| 1310.5 | IPI on Purchases - Credit | Other Current Asset | 164 |
| 1310.8 | PIS on Purchases - Credit | Other Current Asset | 166 |
| 1310.9 | COFINS on Purchases - Credit | Other Current Asset | 167 |
| 1310.2 | COFINS Withheld on Sales - Recoverable | Other Current Asset | 160 |
| 1310.10 | PIS Withheld on Sales - Recoverable | Other Current Asset | 253 |
| 2310.7 | ICMS on Sales - Payable | Other Current Liability | 255 |
| 2310.8 | IPI on Sales - Payable | Other Current Liability | 257 |
| 2310.10 | PIS on Sales - Payable | Other Current Liability | 261 |
| 2310.2 | COFINS on Sales - Payable | Other Current Liability | 169 |
| 2310.4 | PIS Withheld on Purchases - Payable | Other Current Liability | 262 |
| 2310.5 | COFINS Withheld on Purchases - Payable | Other Current Liability | 170 |
| 5010.4 | ICMS - Sales Expense | Expense | 155 |
| 5010.1 | PIS - Sales Expense | Expense | 159 |
| 5010.2 | COFINS - Sales Expense | Expense | 153 |
| 5010.5 | IPI - Sales Expense | Expense | 156 |

### 8.7 SDF — `project:validate --server`, 2026-09-22

| fato | fonte |
|---|---|
| Projeto com `customglplugin` **exige** `<feature required="true">CUSTOMGLLINES</feature>` no manifesto | saída do validate; corrigido em `src/manifest.xml` |
| `custbody_fp_natureza` tinha `customfieldfilter` apontando para `customrecord_fp_natureza_operacao.custrecord_fp_transacao_no`, **campo que não existe** (o registro tem `custrecord_fp_descricao_no` e `custrecord_fp_entrada_saida`) — referência quebrada barrava o deploy | saída do validate; filtro removido |
| `customscript_fp_ue_simular` tinha `audslctrole` com `[SCRIPT_ID_NOT_SPECIFIED]`; com `allroles=T` a lista é redundante | saída do validate; limpo |
| Depois das três correções: **0 error(s), 5 warning(s)** — as 5 são features não declaradas (ASSEMBLIES, WORKORDERS, WEBSTORE, CRM) | `suitecloud project:validate --server` |

### 8.8 Ainda NÃO medido — e é o que falta para o plug-in ser confiável

| # | o que | como medir | bloqueia |
|---|---|---|---|
| ~~13~~ | ~~`BUILTIN.DF()` sobre campo List/Record~~ | **FECHADO** — ver §8.9 | — |
| ~~20~~ | ~~`rectype` de `othercustomfield` para Location~~ | **FECHADO** — `-103` é Location, §10.4 | — |
| 17 | `<defaultselection>` de campo SELECT: qual a sintaxe de referência ao `customvalue`? O texto literal passa no `validate` e **quebra no `deploy`** (medido 2026-09-22, `custrecord_fp_debito_origem_cc`). Hoje o campo vai sem default | tentar `[scriptid=customlist_fp_origem_conta.val_origem_conta_1]` num deploy de teste | conveniência de tela, nada funcional |
| 14 | O sublist `recmachcustrecord_fp_transacao_imp` é legível de dentro do plug-in (o manual não diz) | salvar uma transação com impostos e ler o Execution Log: "não legível aqui" indica queda no fallback | leitura no save de transação **nova** (sem `id`) |
| 15 | Exceção no plug-in síncrono derruba o save? | forçar erro num ambiente de teste | tamanho real da guarda 4 |
| 16 | IPI e ICMS-ST entram no `amount` da linha da Vendor Bill, ou como linha separada? | medir um payload de **entrada** real | se `CUSTO` e `RECUPERAVEL_INTEGRAL` lançam ou são nulos |

### 8.9 Medido contra a conta por SuiteTalk REST — 2026-09-22

> Método: OAuth 1.0a / TBA (HMAC-SHA256) contra
> `https://tstdrv1647270.suitetalk.api.netsuite.com/services/rest`, com as credenciais do
> `Consumer-Key-Client-ID.txt` (ignorado pelo git, `.gitignore:43` — conferido).
> Endpoint de consulta: `POST /query/v1/suiteql` com `Prefer: transient`.

| fato | como se sabe |
|---|---|
| ✅ **`BUILTIN.DF()` resolve campo List/Record de custom record nesta conta.** A query de `carregarRegua()`, rodada **verbatim**, devolve `natureza: "DEBITO"`, `sentido: "SAIDA"`, `compoe: "NAO"`, `debito_origem: "CONTA_FIXA"` — texto, não id | executada contra a conta |
| Nas mesmas linhas, `custrecord_fp_debito_cc` volta como **internal id** (`155`, `255`) — que é exatamente o que o plug-in põe em `line.accountId`. O plug-in não lê nome de conta em lugar nenhum | idem |
| Custom list é tabela SuiteQL pelo próprio scriptid, com colunas `id` e `name` | `SELECT id, name FROM customlist_fp_natureza_contabil` |
| ⚠ `customrecord_fp_imposto` foi carregado com o **código no `name`** (`ICMS`, `ICMS_ST`) e `custrecord_fp_codigo_impo` **vazio nos 31**. O JOIN do plug-in casa por `custrecord_fp_codigo_impo` e acharia zero regras | `SELECT id, name, custrecord_fp_codigo_impo FROM customrecord_fp_imposto` |
| Corrigido: os 31 registros receberam `custrecord_fp_codigo_impo = name` por `PATCH /record/v1/customrecord_fp_imposto/{id}` — 31 ok, 0 falhas | — |
| Internal id de lista, conferidos vivos: natureza `DEBITO=1 … ESTORNO_ST=12`; sentido `ENTRADA=1, SAIDA=2, AMBOS=3`; compõe `SIM=1, NAO=2, INDIFERENTE=3`; origem `CONTA_FIXA=1, CONTA_DA_LINHA=2, CONTA_DO_PARCEIRO=3` | — |
| Internal id das contas conferem com o exportado em §8.6 (155, 159, 153, 255, 261, 169, 257, 162, 166, 167, 164) | `SELECT id, acctnumber, accountsearchdisplayname FROM account` |
| **12 regras criadas** em `customrecord_fp_classificador_contabil` via `POST /record/v1/...`, e relidas pela query do plug-in: 12 de 12 | — |

> **Importante para o `BUILTIN.DF`:** medido em SuiteQL via REST, **não** de dentro do Custom GL
> Lines Plug-in. O manual não lista módulos não suportados, e `N/query` é explicitamente suportado
> (p.11) — mas a primeira execução real do plug-in ainda é a prova final.

---

## 9. Histórico do lançamento — a norma, e o que o `Memo` da custom line alcança (2026-09-22)

> Matéria normativa, não medição de código. Levantada porque o `Memo` que o
> `fp_gl_lines_plugin.js` escreve na custom line é o que vai para o campo de **histórico** da
> partida na ECD.

### 9.1 Não existe Lei Complementar sobre isso

A CF/88, art. 146, III, "b" reserva à LC as normas gerais sobre **lançamento** — mas é o
*lançamento tributário* do art. 142 do CTN, homônimo e não parente do lançamento contábil de
partidas dobradas. O CTN toca escrituração só nos arts. 195 e 197, para assegurar fiscalização e
guarda, nunca para dizer o que se escreve no histórico.

| norma | o que exige |
|---|---|
| **CC (Lei 10.406/2002), art. 1.184** | no Diário, tudo com "individuação, clareza e **caracterização do documento respectivo**" |
| **DL 486/1969, art. 2º** | escrituração "com individuação e clareza"; **§ 1º**: código ou abreviatura só é lícito "desde que estes constem de livro próprio" |
| **NBC ITG 2000, item 6, "d"** | o lançamento deve conter "histórico que represente a essência econômica da transação ou o código de histórico padronizado, **neste caso baseado em tabela auxiliar inclusa em livro próprio**" |
| **NBC ITG 2000, item 7** | "O registro contábil deve conter o número de identificação do lançamento em ordem sequencial **relacionado ao respectivo documento de origem** externa ou interna ou, na sua falta, em elementos que comprovem ou evidenciem fatos contábeis." |
| **NBC ITG 2000, item 8** | "A **terminologia** utilizada no registro contábil deve expressar a **essência econômica da transação**." |
| **NBC ITG 2000, item 11** | "Admite-se o uso de códigos e/ou abreviaturas, nos históricos dos lançamentos, **desde que permanentes e uniformes**, devendo constar o significado dos códigos e/ou abreviaturas no Livro Diário ou em registro especial revestido das formalidades extrínsecas de que tratam os itens 9 e 10." |

> **Fonte primária, lida 2026-09-22:** PDF da **Resolução CFC n.º 1.330/11** (Brasília, 18/03/2011,
> Ata CFC n.º 948), baixado de `www1.cfc.org.br/sisweb/SRE/docs/Res_1330.pdf` e extraído com
> `pdftotext -layout -enc UTF-8`. O próprio PDF abre dizendo: "A ITG 2000 foi alterada e consolidada
> em 5.12.14 como ITG 2000 (R1)". A audiência pública de revisão localizada na busca é de
> **06/11/2014**, prazo 03/12/2014 — é a que gerou essa consolidação. **Não há revisão pendente.**
>
> Consequência de desenho do item 6(d): histórico padronizado só é lícito **se existir a tabela
> auxiliar em livro próprio**. Na ECD essa tabela é o **I075**. Isso deixa de ser preferência de
> estilo e passa a ser o caminho normativamente seguro para qualquer sigla.

### 9.2 ECD — onde o histórico mora

> IN RFB 2.003/2021; Leiaute **9**, Manual Anexo ao **ADE Cofis nº 1/2026** (DOU 12/01/2026).

| fato | detalhe |
|---|---|
| O histórico está no registro **I250** (Partidas do Lançamento), campo **`HIST`**, tipo `C`, tamanho **65535** | o **I200** (Lançamento) **não tem** campo de histórico |
| Casa **1:1 com o `Memo` de cada linha de GL** — histórico é por partida, não por lançamento | favorável ao desenho do plug-in |
| `REGRA_HISTORICO_OBRIGATORIO`: pelo menos um entre **`COD_HIST_PAD`** (campo 07) e **`HIST`** (campo 08) | partida sem nenhum dos dois é erro no PVA |
| ⚠ Tabela de histórico padronizado é o **I075** (`COD_HIST` + `DESCR_HIST`) | **NÃO** é I050/I051/I052 — esses são plano de contas, plano referencial e códigos de aglutinação |
| Concatenação quando se usa padronizado + complemento: `DESCR_HIST` + `" "` + `HIST` | o `HIST` carrega só o que fica no fim |
| **`NUM_ARQ`** (campo 06 do I250) é o campo destinado a número/código do documento que comprova o lançamento | a chave de 44 dígitos cabe melhor ali que no `HIST` |
| Arquivo é **ASCII / ISO-8859-1**. O PVA rejeita no `HIST`: caractere `\|` (delimitador), não imprimíveis (0–31), espaçamento indevido | **não** há regra que rejeite histórico genérico ou repetido — o PVA não faz juízo semântico |
| Risco do histórico pobre não é rejeição, é depois: **Lei 8.218/1991, art. 12, II** (multa 5% da operação, limitada a 1% da receita bruta) e **Lei 8.981/1995, art. 47, II** / RIR/2018 art. 603 (arbitramento por escrituração imprestável) | — |

### 9.3 Alcance: só a ECD

**EFD-ICMS/IPI e EFD-Contribuições não consomem o `Memo`.** O que atravessa da contabilidade para
elas é a **conta** — registro **0500** e campo **`COD_CTA`** —, não o histórico. Os campos de texto
livre das EFDs têm outra origem: `0450`/`C110` vêm do `infAdic` da NF-e; `DESCR_COMPL_AJ` descreve
ajuste de apuração; `DESC_DOC_OPER` (F100) é da EFD-Contribuições. A ECF também não: recupera plano
de contas, saldos e mapeamento referencial, não o `HIST` do I250.

Rastreabilidade NF-e → escrituração **no lado fiscal** se faz pela chave no **C100**, que já vem do
próprio documento — não pelo memo.

### 9.4 Veredito sobre o `Memo` atual

`"FP · ICMS · DEBITO"` **não atende**:

1. **Não caracteriza o documento** (CC 1.184; DL 486/69 art. 2º; **ITG 2000 item 7**, que manda o
   registro ser "relacionado ao respectivo documento de origem") — sem número, série, chave ou
   participante, o lançamento é irrastreável a partir do Diário. É o defeito grave.
2. **`DEBITO` é redundante** — o indicador D/C é o campo 05 (`IND_DC`) do I250. Ocupa o campo da
   essência econômica com o que já está do lado.
3. **`FP` é sigla não declarada** (ITG 2000 item 11; DL 486/69 art. 2º § 1º). Proveniência do motor
   pertence ao custom record de retorno, não ao Diário.
4. **A terminologia não expressa a essência econômica** — **ITG 2000 item 8**, frase inteira
   dedicada a isso. `FP` não é termo contábil e `DEBITO` é o lado do lançamento, não a transação.
5. Forma: `·` é **U+00B7** e o arquivo é ISO-8859-1 → usar ASCII puro. `|` jamais.

### 9.5 O que trava a correção hoje

| fato | fonte |
|---|---|
| ⚠ **Nenhum script do bundle grava `DOC_CHAVE`, `DOC_NUMERO`, `DOC_SERIE` ou `DOC_PROTOCOLO`.** O caminho de simulação grava só `SIM_PAYLOAD`, `SIM_STATUS`, `SIM_RESUMO` e `DOC_ENTRADA_SAIDA` | `grep gravarLogico` em `fp_ue_simular.js`; as chaves existem no perfil mas não têm escritor |
| Logo, em transação **simulada** a nota não existe e o histórico só alcança `tranid`, participante, base e valor. Número/série/chave entram quando a emissão estiver ligada | — |
| ⚠ `getText`/`getSublistText` **não existem** no plug-in síncrono (§8.4) → o nome do participante exige consulta `N/query`, não `getText({fieldId:'entity'})` | manual p.60-61 |
| Base e alíquota vão para o histórico **copiadas do retorno por tributo**, nunca por divisão reversa. Conferido no retorno real: ICMS 12,00% × 5.143,66 = 617,24; PIS 0,65% e COFINS 3,00% sobre a **mesma** base 4.526,42 = 29,42 e 135,79 — batem exato | sublist `customrecord_fp_impostos`, ids 27-32 |
| A linha de GL é **agregada por tributo na nota inteira**: só imprimir alíquota se a nota tiver alíquota única para aquele tributo; havendo mais de uma, imprimir só a base total | consequência do agrupamento em `agrupar()` |

### 9.6 Ainda NÃO medido

| # | o que | bloqueia |
|---|---|---|
| 18 | Tamanho máximo do campo `Memo` da custom line, no Records Browser da versão da conta. O manual diz só `string`. Truncamento silencioso do NetSuite não pode cortar a chave de acesso pela metade | formato final do histórico |
| 19 | O extrator da ECD desta conta preenche `NUM_ARQ` (I250 campo 06)? Se sim, a chave sai do `HIST` e economiza 44 caracteres; se não, a chave **tem** de ficar no `HIST` | idem |

### 9.7 Histórico gerado — medido no GL Impact, 2026-09-22

Transação `id 2232`, `tranid 680`, plug-in em modo **síncrono**. Saída real:

```
5010.4 ICMS - Sales Expense      D 617,24   ICMS sobre vendas - doc 680 - base 5.143,66 aliq 12,00% - id 2232
2310.7 ICMS on Sales - Payable   C 617,24   ICMS sobre vendas - doc 680 - base 5.143,66 aliq 12,00% - id 2232
5010.1 PIS - Sales Expense       D  29,42   PIS sobre vendas - doc 680 - base 4.526,42 aliq 0,65% - id 2232
2310.10 PIS on Sales - Payable   C  29,42   PIS sobre vendas - doc 680 - base 4.526,42 aliq 0,65% - id 2232
5010.2 COFINS - Sales Expense    D 135,79   COFINS sobre vendas - doc 680 - base 4.526,42 aliq 3,00% - id 2232
2310.2 COFINS on Sales - Payable C 135,79   COFINS sobre vendas - doc 680 - base 4.526,42 aliq 3,00% - id 2232
```

| fato | consequência |
|---|---|
| ✅ **`transactionRecord.id` VEIO PREENCHIDO em modo síncrono** (`id 2232`) | a ressalva do manual (p.58: id ausente no síncrono ao CRIAR) **não** se manifestou aqui. Não prova o caso de criação — esta foi edição de transação existente —, mas o caminho normal está coberto. O `log.debug` de ausência continua no código como sonda |
| ✅ Seis linhas, três pares, fechando entre si. Nenhuma linha de CBS/IBS | `SEM_EFEITO` descartado antes do cadastro, como desenhado |
| ✅ Valores batem com o retorno: 5.143,66 × 12% = 617,24; 4.526,42 × 0,65% = 29,42; × 3% = 135,79 | base e alíquota copiadas do motor, não derivadas |
| Sem `NF-e <n>/<s>` e sem `chave` — o histórico traz `doc 680` (`tranid`) | esperado: a emissão não está ligada e não há documento fiscal a caracterizar. Entram no save da emissão |
| ⚠ Persiste no mesmo GL a linha `7001 VAT on Sales BR` R$ 14,00, do **Legacy Tax** | dois motores postando imposto. Enquanto o `taxitem` da linha não for 0%/isento, o razão carrega passivo de VAT inexistente e `2310.7` não concilia com a apuração. É setup de tax code, não código |

**Pendência 18 (teto do `Memo`) segue aberta**, mas com folga medida: o maior histórico gerado tem
68 caracteres; com NF-e e chave passa a ~121. O limite prudente no código é 255.

---

## 10. `company → branch` ↔ `subsidiary → location` — o que existe de standard (2026-09-22)

> Decisão do Rogerio: o cadastro do bundle espelha o modelo do FiscalPlatform — `company` é a
> **Subsidiary** e `branch` é a **Location**, com os campos criados nesses registros standard em
> vez de num custom record próprio. E **a chave é o CNPJ, não UUID**.

### 10.1 Location — medido no catálogo de metadados do REST

> `GET /services/rest/record/v1/metadata-catalog/location`, `Accept: application/schema+json`.

Os **28** campos: `classTranslation, defaultAllocationPriority, docNumbering, externalId, fullName,
id, includeInSupplyPlanning, internalId, inventoryBalance, isInactive, lastModifiedDate, latitude,
links, locationType, logo, longitude, mainAddress, makeInventoryAvailable,
makeInventoryAvailableStore, name, parent, refName, returnAddress, subsidiary, timeZone,
tranNumbering, tranPrefix, useBins`.

| fato | consequência |
|---|---|
| ✅ **`location.subsidiary` já existe** — a relação branch → company é nativa | não se cria campo de vínculo; o modelo do FiscalPlatform já tem correspondente standard |
| ✅ `location.mainAddress` e `returnAddress` existem | endereço da filial é nativo |
| ⚠ **NÃO existe campo nativo de CNPJ, tax id, federal id ou inscrição na Location** (busca por `cnpj\|tax\|federal\|ident\|registration\|vat\|document` nos 28 campos: zero) | o CNPJ da filial **tem** de ser campo customizado na Location |
| `tranNumbering` / `tranPrefix` / `docNumbering` são numeração do NetSuite | **não** confundir com numeração fiscal, que é da plataforma (`fiscal_serie`) |

### 10.2 Subsidiary — não mensurável por REST

`GET /record/v1/metadata-catalog/subsidiary` → **404 "Record type 'subsidiary' does not exist"**. O
catálogo expõe **158** record types e Subsidiary não está entre eles (só
`customersubsidiaryrelationship` e `vendorsubsidiaryrelationship`). Os campos do Subsidiary têm de
ser conferidos no **Records Browser** ou no formulário — em especial se o CNPJ já existe como campo
nativo ali antes de se criar um customizado.

### 10.3 Limite do papel da integração TBA — medido

O papel do token em `Consumer-Key-Client-ID.txt` **não enxerga** os registros abaixo por SuiteQL;
custom records e `account` funcionam normalmente.

| tabela | resultado |
|---|---|
| `transaction` | `SELECT COUNT(*)` devolve **0** — e a transação 2232 existe (tem impostos filhos e GL) |
| `location` | `SELECT *` devolve **0 linhas** — e existe "Localidade Produto TB" no GL |
| `subsidiary` | erro 400: "Record 'subsidiary' was not found" |

Consequência: inventário de campo standard **não** se faz por este token. Vai por metadata-catalog
(quando o record type estiver exposto) ou pelo Records Browser.

### 10.4 O que o deploy faz e o que não faz — medido em 2026-09-22, depois do deploy

> Método: REST SuiteQL e `metadata-catalog`, contra a conta, depois do `project:deploy`.

| fato | como se sabe |
|---|---|
| ✅ **`rectype` = `-103` É Location.** `custrecord_fp_cnpj_filial` e `custrecord_fp_serie_filial` aparecem nas propriedades de `GET /record/v1/metadata-catalog/location` | fecha a pendência 20 |
| ✅ `rectype` = `-117` é Subsidiary | objeto `custrecord_avlr_client_id` importado da conta |
| ✅ **O deploy APAGA campo de custom record removido do projeto.** Os 6 campos do classificador (`debito_cc`, `credito_cc`, as duas origens, `sentido_cc`, `sem_lancamento_cc`) sumiram sozinhos | `SELECT <coluna>` devolve 400 para cada um |
| ✅ **O deploy APAGA custom list removida do projeto.** `customlist_fp_sentido` sumiu | `SELECT ... FROM customlist_fp_sentido` → erro |
| ⚠ **O deploy NÃO apaga o registro inteiro.** Isso continua sendo da UI | — |
| ⚠ **ARMADILHA DE MEDIÇÃO: `SELECT *` pelo REST OMITE coluna nula.** Coluna ausente na resposta **não** significa campo inexistente. Custou um alarme falso aqui: `custrecord_fp_cclasstrib_imp` "sumiu" da listagem e nunca foi removido — só estava vazio | teste correto é `SELECT <coluna>`: **400** se o campo não existe, **200** se existe e está nulo |
| ✅ 7 campos novos chegaram: 4 no classificador (`perna_cc`, `conta_tributo_cc`, `contrapartida_origem_cc`, `contrapartida_cc`) e 3 em `customrecord_fp_impostos` (`perna_imp`, `geralancamento_imp`, `razaoperna_imp`) | `SELECT <coluna>` → 200 em todos |
| ✅ 12 regras antigas apagadas e **8 novas criadas**; relidas pela query de `carregarRegua()` do plug-in: 8 de 8 | — |

### 10.5 A régua carregada hoje

| imposto | natureza | perna | compõe | conta do tributo | contrapartida |
|---|---|---|---|---|---|
| ICMS | DEBITO | C | NAO | 255 (2310.7) | 155 (5010.4) |
| PIS | DEBITO | C | NAO | 261 (2310.10) | 159 (5010.1) |
| COFINS | DEBITO | C | NAO | 169 (2310.2) | 153 (5010.2) |
| IPI | DEBITO | C | SIM | 257 (2310.8) | `CONTA_DO_PARCEIRO` |
| ICMS | RECUPERAVEL_INTEGRAL | D | NAO | 162 (1310.4) | `CONTA_DA_LINHA` |
| PIS | RECUPERAVEL_INTEGRAL | D | NAO | 166 (1310.8) | `CONTA_DA_LINHA` |
| COFINS | RECUPERAVEL_INTEGRAL | D | NAO | 167 (1310.9) | `CONTA_DA_LINHA` |
| IPI | RECUPERAVEL_INTEGRAL | D | SIM | 164 (1310.5) | `CONTA_DO_PARCEIRO` |

**Não há regra de `CUSTO` nem de `ST_JA_RECOLHIDO`, e está certo:** a plataforma devolve
`geraLancamento: false` para elas (`sentido-do-lancamento.ts`, `SEM_PARTIDA_PROPRIA`), e o plug-in
descarta antes de consultar o cadastro. Eram 12 regras no modelo antigo; são 8 agora.

---

## 11. Legacy Tax — o motor nativo postando em paralelo (2026-09-22)

> Por que isto importa: a conta roda **Legacy Tax**, não SuiteTax. O Legacy Tax é modelo de sales
> tax americano — **um tributo por linha, uma alíquota, um `taxitem`**. Não existe forma de
> representar ICMS + PIS + COFINS + IPI na mesma linha, muito menos somar CBS e IBS. É a razão
> estrutural de o bundle contabilizar por Custom GL Lines em vez de por tax code.

### 11.1 O sintoma, e de onde vinha

Numa fatura de teste (`tranid 680`, item a R$ 100 × 2 = R$ 200) o razão saía assim:

```
1100 Accounts Receivable   D 186,00
4000 Sales                 C 200,00
7001 VAT on Sales BR       D  14,00      ← ninguém pediu
```

O `7001 VAT on Sales BR` é `OthCurrLiab` (id 136, medido em `account.accttype`). Um **débito** numa
conta de passivo, sem obrigação por trás.

A linha do item explica: `Tax Code VAT_BR:UNDEF-BR`, `Tax Rate 0.0%`, **`Tax Amt −14,00`**,
`Gross Amt 186,00`. O valor é **negativo** — é retenção, e reduz o bruto de 200 para 186. Daí
`AR = 200 − 14`.

| fato | consequência |
|---|---|
| O tax code é **`UNDEF-BR`**, cuja descrição na própria conta é *"Used when NetSuite cannot determine the appropriate tax code for a transaction"* | a transação **não tem** tax code resolvido; caiu no fallback, e o fallback está retendo |
| `Tax Rate` mostra **0.0%** e `Tax Amt` mostra **−14,00** | incoerência do próprio registro: o grupo `VAT_BR` traz um componente que a coluna de rate não exibe |
| ⚠ **O valor acompanha o `Cost Estimate Type` do item.** Com `Average Cost` (Est. Extended Cost 2,00) → `Tax Amt −14,00`. Com `Custom` e custo 0,00 → `Tax Amt 0,00` e `Gross Amt 200,00` | medido nas duas versões da mesma linha |

### 11.2 O contorno pelo custo **não** é conserto

Zerar o `Cost Estimate Type` cala o imposto e **mente na margem**:

```
antes:  Est. Extended Cost 2,00   Est. Gross Profit 198,00    99,0%
depois: Est. Extended Cost 0,00   Est. Gross Profit 200,00   100,0%
```

O custo real continua indo ao razão por `5000 Purchases / 1200 Inventory`, então razão e estimativa
passam a discordar, e o relatório de rentabilidade fica errado. **Serve para sandbox; não serve para
valer.** O conserto de raiz é dar um tax code resolvido à linha — aí o `Tax Amt` fica 0 sem falsear
custo.

### 11.3 Por que o plug-in estorna, e por que isso é rede e não conserto

**Standard line é read-only** (manual p.66-71): não há como impedir a linha do motor nativo de
nascer, nem alterá-la. Sobra emitir o par inverso.

O estorno é cadastrado na **subsidiária**, com duas contas, e **zero heurística**:

| campo | valor nesta conta |
|---|---|
| `custrecord_fp_conta_imposto_nativo` — *FP - Conta do Motor Nativo (a zerar)* | `7001 VAT on Sales BR` (id 136) |
| `custrecord_fp_conta_estorno_contra` — *FP - Conta que Recebe o Estorno* | `4000 Sales` (id 55) |

Por que `4000 Sales` e não outra: o nativo reconheceu receita de 200 mas o cliente deve 186.
Debitando `4000`, a receita cai para 186 e volta a bater com o exigível — **CPC 47 item 47**, a
receita se mede pela contraprestação a que a entidade tem direito. `1100 AR` faria o cliente dever
200, contrariando o total da nota; `5010.4` duplicaria a dedução que o FiscalPlatform já lança.

Em branco, não estorna — default seguro.

### 11.4 A guarda de inversão, e o erro que ela existe para pegar

⚠ **Medido:** com os dois campos **trocados** no cadastro (nativa = `4000 Sales`), o plug-in zerou a
**receita inteira** — `D 4000 200,00 / C 7001 200,00` — e **nada reclamou**, porque o par fechava. O
rótulo original (*"Conta do Imposto Nativo a Estornar"*) lia como "de onde sai o estorno" e induziu
a inversão.

Dois consertos:

1. Rótulos que não invertem: *"Conta do Motor Nativo (a zerar)"* e *"Conta que Recebe o Estorno"*.
2. **Guarda por tipo de conta**: motor de imposto não posta em conta de **receita**. Se a conta
   apontada for `accttype = Income`, o plug-in **recusa** e diz que os campos estão trocados. O tipo
   vem na mesma consulta das duas contas, para não gastar segunda ida ao banco (governança do
   plug-in é 1000 unidades, manual p.83).

Tipos medidos nesta conta: `7001` = `OthCurrLiab`, `4000` = `Income`, `2310.7` = `OthCurrLiab`,
`5010.4` = `Expense`, `1100` = `AcctRec`.

### 11.5 Estado final do razão, conferido

Com o estorno ativo e o `Tax Amt` ainda em −14, o GL fechou assim: débitos **997,45** = créditos
**997,45**; `7001` zera (D 14 padrão, C 14 estorno) e `4000` fica 186, igual ao recebível. Com o
`Cost Estimate Type` em `Custom`, o −14 não nasce e o estorno não tem o que estornar — as seis
linhas do FiscalPlatform saem sozinhas.
