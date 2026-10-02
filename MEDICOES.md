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
| 14 | O sublist `recmachcustrecord_fp_transacao_imp` é legível de dentro do plug-in (o manual não diz). **Desde 2026-10-02** o `lerImpostos` loga `sublista · N` ou `consulta · N`: criar pela TELA uma invoice com simulação (por REST a guarda 3 não simula CREATE) e ler o log | salvar uma transação com impostos e ler o Execution Log: "não legível aqui" indica queda no fallback | leitura no save de transação **nova** (sem `id`) |
| ~~15~~ | ~~Exceção no plug-in síncrono derruba o save?~~ | **FECHADO pelo código (2026-10-02)** — `customizeGlImpact` envolve todo o `executar` em try/catch (`fp_gl_lines_plugin.js`, guarda 4): exceção vira `log.error` e o save segue sem as custom lines. Erro de carga do módulo ficaria de fora, e esse o `validate` pega | — |
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

#### 10.3.1 Integração nova (`Consumer Key  Client ID-1.txt`) — medido em 2026-09-30

> Mesmo método da §8.9 (TBA HMAC-SHA256, `tstdrv1647270`), mesma hora, os dois arquivos.
> O token antigo (`Consumer-Key-Client-ID.txt`) agora devolve **401 `INVALID_LOGIN`** em tudo:
> revogado ou desativado. O novo autentica.

| sonda | resultado |
|---|---|
| `GET /record/v1/metadata-catalog` | **37** record types (eram 158): `invoice`, `salesorder`, `vendorbill`, `purchaseorder`, `creditmemo`, `itemreceipt`, `itemfulfillment`, `transferorder`, `vendorreturnauthorization`, `customerpayment`, e as `customlist_fp_*` |
| SuiteQL por tipo: `FROM invoice` / `vendorbill` / `salesorder` / `purchaseorder` | ✅ **200** — 130 vendorbill, 27 salesorder, 36 purchaseorder |
| `GET /record/v1/invoice/4` (por id) | ✅ **200**, registro completo |
| SuiteQL `FROM customlist_fp_natureza_contabil` | ✅ 200 |
| SuiteQL `FROM transaction`, `transactionline` | ❌ 400 "Record not found" |
| `GET /record/v1/invoice?limit=2` (listagem) | ❌ 400 — a listagem usa a busca de `transaction`: "INSUFFICIENT_PERMISSIONS" |
| `location`, `subsidiary`, `account`, `employee`, `customer`, `item` | ❌ 400 — **`account` regrediu** (o token antigo lia) |
| `customrecord_fp_imposto`, `_impostos`, `_classificador_contabil` | ❌ 400 — **regrediu** (o token antigo lia e escrevia) |

Leitura: o papel novo tem permissão de **transação por tipo** e de custom list, e nada de lista
standard nem de custom record. Para fechar §10.3 falta no papel: *Lists > Accounts*, *Locations*,
*Subsidiaries*, *Customers*, *Items*, *Find Transaction* (libera `transaction`/`transactionline` e a
listagem REST) e *Custom Record Entries* (ou a permissão por record type em cada `customrecord_fp_*`).

**Correção, mesmo dia:** *Custom Record Entries* o papel (`customrole1075`) já tinha, e não adianta:
os nove `customrecord_fp_*.xml` são `<accesstype>USEPERMISSIONLIST</accesstype>` com só
`ADMINISTRATOR` na lista (ex.: `customrecord_fp_imposto.xml:213`). Os nove foram então postos na aba
*Custom Record* do papel, em Full, e a sonda repetida devolveu **200 em todos**: `imposto` 31,
`impostos` 6, `classificador_contabil` 8, `natureza_operacao` 69, `pais` 257, `di`/`pagamento`/
`reboque`/`volume` 0. Os números de `imposto` e `classificador_contabil` batem com os da §10.4.

⚠ **Ainda NÃO medido:** se o próximo `project:deploy` mantém esse acesso. O XML de cada record
leva a lista `<permissions>` só com `ADMINISTRATOR`, e o deploy regrava o objeto. Depois do deploy,
repetir `SELECT COUNT(*) FROM customrecord_fp_imposto` com este token: 400 quer dizer que o acesso foi
apagado.

Depois de preenchida a aba *Lists* do papel (Accounts, Customers, Employees, Items, Locations,
Subsidiaries, Classes), mesma data: ✅ `account` 178, `location` 3 (4 = "GROUP LINK O.N.E. MATRIZ -
SP", 5, 6), `subsidiary` 4 (1 Parent Company, 2 Servicos, 3 Produtos, 4 Produtos - V3), `customer`
14, `item` 14. ❌ `vendor` (Vendors não está na aba), `employee` (400 apesar de Employees Full), e
`transaction`/`transactionline` e a listagem REST — falta *Find Transaction* na aba *Transactions*.

Depois de *Find Transaction*, mesma data: ✅ `transaction` 1057, `transactionline` 9754, a 2232 da
§10.3 aparece (`WHERE id = 2232` → 1), `GET /record/v1/invoice?limit=1` → 200. **A §10.3 está
fechada** para o que o bundle lê. Seguem ❌ só `vendor` e `employee`. Com *Vendors* na aba *Lists*:
✅ `vendor` 9. Resta ❌ só `employee`, que o bundle não lê. Repetido na sequência: ✅ `employee` 14
(SuiteQL e `GET /record/v1/employee`), `entity` 38 — o que abriu foi **Employee Record**, permissão
distinta de *Employees*: esta sozinha não libera a tabela `employee`. **Nenhuma sonda da §10.3 segue fechada.**

### 10.4 O que o deploy faz e o que não faz — medido em 2026-09-22, depois do deploy

> Método: REST SuiteQL e `metadata-catalog`, contra a conta, depois do `project:deploy`.

| fato | como se sabe |
|---|---|
| ✅ **`rectype` = `-103` É Location.** `custrecord_fp_cnpj_filial` e `custrecord_fp_serie_filial` aparecem nas propriedades de `GET /record/v1/metadata-catalog/location` | fecha a pendência 20 |
| ✅ `rectype` = `-117` é Subsidiary | objeto `custrecord_avlr_client_id` importado da conta |
| ✅ **O deploy APAGA campo de custom record removido do projeto.** Os 6 campos do classificador (`debito_cc`, `credito_cc`, as duas origens, `sentido_cc`, `sem_lancamento_cc`) sumiram sozinhos | `SELECT <coluna>` devolve 400 para cada um |
| ✅ **O deploy APAGA custom list removida do projeto.** `customlist_fp_sentido` sumiu | `SELECT ... FROM customlist_fp_sentido` → erro |
| ⚠ **O deploy NÃO apaga o registro inteiro.** Isso continua sendo da UI | — |
| ⚠ **E nem sempre apaga o campo.** Medido em 2026-09-30: `custrecord_fp_di_transacao` e `custrecord_fp_di_numero_item`, tirados do `customrecord_fp_di.xml` em `c4de117`, **seguem na conta** depois do deploy desse commit (o `fp_md_map_simular.js` da conta é o dele, byte a byte). Não se sabe o que difere do caso dos 6 campos do classificador. Depois de deploy que remove campo, conferir com `SELECT <coluna>` | `customfield` e `SELECT` por REST |
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

---

## 12. Armadilhas de SuiteScript que custaram deploy, medidas em 2026-09-23

| o que | a prova | a regra que fica |
|---|---|---|
| **Nada de API no corpo do `define`** | `var CONTEXTOS_BLOQUEADOS = [runtime.ContextType.CSV_IMPORT, ...]` derrubou o script inteiro: `SUITESCRIPT_API_UNAVAILABLE_IN_DEFINE — All SuiteScript API Modules are unavailable while executing your define callback` | O módulo é injetado, mas **tocá-lo antes de o callback terminar é proibido, mesmo para ler um enum**. Constante que depende de `N/*` vira função |
| **`N/cache` e `N/file` não existem em Client Script** | `MODULE_DOES_NOT_EXIST: Module does not exist: N/cache.js`, e o objeto do client script falhou na **criação**, não em runtime | Foi o que fez os perfis virarem módulo AMD |
| **`search.create()` é preguiçoso** | `SSS_INVALID_SRCH_COL` nasce no `.each()`, não no `create()`. `try` em volta só da criação deixava o erro subir até o `beforeSubmit` e derrubar o save | `create`, `run` e `each` no mesmo `try` |
| **Saved search e SuiteQL não veem o mesmo** | `custitem_fp_servico_lc116` aplica só a Service: coluna **inválida** em `search.create({type:'item'})` mesmo existindo; `SELECT` no SuiteQL devolve 200 | Lookup de item por SuiteQL |
| **`getSubrecord` de endereço devolve `undefined`** no `beforeSubmit` | Payload saía sem `numero`, `municipio` e `uf` com o endereço preenchido na tela | Endereço por SuiteQL em `transactionshippingaddress` |
| **`getSublistText` devolve `undefined`** em parte dos contextos | Unidade saía vazia sem nada acusar | Texto de lista por SuiteQL em lote |
| **SuiteQL não aceita alias no `WHERE`** | `internalid AS id ... WHERE id IN (2)` → **400**; `WHERE internalid IN (2)` → 200 | Coluna de filtro separada do SELECT |
| **`SELECT *` do SuiteQL omite coluna nula** | `custrecord_fp_cclasstrib_imp` "sumiu" da listagem e nunca foi removido | Existência se testa com `SELECT <coluna>`: 400 não existe, 200 existe |
| **`maxlength` trunca em silêncio** | CNPJ com máscara (18 chars) num campo de 14 virou `10.664.687/000` → 11 dígitos | Campo de CNPJ com 18, e guarda de 14 dígitos no mapeador |
| **`scriptcustomfield` de pasta é INTEGER** | `selectrecordtype -10` passou no validador e estava errado: `-10` é o **id da pasta** Attachments Received, não um tipo de registro | `file.create` quer o id da pasta; os dois espaços de numeração não se misturam |
| **`setting` de parâmetro de script** | `SCRIPT`, `DEPLOYMENT` e `ENTRY` recusados pelo validador; **`COMPANY`** aceito | Preferência de empresa |
| **`transactioncolumncustomfield` não aceita** `checkspelling`, `globalsearch`, `isparent`, `colreturnauthorization`, `colvendorreturnauthorization` | avisos do `project:validate --server` | — |
| **`othercustomfield` não aceita** `availabletosso`, `ismatrixoption` | idem | — |
| **`rectype` de `othercustomfield`** | Location `-103`, Subsidiary `-117`, Account `-112`, Role `-118`, **Address `-289`** | Sondar chutando não acha: `-289` não estava entre os onze que testei |
| **O deploy APAGA** campo de custom record e custom list removidos do projeto | os 6 campos do classificador e a `customlist_fp_sentido` sumiram sozinhos | Só o **registro inteiro** sobrevive e precisa de UI |

## 13. Cenários de payload criados por REST — 2026-09-30

> Método: token TBA da §10.3.1, `POST /record/v1/{salesorder|invoice}` e releitura por SuiteQL.
> Todas em `location` 4 (única com CNPJ), memo `FPTESTE Snn ...`, e *Info ao contribuinte* =
> `APAGUE` — apagar esse texto é a mudança que faz a guarda 4 deixar o EDIT simular.

| cen. | id | tipo | o que exercita |
|---|---|---|---|
| S01 | 2233 | SO | todo campo de corpo (transporte, retenção completa, veículo com placa `abc-1d23`, vagão, balsa, indPres, infAdic); L1 com todas as colunas de linha; L2 CFOP `61a2`, frete 0, ZFM tipo 3; 3 pagamentos (cartão completo, dinheiro com bandeira que NÃO deve ir, 99 com descrição); 6 reboques (corte em 5); 2 volumes (lacres `L1, L2 ,,L3`) |
| S02 | 2241 | INV | serviço, exportação completa: IBGE + nome (nome NÃO deve ir), UF `sp`, país 1058, resultado `us` + consumo; dedução de material; data 2023-11-14 (único período aberto) |
| S03 | 2239 | SO | só nome do município; país `BR` (ISO no lugar do BACEN → `digitos` zera); resultado sem consumo (aviso) |
| S04 | 2240 | SO | consumo sem resultado (aviso); IBGE de 6 dígitos; UF `S.`; sem natureza |
| S05 | 2236 | SO | devolução: chave + item de origem; chave sem item (aviso); item sem chave (não vai) |
| S06 | 2235 | SO | DI 1 em duas linhas com adições diferentes (clone), seq omitida → 1; DI 101 completa; DI 201 sem adição na linha |
| S07 | 2237 | SO | natureza de linha ≠ cabeçalho e linha calada; modFrete 9 só com vagão/balsa; retenção incompleta (aviso); débito sem tpIntegra, 99 sem descrição (avisos), pagamento sem forma (pulado); reboque sem placa e volume vazio (pulados) |
| S08 | 2234 | SO | sem natureza, só CFOP; placa sem modalidade (transporte não vai); NFC-e; indPres 0 |
| S09 | 2238 | SO | ZFM tipo 1, tipo 4, `0` (vai, é valor) e não escolhido (não vai) |

DIs de apoio (`customrecord_fp_di`): **1** marítima sem AFRMM + conta e ordem sem CNPJ (dois
avisos), **101** aérea por encomenda completa, **201** marítima com AFRMM por conta própria.

Medido no caminho:

| fato | como se sabe |
|---|---|
| `fp_ue_simular` só está deployado em **SALESORDER** e **INVOICE** — os outros seis de `TIPOS` nunca simulam | `customscript_fp_ue_simular.xml` |
| ⚠ `/simular` leva só `montar()`: transporte, reboque, volume, pagamento, `indPres`, `infAdic*` estão só em `montarEmissao()` — conferir esses exige o `/emitir` (hoje chumbado, ver abaixo) | `fp_md_map_simular.js:133-179` |
| POST de transação pelo REST **ignora as sublistas `recmach`** (204, zero filhos) — filho vai como registro próprio com o campo de vínculo | releitura por SuiteQL |
| Limites que barram máscara na origem: `ret_cmunfg` 7, `mun_prestacao` 7, `pais_prestacao` 4, `uf_prestacao` 2, `custcol_fp_cfop` 4, `pag_tband` 2, `reb_placa` 8 | 400 do REST, `<maxlength>` do XML |
| PERCENT pelo SuiteQL volta fração: `ret_picmsret` 12 → `0.12` | releitura |
| **`custbody_fp_natureza` tem filtro por `custrecord_fp_transacao_no` NA CONTA**, que o projeto não tem (§8.7 o removeu). Só a 64 estava marcada; marcadas 16, 3, 39, 24, 4 com Estimate/Invoice/Sales Order para os cenários. A coluna de linha não filtra | 400 "Invalid Field Value"; multiselect lido por REST |
| ⚠ **Guarda 3 NÃO segura EDIT por REST.** CREATE por REST não simulou (nenhum arquivo em 2234–2241); o PATCH de `custbody_fp_infadic_contrib` na 2233 (`RWS`, 09:35:45) simulou, marcou `numeroItem` e anexou payload/retorno | `systemnote` + `file` |
| Retorno da 2233 (II, IPI_IMP… sobre 49.320,54, só na linha 1) **não é do motor**: é a resposta chumbada de `fp_client.chumbado()`, que `simularNota` e `emitir` devolvem sem rede. Com o cliente chumbado, **só o payload enviado se confere**; a resposta é sempre a mesma | `fp_client.js:98`, `:297-299`, `:309-319` |
| Por isso `/emitir` também **não transmite nem consome numeração** hoje — o botão de emissão monta e grava `FP-<tipo>-<id>-emissao-payload.json`. É o caminho para conferir transporte, pagamento, `indPres` e `infAdic*`. Ordem: simular antes, porque a persistência grava a chave chumbada e a guarda 6 barra simular depois | idem; `fp_ue_simular.js:504` |

### 13.1 O que o REQUEST tem de trazer — gabarito, lido do mapeador

> Em todas: `cnpjEmpresa: "10664687000113"`, `destinatario` do cliente 28 (Manaus, AM, CNPJ
> `70219692000149`, IE `40325274123`, `indIeDest: 1`, `regimeTributario: "SN"`) — exceto S02, cliente
> 24 (sem campos FP, país `BG` pelo `customrecord_fp_pais`). `numeroItem` 1..n. **(E)** = só no
> `...-emissao-payload.json`.

| cen. | tem de estar | NÃO pode estar |
|---|---|---|
| S01 2233 | `naturezaOperacaoId:"VENDA_PROD"`; L1: `naturezaOperacaoId:"VENDA_ST"`, `cfopCodigo:"5405"`, `infoAdicional`, `indDoacao:1`, `indBemMovelUsado:1`, `deducaoMaterial:7.5`, `valorFrete:10`, `valorSeguro:5`, `valorDesconto:3`, `despesasBaseII:4`, `despesasBaseIcms:6`, `creditoIcmsTransferido:2.25`, `quantidadeTributavel:20`, `valorUnitarioTrib:10`, `hipoteseStInterestadual:"PARTILHA"`, `tpCredPresIbsZfm:"0"`; L2: `hipoteseStInterestadual:"REPASSE"`, `tpCredPresIbsZfm:"3"`, `ncm:"85176272"`, `origemProduto:"0"`. **(E)** `indPres:"1"`, `infAdicFisco`, `transporte.modFrete:"0"`, `transportadora` do fornecedor 11 com endereço, `retencaoIcms` com os 6 (`pICMSRet` 12, `cMunFG` "3550308"), `veiculo.placa:"ABC1D23"`, `uf:"SP"`, **5** reboques (1º `REB0001`/`SP`), `vagao`, `balsa`, volumes (1º com `lacres:["L1","L2","L3"]`), pagamento `03` com `tpIntegra:"1"`, `cnpjCredenciadora:"01027058000191"`, `tBand:"01"`, `cAut`; `01` com `indPag:"0"`; `99` com `descricao:"Permuta"` | L2 `cfopCodigo` (`61a2`); L2 `valorFrete` (0), `indDoacao`, `indBemMovelUsado`; `infAdicContrib` depois de apagado; **(E)** 6º reboque; `tBand`/`cAut` no pagamento `01` |
| S02 2241 | `dataEmissao:"2023-11-14"`, `naturezaOperacaoId:"VENDA_SERV_EXPORT"`; nas **duas** linhas `municipioPrestacao:"3550308"`, `ufPrestacao:"SP"`, `paisPrestacao:"1058"`, `paisResultadoServico:"US"`, `consumoNoExterior:true`; L1 `deducaoMaterial:12.34` | `municipioPrestacaoNome` |
| S03 2239 | `municipioPrestacaoNome:"Rio de Janeiro"`, `ufPrestacao:"RJ"`, `paisResultadoServico:"AR"`; log "exportacao de servico exige os DOIS" | `paisPrestacao` (`BR` → dígitos vazios), `consumoNoExterior`, `municipioPrestacao` |
| S04 2240 | `municipioPrestacao:"355030"` (6 dígitos — vai, o mapeador não confere tamanho), `ufPrestacao:"S."`, `paisPrestacao:"1058"`, `consumoNoExterior:true`; log do par | `naturezaOperacaoId`, `paisResultadoServico` |
| S05 2236 | L1 `chaveAcessoReferencia` (44) + `numeroLinhaReferencia:1`; L2 só a chave + log "NAO tem o item de origem" | L3 `numeroLinhaReferencia` (sem chave, não vai) |
| S06 2235 | L1 e L2 `di.nDI:"2612345678"`, `tpViaTransp:"1"`, `tpIntermedio:"2"`, `ufDesemb:"SP"`, `dDI:"2026-09-10"`, `dDesemb:"2026-09-15"`, `cExportador`; L1 `adicoes:[{nAdicao:1,nSeqAdic:1,cFabricante:"FAB-A",vDescDI:1.5}]`, L2 `adicoes:[{nAdicao:2,nSeqAdic:1,cFabricante:"FAB-B"}]` (objetos DIFERENTES); L3 DI `2698765432` com `tpViaTransp:"4"`, `tpIntermedio:"3"`, `cnpjTerceiro:"12345678000195"`, `ufTerceiro:"MG"`, `nSeqAdic:3`; L4 DI `2611112222` com `vAFRMM:1234.56` e **sem** `adicoes`; logs: DI-A marítima sem AFRMM, DI-A conta e ordem sem CNPJ | `vAFRMM` na DI-A e DI-B (0) |
| S07 2237 | cabeçalho `"VENDA"`; L1 `"BONIFICACAO"`, L3 `"REMESSA_AMOSTRA"`; **(E)** `indPres:"9"`, `transporte:{modFrete:"9", vagao, balsa}`, pagamentos `04` (sem tpIntegra) e `99` (sem descrição); logs de retTransp incompleto, cartão sem tpIntegra, 99 sem descrição | L2 `naturezaOperacaoId` (cala — o cabeçalho não é copiado para a linha); **(E)** `retencaoIcms`, `veiculo`, `reboque`, `volumes`, 3º pagamento |
| S08 2234 | L1 `cfopCodigo:"6102"`; **(E)** `indPres:"0"`, `infAdicFisco:"fisco S08"`, `tipoDocumento:"NFCE"` | `naturezaOperacaoId`; L2 `cfopCodigo`; **(E)** `transporte` inteiro (placa sem modFrete) |
| S09 2238 | `"VENDA_ZFM"`; `tpCredPresIbsZfm` L1 `"1"`, L2 `"4"`, L3 `"0"` | L4 `tpCredPresIbsZfm` |

### 13.2 Despesas da importação, outras despesas e cobrança — 2026-09-30

**S06 (2235) corrigido**, porque o cenário de importação não levava despesa nenhuma na base. PATCH
nas linhas: L1 `despesasBaseII` 150 + `despesasBaseIcms` 80; L2 `despesasBaseII` 50; L3
`despesasBaseIcms` 30 + `valorFrete` 10 + `valorSeguro` 4 (borda: o DTO diz que na importação o
frete é `despesasBaseII` e o `<vFrete>` é suprimido); L4 sem despesa. O PATCH simulou (guarda 3,
§13) e gravou `FP-salesorder-2235-payload.json`.

**Lacunas contra o DTO**, medidas em `emitir-nota.dto.ts` e `simulacao-nota-input.dto.ts`:

| DTO | estado |
|---|---|
| `linhas[].valorOutras` (`<vOutro>`, base de ICMS/IPI, **recusado em linha de importação**) | ✅ implementado: `custcol_fp_valor_outras` + `LINHA_VALOR_OUTRAS` + mapeador. Só existe na conta depois do deploy |
| `cobranca { fatura, duplicatas[] }` (commit `7f6b1a5b` da plataforma) | ✅ implementado em `montarEmissao`: parcelas da sublist NATIVA `installment` (`duedate`, `amount`), ordenadas por vencimento; sem parcelas, uma duplicata no `duedate`; sem nenhum, o grupo não vai. `nFat` = `tranid`, `vOrig` = `total`; `vDesc`, `vLiq` e `nDup` ficam com a plataforma |
| `exportacao { ufSaidaPais, xLocExporta, xLocDespacho }` | ❌ não mapeado — sem ele a exportação é rejeitada (355/225) |
| `linhas[].codigoBarras` (cEAN) | ❌ só o `codigoBarrasTrib` vai |
| `linhas[].codigoCnae` | ❌ `custrecord_fp_cnae` da location está no perfil e ninguém lê |

Mapeador rodado fora do NetSuite (`N/*` como stub, perfil real): parcelas fora de ordem saem em
ordem; "Net 30" vira uma duplicata; sem vencimento, sem `cobranca`; `valorOutras: 20` vai e
`valorFrete: 0` não. `project:validate --server`: 0 erros.

Cenários de cobrança (invoice, 2023-11-14, serviço, só se conferem pelo **Emitir**, chumbado, e
**depois do deploy**):

| cen. | id | prazo | `cobranca` que tem de sair |
|---|---|---|---|
| S10 | 2333 | 9 "2x" | `fatura {numero:"682", valorOriginal:999.99}`, `duplicatas [{2023-11-14, 500}, {2023-12-14, 499.99}]` |
| S11 | 2334 | 1 "Net 15" | `fatura {numero:"683", valorOriginal:999.99}`, `duplicatas [{2023-11-29, 999.99}]` |

### 13.3 A emissão parte do payload simulado — 2026-09-30

`fp_sl_emissao.emitir` lê `FP-<tipo>-<id>-payload.json` da pasta `custscript_fp_pasta_payload` (o
request do último `/simular`, gravado pelo `fp_ue_simular.anexarRastro`) e `montarEmissao(rec, base)`
só ACRESCENTA `serie`, `tipoDocumento`, `idExterno`, `indPres`, `transporte`, `pagamento`,
`cobranca`, `infAdic*`. Sem o arquivo, a emissão é **recusada** dizendo para simular antes — não
remonta em silêncio. Harness: base intacta, `linhas` idênticas às simuladas; validate 0 erros.

Consequência para os cenários: **salvar (simular) antes de Emitir** deixa de ser só ordem de
guarda 6 — sem o `-payload.json` a emissão não sai. As 2333 e 2334 (cobrança) nasceram por REST,
sem simular: precisam do save com `APAGUE` antes do Emitir.

### 13.4 Prestação por entidade + endereço — 2026-09-30

`custbody_fp_entidade_prestacao` (Entity `-9`, filtro de tipo aceita cliente **e fornecedor** —
PATCH com o 25 entrou) e `custbody_fp_local_prestacao` (Address `-137`, filtrado pelo address book
da entidade). **Saem** `MUN_PRESTACAO`, `MUN_PRESTACAO_NOME`, `UF_PRESTACAO`, `PAIS_PRESTACAO`
(objetos removidos do projeto; os campos seguem na conta até serem apagados pela UI — §10.4).
**Ficam** `PAIS_RESULTADO` e `CONSUMO_EXTERIOR`: declaração, não endereço (o DTO diz que o
resultado "NÃO SE DERIVA DO ENDEREÇO DO TOMADOR"), e testes diferentes — ISS (LC 116, art. 2º,
p.ú.) × LC 214, art. 80. O aviso "exige os DOIS" que o mapeador dava estava errado e saiu.

| fato | como se sabe |
|---|---|
| `custbody_fp_local_prestacao` guarda o `internalid` da entrada do address book (`20`), não o `nkey` do endereço (`56`) | POST da 2433 e releitura |
| `entityaddressbook` ⨝ `entityaddress` resolve cliente, fornecedor e funcionário numa consulta | SuiteQL |
| Mapeador manda `municipioPrestacaoNome` + `ufPrestacao` (a plataforma resolve o IBGE; recusa nome sem UF) e `paisPrestacao` pelo `customrecord_fp_pais` (BR → 1058) | `simulacao-nota-input.dto.ts` §municipioPrestacaoNome; SuiteQL |
| ⚠ **17 dos 20 endereços da conta têm cidade e UF só no `addrtext`**, com `city`/`state` vazios (2019/2021). Sem município o DTO assume o do PRESTADOR. O mapeador avisa no log; não extrai do texto. Conserto: regravar o endereço | `SELECT a.* FROM entityaddress` |

Cenários (os de S02–S04 da §13.1 ficam valendo só para resultado/consumo):

| cen. | id | local | nas linhas tem de sair |
|---|---|---|---|
| S02 | 2241 | 20 Manaus (cliente 28) | `municipioPrestacaoNome:"Manaus"`, `ufPrestacao:"AM"`, `paisPrestacao:"1058"`, `paisResultadoServico:"US"`, `consumoNoExterior:true` |
| S03 | 2239 | 1 Cliente SP (sem city) | só `paisPrestacao:"1058"` e `paisResultadoServico:"AR"`; log "SEM município ou UF" |
| S04 | 2240 | 11 Orlando/US (fornecedor 25) | `paisPrestacao` = cPais dos EUA, `municipioPrestacaoNome:"Orlando"`, `ufPrestacao:"FL"`, `consumoNoExterior:true` → o motor RECUSA (prestação no exterior, por desenho) |
| S12 | 2433 | 20 Manaus | igual ao S02 sem resultado/consumo |

### 13.5 Depois do deploy de 2026-09-30 — e o país do resultado vira lista

| fato | como se sabe |
|---|---|
| Os quatro scripts da conta batem byte a byte com o disco (`fp_md_map_simular` 72761, `fp_sl_emissao` 16869, `fp_ue_simular` 33397, `fp_perfil_original` 18002) | `file.filesize` × `wc -c` |
| ✅ **O deploy NÃO derrubou o acesso do papel aos custom records** (§10.3.1): `customrecord_fp_imposto` 31, `customrecord_fp_di` 3 | SuiteQL com o token |
| `custcol_fp_valor_outras` existe; `custbody_fp_mun_prestacao` não existe mais | `SELECT <coluna>`: 200 × 400 |

`custbody_fp_pais_resultado`: TEXT(2) → **SELECT de `customrecord_fp_pais`** (257 registros, todos com
ISO). O mapeador lê o id e manda o ISO alfa-2 do registro (`78` → `US`), que é o que o DTO pede.
Validate 0 erros. ⚠ Duas transações têm texto no campo (2239 `AR`, 2241 `us`); o que o deploy faz
com texto num campo que vira SELECT **não foi medido**.

### 13.6 Primeira rodada de payload real — 12 cenários, 2026-09-30

> Método: PATCH por REST em cada transação (EDIT em `RWS` simula — §13) e leitura do payload no
> **Execution Log**: o `anexarRastro` loga o rastro inteiro (`title = 'json'`) e o `scriptnote` é
> legível pelo token. O detalhe corta em ~3.960 chars, mas o `payload` vem antes da resposta e
> cabe. Hora do log no fuso da conta (07:14 = 11:14 local).

| fato | como se sabe |
|---|---|
| ⚠ `file.lastmodifieddate` **não muda** quando o File Cabinet substitui o arquivo — não serve para saber quando foi a última simulação | 2241 simulou às 11:13:49 (log `anexar` file 58438) e o arquivo seguiu com 11:04:55 |
| ⚠ O deploy que trocou `custbody_fp_pais_resultado` de TEXT para SELECT **apagou em silêncio** o texto das duas transações (2239 `AR`, 2241 `us`) | SELECT antes × depois |
| Guarda 4 funcionando: PATCH sem mudança relevante → "nada fiscalmente relevante mudou" | log das 2233 e 2240 |

Contra o gabarito (§13.1–13.4): **9 de 12 batem** — S02, S03, S04, S05, S07, S08, S10, S11, S12.
Três defeitos do mapeador, todos silenciosos:

| cen. | defeito | causa medida | correção |
|---|---|---|---|
| S06 2235 | nenhuma linha leva `di` | **SuiteQL devolve alias em minúsculas** (`AS NDI` → `ndi`); `montarDi` lia `r.NDI`, achava vazio e descartava | chaves normalizadas para maiúsculas antes do `montarDi` |
| S09 2238 | nenhuma linha leva `tpCredPresIbsZfm` | coluna SELECT do sublist `item` lida com `getSublistValue` → id `"1"`; `codigoDaLista` não acha código | `textosDaLista`: nome do valor por SuiteQL na lista, uma consulta por nota; listas em `registros` do perfil |
| S01 2233 | falta `hipoteseStInterestadual` (e o ZFM) | idem | idem |

Harness com as respostas REAIS do SuiteQL: DI nas 4 linhas (clone por linha, `nSeqAdic` 1 por
omissão, DI sem adição, datas `2026-09-10`, os dois avisos da DI-A), ZFM `1`/`4`/`0`/ausente,
hipótese `PARTILHA`/`REPASSE`. Validate 0 erros. **Falta o deploy para medir na conta.**

**Depois do deploy do `4ab3cf7`, mesma data: 12 de 12 batem.** Re-simulados S01 (`PARTILHA`/`REPASSE`,
ZFM `0`/`3`), S06 (DI nas 4 linhas, adições distintas, `nSeqAdic` 1 por omissão, datas `2026-09-10`,
DI-C sem adição e com `vAFRMM` 1234.56) e S09 (ZFM `1`/`4`/`0`/ausente, `valorOutras` 7.77).
⚠ `scriptnote.internalid` **não cresce na ordem do horário** — ordenar por `date` perdia entradas;
a leitura certa é por `internalid` dentro de uma janela de horário.

Entidade da prestação: tentado default pelo `entity` da transação e revertido a pedido do Rogerio — o campo fica como ele o importou. ⚠ Medido na tentativa: **`<sourcelist>STDBODYENTITY</sourcelist>` com `<sourcefrom>` vazio PASSA no `validate --server` e é RECUSADO no deploy** ("Please specify a field to source"): sourcing copia um CAMPO do registro escolhido. No `custbody_fp_local_prestacao` o mesmo par é FILTRO (`sourcefilterby`).

### 13.7 Payload de EMISSÃO — 4 cenários, 2026-09-30

> Método: Suitelet chamado pela URL externa (deployment com *Available Without Login*, ligado pelo
> Rogerio na UI — **não está no XML, e o deploy NÃO o desliga**: `isonline` seguiu T depois do deploy do `c24e526`), POST com `tipo`/`id`/`acao` na
> query e `{"texto":""}` no corpo, como o `fp_cs_transacao`. Arquivo lido por **SOAP `get` de
> `file` com o mesmo token TBA** — o REST não expõe `file`, o SOAP sim, e devolve o conteúdo em
> base64. `fp_client.emitir` chumbado: nada transmitido, e a resposta sem chave não persistiu nada.

| fato | como se sabe |
|---|---|
| POST na URL externa com o User-Agent do `curl` → **405 na borda (Akamai)**; com User-Agent de navegador → 200 | mesma requisição, só o `-A` muda |
| Sem `ns-at` → 500; GET com `ns-at` → "Esta tela só responde a POST" (o Suitelet é alcançado) | curl |
| `linhas`, `destinatario`, `naturezaOperacaoId`, `dataEmissao`, `cnpjEmpresa` do `-emissao-payload.json` são **idênticos** aos do `-payload.json` do último `/simular` nas 4 | comparação campo a campo |

Contra o gabarito (§13.1–13.2): **todos os grupos da emissão batem** — `indPres` 1/9, `infAdicFisco`,
`modFrete` 0/9, `retencaoIcms` com os 6 (`pICMSRet` 12 — o `getValue` devolve 12, não 0.12), veículo
`ABC1D23`/`SP`, **5 reboques** (o 6º cortado, com o log), vagão/balsa, volumes com
`lacres:["L1","L2","L3"]` e o vazio pulado, pagamento `03` com o grupo de cartão, `01` sem
`tBand`/`cAut`, `99` com `Permuta`; na 2237 os avisos de retTransp incompleto, cartão sem
`tpIntegra` e 99 sem descrição, e o pagamento sem forma pulado; `cobranca` da 2333
(`682`/999.99, 500 + 499.99 em ordem) e da 2334 (uma duplicata no `duedate`).

⚠ **A transportadora sai sem `municipio`, `uf`, `cnpjCpf` e `ie`**, calada: o fornecedor 11 não tem
`custentity_fp_cnpj_cpf`/`_ie` e o endereço dele tem cidade/UF só no `addrtext` (§13.4) — o número
`1231` também está só lá. É cadastro; o mapeador avisa quando não há endereço, mas não quando ele
vem sem cidade/UF.

**Transportadora sem documento ou local agora avisa** no log (CNPJ/CPF, município, UF; IE fora de
propósito — isento/PF). Records Browser 2026.1 (`2026_1_Schema_and_Records_Browser/`, fora do git):
o endereço nativo só tem `addr1-3`, `city`, `state`, `zip`, `country` e o `addrtext` montado — número
não é campo nativo; o vendor tem `vatregnumber` e `taxidnum` nativos, **vazios no fornecedor 11**
junto com o `custentity_fp_cnpj_cpf`, então não há outra fonte a ler.

Depois do deploy do `c24e526`: 2233 re-emitida (chumbada) e o log trouxe "transportador 11 vai SEM CNPJ/CPF (custentity_fp_cnpj_cpf), município, UF..." junto do corte do 6º reboque.

## 14. O resto do EmitirNotaDto — 2026-09-30

Diff propriedade a propriedade (DTO × `fp_md_map_simular.js`). Implementado agora:

| DTO | NetSuite | nota |
|---|---|---|
| `dataSaidaEntrada` | `custbody_fp_data_saida` (DATE) | **não** o `shipdate`: é a data PREVISTA e o NetSuite a preenche sozinho (2233: trandate + 2) |
| `competenciaOriginal`, `dataReajuste` | `custbody_fp_competencia_original`, `custbody_fp_data_reajuste` | vão no `/simular` também |
| `destinatario.qualificacao` | `custentity_fp_qualificacao` → `customlist_fp_qualificacao` | os 3 valores de `QUALIFICACOES_DESTINATARIO` (`resolver-icms.ts:143`) |
| `linhas[].codigoBarras` (cEAN) | `upccode` **nativo** do item | ausente → a plataforma emite "SEM GTIN" |
| `linhas[].codigoCnae` | `custitem_fp_cnae` (só item de serviço) | é da ATIVIDADE, não do estabelecimento — o `custrecord_fp_cnae` da location não serve |
| `exportacao` | `custbody_fp_exp_local` / `_exp_uf` / `_exp_despacho` | porta: `xLocExporta` |
| `contingencia` | `custbody_fp_cont_via` → `customlist_fp_cont_via`, `custbody_fp_cont_justificativa` | porta: `xJust`; `dhCont` fica no default (instante da emissão) |

Fica de fora de propósito: `branchId`/`companyId` (UUID), `indFinal` (derivado da natureza),
`municipioPrestacao`/`destinatario.codigoIbge` (a plataforma resolve), `fatura.valorLiquido`
(derivado), `linhas[].impostos` (só com motivo). Fora do escopo NF-e: `participantes`, `prestacao`,
`manifesto`, `guiaValores`, `substituicao`.

⚠ `customlist.name` tem no máximo **30** caracteres (validate). ⚠ `custitem_fp_nbs` tem
`appliestoservice` F — a NBS é do serviço e hoje não se preenche em item de serviço.
⚠ O DTO diz de `linhas[].impostos`: "Se presentes, o emitir NÃO recalcula pelo motor" — o CLAUDE.md
diz override por tributo. Contrato a conferir do lado da plataforma.

Harness (mapeador e perfil reais): datas `2026-10-01`/`2026-07-10`/`2026-08-01`, qualificação
`ORGAO_PUBLICO_ESTADUAL`, GTIN, CNAE `6209-1/00` → `6209100`, `exportacao` e `contingencia` só na
emissão (via `EPEC`), grupo ausente sem a porta. Validate 0 erros. **Falta o deploy para medir.**

**Medido na conta depois do deploy do `ba63e45`.** Cadastro de teste: `upccode` 7891234567895 no item
13, `custitem_fp_cnae` `6209-1/00` no item 12 (REST: `servicesaleitem`, não `serviceitem`),
qualificação FEDERAL no cliente 31, naturezas 44 e 46 liberadas para pedido/invoice.

| cen. | id | `/simular` |
|---|---|---|
| S13 exportação | 2533 | `dataSaidaEntrada` 2026-10-02, `codigoBarras` 7891234567895, `destinatario.pais` 1112 (BG); sem `exportacao` ✅ |
| S14 complemento de preço + EPEC | 2633 | `competenciaOriginal` 2026-07-10, `dataReajuste` 2026-08-01 ✅ |
| S15 serviço p/ órgão público + SVC | 2634 | `qualificacao` ORGAO_PUBLICO_FEDERAL, `codigoCnae` 6209100; sem `contingencia` ✅ |

⚠ **Emissão bloqueada:** depois deste deploy, a URL externa do Suitelet voltou a responder "You do
not have privileges to view this page" com o mesmo User-Agent que funcionava antes; `isonline`
segue T. `exportacao` e `contingencia` ainda não medidos na conta.

**Emissão medida (depois de o Rogerio importar o deployment do Suitelet):** 2533 `exportacao`
`{xLocExporta:"Porto de Santos", ufSaidaPais:"SP", xLocDespacho:"Recinto Alfandegado Santos"}`;
2633 `contingencia {xJust, via:"EPEC"}`; 2634 `contingencia {xJust}` sem `via` (plataforma → SVC).
Nas três as `linhas` emitidas são idênticas às simuladas. **Todo o EmitirNotaDto de NF-e está
medido na conta.**

| fato | como se sabe |
|---|---|
| O "You do not have privileges" da URL externa era AUDIÊNCIA: `allroles` T só cobre papéis internos; o anônimo é `ONLINE_FORM_USER`, que precisa estar em `audslctrole` — é o aviso que o validate dava desde o início | XML importado da conta |
| O deploy **reescreve a audiência** pelo XML (tirou o `ONLINE_FORM_USER` que estava só na UI) e **não** reescreve o `isonline` (§13.7) | antes × depois do deploy do `ba63e45` |
| `object:import` traz papel customizado sem scriptid como `[SCRIPT_ID_NOT_SPECIFIED]`, e o validate o **recusa**. Removidas as 4 entradas; os papéis internos seguem cobertos por `allroles` T | validate |

### 14.1 Campos de item por tipo — revisados 2026-09-30

Erro meu: NBS, código do serviço municipal e desdobramento trib. nacional estavam só em mercadoria
(`appliestoservice` F). Os três refinam o subitem da LC 116, que só existe em serviço. Revisão de
todos os `custitem_fp_*` contra o DTO:

| tipo | campos |
|---|---|
| só serviço | `servico_lc116`, `servico_municipal`, `desdobramento`, `nbs`, `cnae` |
| só mercadoria (inventory, assembly, kit, non-inventory) | `ncm`, `cest`, `origem`, `ex_tipi`, `nfci`, `ean_trib`, `unid_trib`, `fator_conv` |
| os dois | `tipo_item` (o `09 - Serviços` é valor da tabela do 0200), `nat_receita` (NAT_REC vale para toda receita com CST de PIS/COFINS 04-09, serviço inclusive) |

Nenhum item tinha valor nos três campos que saíram de mercadoria (SuiteQL: 0 linhas). Validate 0 erros.

Depois do deploy do `78c01ae`: o item de serviço 12 aceitou NBS `115021000`, serviço municipal
`01449`, desdobramento `01` e tipo `09 - Servicos`; o item de mercadoria 13 respondeu **204 e não
gravou** o NBS (campo que não se aplica ao tipo é descartado calado pelo REST). A 2634 re-simulada e
emitida leva `nbs`, `codigoServicoMunicipal`, `desdobramentoTribNac`, `tipoItem:"09"` e `codigoCnae`
na linha, igual nos dois payloads. A URL externa do Suitelet seguiu respondendo depois do deploy —
a audiência agora está no XML.

## 15. Fase 3 — eventos do documento emitido, com resposta chumbada (2026-09-30)

Rotas e corpos do bundle conferidos contra `emissao.controller.ts`: `emitir/:chaveOuId/consultar`,
`nfe/:chave/reconciliar`, `emitir/:chaveOuId/cancelar` `{justificativa}`,
`emitir/:chaveOuId/carta-correcao` `{correcao}`, `emitir/:chaveOuId/inutilizar` `{justificativa}` —
a chave entra pelo `EnderecoDoDocumentoPipe`. **Batem.** O que não batia era a RESPOSTA:

| defeito | causa lida no fonte | correção |
|---|---|---|
| depois de CANCELAR, a transação seguia AUTORIZADA | `cancelar` e `carta-correcao` devolvem `{ transaction, evento }`; o persist lia `status` na raiz | `documentoDaResposta` por ação, no Suitelet |
| desfecho da reconciliação nunca gravado | `ResultadoReconciliacao` traz `statusNovo`, não `status` (ausente = nada mudou) | idem; ausente não toca o status |
| inutilização poria o 102 da INUTILIZAÇÃO nos campos da NOTA | o retorno é `{sucesso, cStat, xMotivo, nProt, id}` e a plataforma não muda o status da nota | nada vai aos campos DOC_; o rastro vai |
| evento sem rastro, e com rastro sobrescreveria a emissão | Suitelet não passava o corpo; nome fixo `FP-…-emissao-*` | corpo do evento no rastro; um par por ação (`FP-<tipo>-<id>-<acao>-*`) |
| ⚠ nenhuma nota chegava a AUTORIZADA | o `emitir` chumbado devolvia o `chumbado()` do SIMULAR, e o comentário dizia o contrário | emissão chumbada na forma de `TransactionComLinks`, derivada do payload |

Emissão chumbada: chave de 44 com DV módulo 11 (conferido contra a chave real da 2232: DV 4 = 4),
número 900.000.000 + `idExterno`, idempotente. Cada rota de evento tem a forma do fonte.
Validate 0 erros. **Falta o deploy para medir.**

**Medido na conta depois do deploy do `37e8989`** — Suitelet pela URL externa, respostas chumbadas,
campos DOC_ relidos por SuiteQL e rastro baixado por SOAP a cada passo:

| passo | transação | tela | campos DOC_ | rastro |
|---|---|---|---|---|
| emitir 2433 | → AUTORIZADA | cStat 100, chave de 44, nº 900002433, série 2, protocolo | chave, número, série, status, cStat, xMotivo, protocolo e os links de XML/DANFE **gravados — primeira vez que a gravação do retorno de emissão rodou** | `-emissao-*` |
| consultar | AUTORIZADA | cStat 100 | inalterados | `-consultar-*`, corpo `{}` |
| reconciliar | AUTORIZADA | cStat 100 | inalterados | `-reconciliar-*` |
| CC-e | **segue AUTORIZADA** | evento cStat 135, `nSeqEvento` 1, protocolo do EVENTO | protocolo da AUTORIZAÇÃO intacto | `-carta-*`, corpo `{"correcao": …}` |
| cancelar | **→ CANCELADA** | evento cStat 135, protocolo do evento | status CANCELADA | `-cancelar-*`, corpo `{"justificativa": …}`; retorno com `transaction` + `evento` |
| inutilizar 2234 (REJEITADA 539 marcada por PATCH) | **segue REJEITADA** | cStat 102 e protocolo da INUTILIZAÇÃO | cStat 539 e o motivo da rejeição intactos | `-inutilizar-*` |

Nenhum par de evento sobrescreveu o `-emissao-*`.

⚠ Do chumbado, não do bundle: o `transaction` do cancelamento chumbado só traz `status` — o
cStat/xMotivo da transação ficam os da autorização. Com a plataforma real, o que ela devolver em
`transaction` entra inteiro. ⚠ Depois da inutilização a nota segue REJEITADA, então o botão
Inutilizar continua aparecendo; repetir é seguro (a plataforma responde `jaRegistrado`).

### 15.1 Pré-teste do autorizador antes de emitir

`GET /fiscal/emitir/status-sefaz?cnpjEmpresa=` (`emissao.controller.ts:172`) devolve `{cStat,
xMotivo, emOperacao, tMed?, dhRetorno?, xObs?, deCache}` (`nfe-autorizacao.client.ts:969`); a
própria rota diz que existe para "saber se o autorizador está no ar ANTES de tentar emitir". Sem o
pré-teste, SEFAZ parada só aparece DEPOIS de o número ser reservado.

`fp_sl_emissao.decidirPreEmissao` — só NF-e/NFC-e, só sem contingência (com ela a plataforma sonda
a SVC, guarda anti-570), fail-open se a consulta falhar, barra com o texto da SEFAZ se
`emOperacao` for falso. Os 7 ramos testados fora da conta com a função real. Chumbado responde 107.

## 16. `destinatario` → `contraparte` (plataforma `31d554b9`, 2026-09-30)

A plataforma trocou o bloco da outra parte **sem alias**: `destinatario`/`DestinatarioDto` →
`contraparte`/`ContraparteDto`, e `indIeDest` → `indIe`. Motivo medido lá: na COMPRA a UF e o regime
do fornecedor vinham de campos flat que o DTO não declara, o whitelist os apagava, e toda compra
saía INTERNA (SP→ES: 1102/ICMS 0 com o nome antigo; 2102/7% com `contraparte`). O papel sai da
direção da natureza (`engine/ler-contraparte.ts`): saída = destinatário, entrada = fornecedor.

Bundle: `montarContraparte` — cliente na venda, **fornecedor** na compra (tipo do registro:
`purchaseorder`, `vendorbill`, `vendorcredit`, `itemreceipt`, `vendorreturnauthorization`);
`indIe`; a qualificação só na venda (o `custentity_fp_qualificacao` não se aplica a vendor, e pedir
a coluna derrubaria o lookup). Os gabaritos das §13–14 que dizem `destinatario` leem-se `contraparte`.

⚠ Todo `FP-*-payload.json` gravado até aqui tem `destinatario`. Emitir a partir dele mandaria a nota
sem contraparte, calada — o Suitelet agora RECUSA e pede para salvar (simular) de novo.

Depois do deploy do `a6e8178`: 2238 e 2634 re-simuladas saem com `contraparte` (nenhum
`destinatario`): 2238 com `indIe: 1`, `regimeTributario: "SN"` e o endereço completo; 2634 com
`qualificacao: "ORGAO_PUBLICO_FEDERAL"`. A 2533, emitida sem re-simular, foi **recusada** com
"o payload simulado desta transação usa destinatario… salve para simular de novo".

## 17. Entrada no `beforeSubmit` da vendor bill (2026-09-30)

Contrato lido no fonte: `POST /transacoes/reclassificar` (`ReclassificarDto`: `chaveAcesso`,
`naturezaOperacao`, `dataEntrada`, `linhas[{numeroItem, naturezaOperacao, …}]`) devolve
`detalhar(id)` — `linhas[].impostos[]` com `taxCodigo`, `cst`, `cclasstrib`, `baseCalculo`,
`reducaoBase`, `aliquota`, `valor`, `naturezaContabil`, `compoeTotalNf` (os nomes do `/simular`, então
o `aplicar` grava sem adaptar). `GET /transacoes/chave/:chave/existe?entradaSaida=E&cnpj=` devolve
`{existe, ocorrencias, id?, status?, numero?}`.

| decisão | por quê |
|---|---|
| `custbody_fp_chave_entrada` (TEXT 54) e `custbody_fp_data_entrada` (DATE), só compra, subaba FiscalPlatform | declaração de quem lança; sem `DOC_` para a guarda 4 enxergar mudança — ⚠ e por isso a CÓPIA herda a chave |
| chave não capturada → simulação como PRÉVIA + aviso | a natureza não pode ir sem a nota na plataforma |
| capturada → sublista = DOCUMENTO (`reclassificar`); simulação só compara | o documento é o que existe; a simulação é o que o motor calcularia |
| comparação lado a lado, sem veredito | tolerância e o que conta é régua (CLAUDE.md); quadro inteiro em `-comparacao.json` |
| natureza de linha por `numeroItem` na ordem da vendor bill (linha sem valor não conta) | ⚠ casa com o `nItem` do XML só se a vendor bill seguir a ordem da nota |
| deployment `customdeploy3` do `fp_ue_simular` em VENDORBILL | — |

⚠ `TransactionTaxDetail` não tem `sentidoDaPernaFixa` nem `geraLancamento` (só o resultado do
`/simular` tem): na entrada a sublista sai sem a perna que o GL plug-in lê. Pedido à plataforma.

Harness: corpo do reclassificar (chave sem máscara, `COMPRA`, `2026-10-02`, `COMPRA_ATIVO` no item 2
com a linha de valor zero pulada), sem chave → nada; comparação com diferença de valor, tributo só no
documento e só na simulação. Chumbado para `existe` e `reclassificar`. Validate 0 erros.

**Medido na conta depois do deploy do `74c7836`** — vendor bill **2733** (fornecedor 11, item de
serviço de compra 33, COMPRA no cabeçalho e COMPRA_ATIVO na linha 2, chave de 44 com DV, data de
entrada 16/11/2023; COMPRA e COMPRA_ATIVO liberadas para Bill — id **17** no multiselect de tipo):

| o quê | resultado |
|---|---|
| `existe` e `reclassificar` | chamados (chumbados), log "natureza declarada" |
| corpo do reclassificar | `{chaveAcesso, naturezaOperacao:"COMPRA", dataEntrada:"2023-11-16", linhas:[{numeroItem:2, naturezaOperacao:"COMPRA_ATIVO"}]}` |
| `/simular` junto | `naturezaOperacaoId:"COMPRA"`, `contraparte` = fornecedor 11, linha 2 com COMPRA_ATIVO |
| sublista de impostos | o DOCUMENTO (ICMS/PIS/COFINS por linha, com natureza contábil) |
| anexos | `-payload`, `-retorno`, `-reclassificar-payload`, `-reclassificar-retorno`, `-comparacao` |
| comparação | 14 entradas — número sem sentido fiscal enquanto a simulação é o chumbado fixo de importação |

⚠ **CORRIGE a §13:** o CREATE por REST NÃO é barrado pela guarda 3. O `beforeSubmit` roda e LANÇA
`SSS_INVALID_API_USAGE` ("You must use getValue to return the value set with setValue") no `getText`
da natureza — campo posto por `setValue` na mesma requisição não responde a `getText`. A guarda 1
engole e o save passa; por isso "criação por REST não simulava".

## 18. Sem `getText` no caminho do save (2026-09-30)

`getText` de campo SELECT posto por `setValue` na mesma requisição LANÇA `SSS_INVALID_API_USAGE`
no `beforeSubmit` (§17, vendor bill 2733 criada por REST). Trocado por `getValue` do id + SuiteQL do
nome no registro da lista, em `textoDaLista`: natureza (`NATUREZA_OPERACAO`), tipo de documento,
`indPres`, modalidade do frete e via da contingência (listas em `registros` do perfil). O
`valorTexto` passa a ser só `getValue` — é para campo de texto. Ficam com `getText`/`getSublistText`
os pontos que rodam em registro CARREGADO (`record.load` do Suitelet, `beforeLoad`): pagamentos,
rótulo do botão, sublista de mídia na cópia.

Harness com `getText` LANÇANDO a mesma exceção: venda (`VENDA_PROD`, `NFE`, `indPres` 1, `modFrete`
0, contingência `EPEC`) e compra (`COMPRA` + `COMPRA_ATIVO` no item 2) montam inteiras. Custo: uma
consulta por campo SELECT preenchido, fora do laço de linhas.

### 18.1 Listas: junta os ids, UMA busca, depois preenche

Pedido do Rogerio. `resolverListas` faz um `UNION ALL` entre as tabelas das listas (medido pelo
token: custom record e lista custom na mesma consulta, cada linha marcada pelo grupo `g`).
`listasDoCorpo` (natureza, tipo de documento, `indPres`, modalidade do frete, via da contingência) e
`listasDasLinhas` (unidade, natureza, hipótese de ST, ZFM) memorizam por registro, e o
`montarReclassificar` reaproveita a busca do `montar`. Harness contando consultas: venda com todas as
listas **9 → 2**; compra (`montar` + `montarReclassificar`) **7 → 2**. Seguem à parte, uma por nota e
só quando há dado: endereço do fornecedor, país (cPais e ISO), DIs em lote, local da prestação,
itens em lote.

### 18.2 Nenhum `getText` no bundle, e governança medida no fim de toda execução

Os três que restavam, trocados pelo mesmo padrão (ids pelo `getValue`, UMA busca, depois preenche):
pagamentos (forma, indicador e integração de todas as linhas — `listasDoPagamento`, listas em
`registros`), rótulo do botão (`fp_ue_emissao.tipoDeclarado`), e os nomes dos anexos na cópia
(`removerAnexosDoBundle`: ids de todos, uma consulta em `file`). `grep` de `.getText(` e
`.getSublistText(` no bundle: **zero**. Harness com `getSublistText` lançando: pagamentos inteiros,
2 consultas de lista (corpo + pagamentos).

`fp_governanca.medir(rotulo, fn)` envolve `fp_ue_simular` (beforeLoad, beforeSubmit, afterSubmit),
`fp_ue_emissao.beforeLoad` e `fp_sl_emissao.onRequest`: no `finally` — também no retorno cedo e na
exceção —, AUDIT `fp_governanca` com "usou N · restam M (entrou com K)". O GL plug-in entrou depois: o manual admite N/runtime no plug-in ("You can also access the runtime.User object with the N/runtime Module", referência do `classId`, p.71-72) e dá 1000 unidades ao arquivo (p.11-12).

**Governança medida na conta depois do deploy do `769cc4f`** (linhas `fp_governanca` do log):

| execução | usou | observação |
|---|---|---|
| `fp_ue_simular.beforeSubmit` vendor bill 2734 **criada por REST** | 42 | simulação + `existe` + `reclassificar`, e **sem** o erro do `getText`: 6 impostos e 5 anexos |
| `fp_ue_simular.afterSubmit` create | 160 | 5 anexos (~30 por `file.create`+`save`+`attach`) |
| `fp_ue_simular.beforeSubmit` venda (2238, 2239) | 42 e 62 | |
| `fp_ue_simular.afterSubmit` edit | 70 | 2 anexos |
| `fp_sl_emissao` emitir 2239 | 111 | |
| `beforeSubmit` xedit (o `submitFields` do persist) | 0 | a guarda pula |
| `beforeLoad` | 0 | |

✅ **Cada ponto de entrada começa com 1000 próprias**: o `afterSubmit` entra com 1000 depois de um
`beforeSubmit` que usou 42 — as cotas NÃO são compartilhadas. O custo dominante é anexar arquivo.

Depois do deploy do `dc32c39`: **`fp_gl_lines_plugin` usou 10** (entrou com 1000) no edit da invoice
2241 e na criação da 2833, e o save passou nas duas — o `N/runtime` no plug-in síncrono está medido.
Criação de invoice de serviço: `beforeSubmit` 32, `afterSubmit` 70. **Todos os pontos de entrada do
bundle medem a governança no fim da execução.** ⚠ A linha do plug-in pode chegar ao `scriptnote` um
instante depois das do UE do mesmo save — ler com folga de tempo.

## 19. Tipos de transação de cada natureza (`custrecord_fp_transacao_no`) — 2026-09-30

O campo é multiselect da lista **-100** (tipos de transação). Ids medidos por sonda (gravar um id e
ler o `refName`): 1 Journal · 5 Cash Sale · 6 Estimate · 7 Invoice · 10 Credit Memo · 15 Purchase
Order · 16 Item Receipt · 17 Bill · 20 Bill Credit · 31 Sales Order · 32 Item Fulfillment · 33
Return Authorisation · 43 Vendor Return Authorization · 48 Transfer Order (e os demais até 57).

Preenchidas as **69** naturezas pela família do nome + sentido E/S (`carga/naturezas_tipos_de_transacao.js`):

| família | tipos |
|---|---|
| VENDA\* (S) | Estimate, Invoice, Sales Order, Cash Sale |
| SAIDA_ATIVO, SIMPLES_FATURA, BONIFICACAO (S) | Invoice, Sales Order, Item Fulfillment |
| COMPL_\* (S) | Invoice |
| REMESSA_\*, INDUSTRIALIZACAO_ENCOMENDA, RETORNO_INDUST_\* (S) | Sales Order, Invoice, Item Fulfillment, Transfer Order |
| TRANSFER\* (S) | Transfer Order, Item Fulfillment |
| DEVOL_COMPRA\*, DEVOL_IMPORT (S) | Vendor Return Authorization, Bill Credit, Item Fulfillment |
| COMPRA\*, FRETE_TOMADO, ENTRADA_\* (E) | Purchase Order, Item Receipt, Bill |
| ENTRADA_TRANSF\* (E) | Transfer Order, Item Receipt |
| DEVOL_VENDA\* (E) | Return Authorisation, Credit Memo, Item Receipt |
| RETORNO_\* (E) | Return Authorisation, Item Receipt, Transfer Order, Purchase Order, Bill |

69 gravadas, 0 falhas; conferidas por leitura (69, 25, 24, 3).

⚠ O pedido de venda 2236 (S05) usa DEVOL_COMPRA_PROD, que agora não inclui Sales Order — reabrir e
salvar na tela pode recusar a natureza. ⚠ `custrecord_fp_transacao_no` e o filtro do
`custbody_fp_natureza` por ele **existem só na conta**: não estão em XML nenhum do projeto (§8.7
tirou a referência). Importar os dois (`object:import`) antes que um deploy decida por eles.

### 17.1 A chave de entrada é o próprio `custbody_fp_chave` (2026-09-30, Rogerio)

Sai o `custbody_fp_chave_entrada`: a chave da nota do fornecedor vai no MESMO campo da chave da
emissão. `custbody_fp_chave` passa a nascer `displaytype` NORMAL e o `beforeLoad`
(`organizarFormulario`) o trava (INLINE) em tudo que **não** é compra — na compra ele abre para
digitação. A guarda 4 conta o `DOC_CHAVE` como mudança só na compra (`camposRelevantes(tipo)`).
Efeito bom: com o prefixo `DOC_`, a CÓPIA volta a limpar a chave sozinha (`limparNaCopia`).

⚠ O `fp_ue_emissao` também põe botão de emissão na vendor bill (NF-e de entrada própria). Numa
vendor bill com a chave do FORNECEDOR digitada e sem status, o botão Emitir aparece, e emitir
gravaria a NOSSA chave por cima da do fornecedor. Os dois usos não convivem na mesma transação.
⚠ A 2733 e a 2734 têm a chave no campo antigo; o campo antigo segue na conta até ser apagado na UI.

**2026-10-02 (Rogerio): sai o tratamento de exibição do `beforeLoad`.** O INLINE forçado nos `DOC_*`
em CREATE/EDIT escondia os campos vazios no registro novo e a chave aparecia travada na entrada.
"Não é necessário tratar as visualizações quando é edit ou new record": o `organizarFormulario`
só põe **XML e DANFE em INLINE** (links do retorno). A **chave de acesso fica editável na compra** e
INLINE no resto. O resto dos `DOC_*` não é tratado. Na compra anexa o `fp_cs_entrada`
(CREATE/EDIT/COPY).

Depois do deploy do `2cfa750`: o `custbody_fp_chave_entrada` já não existe na conta (SuiteQL:
"Unknown identifier") e levou a chave da 2733/2734. Gravada de novo no `custbody_fp_chave` por PATCH
— a ÚNICA mudança do save —, e nas duas a guarda 4 a enxergou: `reclassificar` com a chave lida do
`DOC_CHAVE`, "natureza declarada", `beforeSubmit` 42, `afterSubmit` 160, GL plug-in 10.

## 20. Tipo de documento fiscal vira custom record, com Emissão Própria (2026-09-30, Rogerio)

`customlist_fp_tipodoc` → **`customrecord_fp_tipodoc`**: `name` (o que se vê), `custrecord_fp_tipodoc_
codigo` (o que vai no payload — NFE, NFCE, NFSE, CTE, MDFE) e `custrecord_fp_tipodoc_emissao_propria`
(checkbox). Catálogo nas `<instances>` do próprio objeto — primeira vez no projeto; o validate aceita
e avisa que `altname` não é suportado em instância (tirado). Oito: NF-e, NF-e de Terceiro, NFC-e,
NFS-e, NFS-e Tomada, CT-e, CT-e de Terceiro, MDF-e.

`fp_md_map_simular.tipoDocumento(rec)` → `{nome, codigo, emissaoPropria}`, uma consulta memorizada
por registro, só nos caminhos de emissão (a simulação não lê tipo). Quem usa: o payload
(`tipoDocumento = codigo`), o botão (Emitir só com Emissão Própria; o rótulo é o código) e o
Suitelet, que RECUSA emitir documento de terceiro ou sem tipo — o botão é conveniência, a regra vale
na chamada direta. Substitui a ideia frágil de esconder o botão pela chave digitada.

⚠ O deploy troca o alvo do `custbody_fp_tipodoc` de lista para record: pela §13.6 (país do
resultado), o valor que as transações têm deve ser APAGADO em silêncio. ⚠ O papel do token precisa
do `customrecord_fp_tipodoc` na aba Custom Record para ler o catálogo por SuiteQL.

**Medido na conta depois do deploy do `33d5d4c`** (com o `customrecord_fp_tipodoc` na aba Custom
Record do papel — sem isso o SuiteQL diz "not found" e o PATCH do campo responde 204 SEM gravar):

| o quê | resultado |
|---|---|
| instâncias | as 8, ids 1–8, código e Emissão Própria certos (`VAL_TIPODOC_*`) |
| valor antigo do `custbody_fp_tipodoc` | **apagado** em todas as transações (0 com valor) — confirmado |
| vendor bill 2733, "NF-e de Terceiro" | Suitelet **recusa**: "não é de emissão própria — é documento de terceiro" |
| invoice 2833, "NF-e" | emitida (chumbada), payload com `tipoDocumento: "NFE"` |
| invoice 2241, sem tipo | Suitelet **recusa**: "a transação não tem tipo de documento fiscal" |

## 21. Validador da chave de acesso na entrada (2026-09-30)

Portado do `AVLR_AccessKeyValidation_MD`/`_CS` (`GitHubGLO/ns-br/AvataxV3`, Nafis Costa & Rogerio
Horauti) para `fp_chave.js` (regra, servidor e cliente) e `fp_cs_entrada.js` (tela da compra),
com os campos do bundle (tabela no docblock do `fp_chave`). Novo campo `Modelo` no
`customrecord_fp_tipodoc` (55/55/65/—/—/57/57/58 nas instâncias): o modelo é dado do catálogo.

| regra | efeito |
|---|---|
| tipo de TERCEIRO com modelo exige chave | bloqueia |
| 44 dígitos · DV módulo 11 · modelo da chave × do tipo · mês/ano da chave × `trandate` · outra vendor bill com a mesma chave | bloqueia |
| CNPJ do emitente ≠ fornecedor e ≠ filial | avisa (como no original) |
| chave válida | preenche `DOC_SERIE`/`DOC_NUMERO` (tela e `beforeSubmit`) |

Tipo, CNPJ do fornecedor, CNPJ da filial e duplicidade numa consulta `UNION ALL` (medida na conta —
e ela já achou a 2734 duplicando a chave da 2733). No servidor não se bloqueia o save (guarda 1): chave
inválida ou duplicada, ou tipo que não é de terceiro com modelo, NÃO vai ao `reclassificar`. Saem do
original: isenção de fornecedor estrangeiro (importação não tem chave de fornecedor), a obrigatoriedade
por `track_landed_costs` e o `getNFUF` (que tinha `procura = 'SP'` fixo). A data vem do `trandate`:
não há data do documento própria no bundle.

Harness: 11 casos (válida; sem chave; 43 dígitos; DV; modelo 57 em NF-e; data fora do mês; CNPJ de
outro emitente; emissão própria; NFS-e tomada; sem tipo; duplicidade) — todos certos, 1 consulta cada.

**2026-10-02 (Rogerio): validador da chave sai do `clientScriptModulePath`.** Anexado pelo
`beforeLoad` não funcionou na tela; vira o objeto `customscript_fp_cs_entrada` (PURCHASEORDER,
VENDORBILL, VENDORCREDIT). E o save com chave reprovada passou: o `beforeSubmit` do `fp_ue_simular`
agora chama `validarChaveOuRecusar` FORA do try/catch e lança `FP_CHAVE_INVALIDA` (compra, CREATE/EDIT;
XEDIT fora porque o `newRecord` não traz tipo e chave).

**2026-10-02 — medido: a vendor bill 2734 salvou com chave de 43 dígitos e SEM tipo de documento.**
O `fp_chave.validar` saía logo sem tipo (`aplica:false`), e nem o cliente nem o `beforeSubmit`
recusavam. Agora chave preenchida se valida sempre (44, DV, modelo só se o tipo tiver, data,
duplicidade, CNPJ); o tipo só decide se ela é obrigatória. Sem tipo de terceiro (`terceiro:false`)
o `rodarEntrada` continua sem declarar a natureza.

**Medido na conta depois do deploy de 2026-10-02** (PATCH por REST na vendor bill 2734, servidor;
a tela fica para quem tem sessão):

| caso | resultado |
|---|---|
| 2734 como estava (43 dígitos, sem tipo), PATCH só no memo | **recusa** `FP_CHAVE_INVALIDA`: "deve conter 44 dígitos (tem 43)" |
| tipo NF-e de Terceiro + chave da 2733 | **recusa**: "lançamento em duplicidade: NF-4321" + aviso de CNPJ do emitente |
| tipo NF-e de Terceiro, chave vazia | **recusa**: "obrigatória para NF-e de Terceiro" |
| tipo NF-e de Terceiro + chave nova válida (nº 4322, DV 7), série e número zerados | **salva**; o servidor grava série `1` e número `4322`; `existe` → `reclassificar` (chumbados) → "natureza declarada · 14 diferença(s)"; 5 anexos `FP-vendorbill-2734-*` |

A recusa sai pela pilha `validarChaveOuRecusar ← beforeSubmit ← fp_governanca.medir`, fora do
try/catch, como desenhado. A 2734 ficou com a chave nova (cadastro de teste).

### 8.10 Impostos para o GL plug-in pelo `N/cache` (2026-10-02, Rogerio)

Em CSV e webservice a sublista de registro filho não chega (limitação do NetSuite: *custom sublists
aren't available in CSV import*), e o plug-in não tinha o que lançar; a guarda 3 nem simulava
nesses contextos. A Avalara contorna com `afterSubmit` → `https.post` na URL externa de um Suitelet
que recarrega e salva (`AVLR_SuiteTax_UE.js:459-478`), porque UE não dispara UE. Aqui:

| peça | o quê |
|---|---|
| `fp_impostos_cache.js` | `N/cache` PUBLIC `fp_impostos`, chave = `corrId`, TTL 3600 s, linha compacta `[imposto, natureza, valor, compoe, base, aliquota, perna, gera]`, recusa com log acima de 500 KB |
| `fp_ue_simular` | grava o cache ANTES de cada `aplicar` (simulação e `reclassificar`); CSV, SOAP e REST saem da guarda 3 |
| `fp_md_map_simular.aplicar` | sublista ausente no contexto → `log.audit` e não grava a sublista |
| `fp_gl_lines_plugin.lerImpostos` | cache por `custbody_fp_corrid` → sublista → consulta por id; loga de onde leu |

Por que corrId e não id: campo de corpo chega em todo contexto, e o plug-in síncrono não recebe o
id na criação (CustomGLLinesPlugIn.pdf p.17, p.64).

**Medido em 2026-10-02, depois do deploy** — PATCH por REST na vendor bill 2734 (só
`custbody_fp_data_entrada`):

| o quê | resultado |
|---|---|
| (a) `N/cache` dentro do plug-in | **funciona**: `lerImpostos` → `cache · 6 linha(s) · corrId=0BTpWLSH…`; plug-in usou 11 unidades |
| ordem no save | `beforeSubmit` (53 un.) → `afterSubmit` (160 un., 5 anexos) → **plug-in depois do `afterSubmit`** |
| conteúdo | as 6 linhas do cache = as 6 do `customrecord_fp_impostos` (ICMS 12, PIS 1,45, COFINS 6,69 × 2 itens) |
| lançamento | nenhum, e certo: as 6 com `geraLancamento = F` — o `reclassificar` chumbado não traz o campo, e a guarda 2 descarta |

**Ainda NÃO medido:** (b) a ordem cache gravado no `beforeSubmit` → plug-in lê no mesmo save, por CSV; (c) ⚠
reexecução do plug-in por atualização de custo (p.4, p.94) depois do TTL: em CSV/webservice, sem
sublista gravada, não acha nada e a custom line some.

## 22. Substituição de NFS-e no payload de emissão (2026-10-02)

Contrato lido no fonte da plataforma: `EmitirNotaDto.substituicao` = `{ chaveSubstituida (50),
codigoMotivo (TSCodJustSubst 01–05/99), descricaoMotivo?, rpsSubstituido? {numero, serie, tipo} }`,
persistido em `emissao.service.ts:897-916`; 99 sem descrição recusado antes da numeração
(`dps-builder.ts`, `MOTIVO_SUBSTITUICAO_OUTROS`, E0078). `DOC_NUMERO` do bundle = `tx.numero` (o da
DPS/RPS); o número da prefeitura é `nfseNumero` (`emissao.service.ts:3497`).

| peça | o quê |
|---|---|
| `custbody_fp_subst_transacao` (SELECT transação), `custbody_fp_subst_motivo` (`customlist_fp_motivo_subst`, 6 valores), `custbody_fp_subst_descricao` (TEXT 255) | venda, subaba **Substituicao de NFS-e** (`custtab_fp_subst_nfse`, dentro da FiscalPlatform) |
| `montarSubstituicao` no `montarEmissao` | chave = `DOC_CHAVE` da transação apontada (uma consulta); motivo pelo código da lista; descrição se houver. Apontada sem chave LANÇA |
| `rpsSubstituido` | NÃO vai: o tipo do RPS varia por padrão municipal e é da plataforma — HANDOFF item 13 |

Validate 0 erros. **Falta deploy e um payload de emissão de NFS-e com substituição para medir.**

## 23. CT-e a partir da invoice de frete (2026-10-02)

Contrato lido no fonte: `participantes` (`participantes-cte.dto.ts`; o destinatário é a
`contraparte`), `prestacao` (`prestacao-cte.dto.ts`), linhas dispensadas quando há `prestacao`.
Item da invoice é de SERVIÇO (frete) — CT-e não movimenta estoque.

| peça | o quê |
|---|---|
| subaba **CT-e** (`custtab_fp_cte`, dentro da FiscalPlatform) | remetente, expedidor, recebedor, destinatário (entidade), modal, tipo de serviço, produto predominante, valor da carga, uma medida (unidade/tipo/quantidade), chaves das NF-e (texto, uma por linha) |
| listas | `customlist_fp_cte_modal` (01–06), `_tipo_servico` (0–4), `_unidade` (00–05) |
| `aplicarCte` no `montarEmissao`, só com tipo de documento `CTE` | tomador = cliente (`papel` se for um dos quatro, senão `participante`); destinatário vazio = cliente; início = expedidor‖remetente, fim = recebedor‖destinatário; linhas → `componentes`, soma → `valorTotal`; `linhas` sai do payload |
| participantes | UMA consulta `customer UNION ALL vendor` + `entityaddress` do endereço de cobrança padrão — rodada na conta |
| NÃO vão | `icms` e `cfop` (HANDOFF 14 — motor resolve) e o IBGE do município (HANDOFF 15) |

Validate 0 erros. **Até os itens 14 e 15 a plataforma recusa por validação do DTO** — recusa com
mensagem, que é o esperado. Falta deploy e um payload de emissão de CT-e para medir.
