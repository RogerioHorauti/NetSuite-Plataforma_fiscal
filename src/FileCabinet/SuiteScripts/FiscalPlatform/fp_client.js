/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * TRANSPORTE. É o único módulo do bundle que sabe o que é HTTP.
 *
 * Devolve sempre `{ ok, code, body, durationMs }`. **Não lança para HTTP != 2xx** — quem decide o
 * que fazer com uma recusa é o chamador, que é quem sabe se ela vira mensagem na tela, linha de
 * log ou reprocessamento. Lança só para falha de transporte (DNS, TLS, timeout de plataforma).
 *
 * ── SEGREDO: POR QUE `Authorization: Basic`, E NÃO O CORPO JSON ────────────────────────────────
 *
 * MEDIDO no SuiteScript 2.x API Reference (`MEDICOES.md` §5.5):
 *
 *   · `https.createSecureString({input: '{custsecret_x}'})` resolve o segredo do Secrets
 *     Management sem que o script consiga LER o valor. É a única forma de usar credencial sem
 *     tê-la em variável.
 *   · os dois lugares documentados onde uma `SecureString` entra são **header** e **URL**;
 *   · `https.post` tipa `options.body` como **`string | Object | Uint8Array`** — `SecureString`
 *     NÃO está na lista.
 *
 * Consequência: **não existe caminho por corpo JSON que preserve o segredo.** Montar
 * `{"client_secret": "..."}` como string exige o valor em claro na variável, e aí ele vaza no
 * primeiro `log.debug` do payload, na primeira exceção com `JSON.stringify(request)`, ou no
 * primeiro que abrir o script. Guardar em Secrets Management e depois interpolar em string é
 * teatro de segurança.
 *
 * Por isso este módulo usa **`client_secret_basic`** (RFC 6749 §2.3.1): as credenciais vão no
 * header `Authorization: Basic base64(client_id:client_secret)`, montado como `SecureString`. É o
 * caminho que o NetSuite suporta e é uma das duas formas padrão de OAuth2.
 *
 * ⚠ DEPENDE DO MOTOR: `POST /api/v1/oauth/token` hoje só aceita as credenciais no CORPO
 * (`TokenRequestDto`, `oauth.dto.ts:40`). Enquanto ele não aceitar Basic, `obterToken` recebe 401
 * e este módulo **falha alto com mensagem acionável** — de propósito. Não há fallback por corpo:
 * um fallback que "funciona hoje" com o segredo em claro é o que acaba em produção.
 * Pedido registrado em `HANDOFF-FISCALPLATFORM.md` item 9.
 *
 * ── TIMEOUT: NÃO É CONFIGURÁVEL, E ISSO MUDA O DESENHO ─────────────────────────────────────────
 *
 * MEDIDO: `N/https` **não tem parâmetro de timeout**. Os limites são fixos da plataforma —
 * **5 s para negociar a conexão, 45 s para a requisição**, e o estouro vira
 * `SSS_REQUEST_TIME_EXCEEDED`. (O `options.timeout` que existe na documentação é do
 * `N/documentCapture`, não deste módulo.)
 *
 * O que isso significa para a simulação no `beforeSubmit`: motor **inalcançável** bloqueia o save
 * por no máximo ~5 s, o que é tolerável; motor **lento a responder** pode bloquear até 45 s, e
 * isso não tem como encurtar. É risco declarado, não mitigado.
 *
 * ── RETRY: NÃO EXISTE `sleep` EM SUITESCRIPT ───────────────────────────────────────────────────
 *
 * MEDIDO: não há API de sleep/wait em script de servidor. Logo **não há backoff possível dentro
 * de uma chamada**, e busy-wait queimaria governança sem esperar de verdade.
 *
 * Portanto: **uma tentativa por chamada, sempre.** Repetição é responsabilidade de quem orquestra
 * — o Map/Reduce deixa a unidade falhar e o framework reprocessa; o Suitelet devolve o erro para
 * quem clicou decidir. E retry cego sobre emissão é proibido de qualquer forma: timeout sem
 * resposta se resolve por `reconciliar` pela chave, nunca reenviando `/emitir`.
 */
define([
  'N/https',
  'N/cache',
  'N/search',
  'N/record',
  'N/encode',
  'N/runtime',
  'N/log',
  './fp_fields'
], function (https, cache, search, record, encode, runtime, log, fpFields) {
  var NOME_CACHE = 'fp_token';
  var MARGEM_TTL_S = 300;

  /** Escopo do bundle. `fiscal:write` é edição de régua — a fronteira proíbe usar, logo não se pede. */
  var ESCOPO = 'fiscal:read nfe:emit';

  var cfgMemo = {};

  // ─────────────────────────────────────────────────────────────────────────────
  // API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * `POST /fiscal/simular-nota`. Não consome numeração.
   *
   * @param {Object} payload SimulacaoNotaInputDto
   * @param {Object} [opcoes] `{ subsidiaria, corrId, transacao }`
   * @returns {{ok: boolean, code: number, body: Object|string, durationMs: number}}
   */
  /**
   * ⚠ RESPOSTA CHUMBADA, enquanto a plataforma não está no ar.
   *
   * É um retorno REAL de emissão autorizada, capturado da conta em 08/09/2026 — com `linhas[]`,
   * `impostos[]`, perna, `geraLancamento`, chave, protocolo e `cStat 100`. Serve para exercitar a
   * cadeia inteira sem rede: sublist de impostos, plug-in de GL, persistência e anexo.
   *
   * As duas chamadas de verdade estão logo abaixo, comentadas, e é só descomentar quando houver
   * host HTTPS alcançável no `custrecord_fp_api_baseurl`.
   */
  function chumbado() {
    return {
        "id": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
        "branchId": "e85db115-100c-48e6-88fd-b8543a702259",
        "companyId": "73b71ab1-39fc-40e0-90f3-526a8b430df1",
        "tipoDocumentoId": "5f0be825-c85d-429b-9519-9ee5d3ed2213",
        "naturezaOperacaoId": "03ed3852-1abf-4824-b800-3cab03437f7d",
        "certificateId": null,
        "entradaSaida": "S",
        "origem": "EMISSAO",
        "serie": "2",
        "numero": 170,
        "chaveAcesso": "35260910664687000113550020000001701500137044",
        "idExterno": "EMISSAO-08-09-homolog-PV704",
        "cnf": "50013704",
        "status": "AUTORIZADA",
        "ambiente": "homologacao",
        "dataEmissao": "2026-09-08T18:55:07-03:00",
        "dataSaidaEntrada": null,
        "emitCnpj": "10664687000113",
        "emitIe": "119779218111",
        "emitNome": "Group Link Network S.A.",
        "emitUf": "SP",
        "emitMunicipio": "São Paulo",
        "emitIm": "6.047.138-7",
        "emitLogradouro": "Rua Gomes de Carvalho",
        "emitNumero": "1510",
        "emitComplemento": "12º andar",
        "emitBairro": "Vila Olímpia",
        "emitCodigoIbge": "3550308",
        "emitCep": "04547005",
        "emitPais": "1058",
        "destTipo": "PJ",
        "destCnpjCpf": "34564225000192",
        "destIe": "260196711",
        "destNome": "254 MEDEAGE SOLUÇÕES PARA GESTÃO DE UTILITIES LTDA",
        "destEmail": null,
        "destFone": null,
        "destLogradouro": "AVENIDA DAS AGUIAS, 231 - SALA 101 - EDIFICIO INAITEC - Pedr",
        "destNumero": "S/N",
        "destComplemento": null,
        "destBairro": "Centro",
        "destMunicipio": "Palhoça",
        "destUf": "SC",
        "destCep": "88137280",
        "destCodigoIbge": "4211900",
        "destPais": "1058",
        "indPres": "9",
        "indFinal": "1",
        "indIeDest": "1",
        "finNfe": "1",
        "chaveRef": null,
        "substChaveSubstituida": null,
        "substCodigoMotivo": null,
        "substDescricaoMotivo": null,
        "substRpsNumero": null,
        "substRpsSerie": null,
        "substRpsTipo": null,
        "dataReajuste": null,
        "competenciaOriginal": null,
        "totalProdutos": "5143.66",
        "totalDesconto": "0.00",
        "totalFrete": "0.00",
        "totalSeguro": "0.00",
        "totalOutras": "0.00",
        "totalIpi": "0.00",
        "totalIcms": "617.24",
        "totalIcmsSt": "0.00",
        "totalFcp": "0.00",
        "totalPis": "29.42",
        "totalCofins": "135.79",
        "totalIss": "0.00",
        "totalCbs": "46.29",
        "totalIbs": "5.14",
        "totalIs": "0.00",
        "totalNf": "5143.66",
        "payloadErp": {
            "serie": "2",
            "linhas": [
                {
                    "ncm": "85176272",
                    "cest": "21.110.00",
                    "unidade": "UN",
                    "descricao": "GL UTILITIES WATER E GAS MECHANICAL ITR - MIF06H07",
                    "numeroItem": 1,
                    "quantidade": 25,
                    "valorProduto": 205.7464,
                    "codigoProduto": "MIF06H07",
                    "origemProduto": "0"
                }
            ],
            "indPres": 9,
            "branchId": "e85db115-100c-48e6-88fd-b8543a702259",
            "indFinal": 1,
            "idExterno": "EMISSAO-08-09-homolog-PV704",
            "transporte": {
                "modFrete": "9"
            },
            "destinatario": {
                "ie": "260196711",
                "uf": "SC",
                "cep": "88137280",
                "nome": "254 MEDEAGE SOLUÇÕES PARA GESTÃO DE UTILITIES LTDA",
                "bairro": "Centro",
                "numero": "S/N",
                "cnpjCpf": "34564225000192",
                "indIeDest": 1,
                "municipio": "Palhoça",
                "codigoIbge": "4211900",
                "logradouro": "AVENIDA DAS AGUIAS, 231 - SALA 101 - EDIFICIO INAITEC - Pedr"
            },
            "tipoDocumento": "NFE",
            "naturezaOperacaoId": "VENDA"
        },
        "divergencias": null,
        "modalidadeFrete": "9",
        "transporte": null,
        "valorTroco": "0.00",
        "infoAddFisco": null,
        "infoAddContribuinte": null,
        "exportaUfSaidaPais": null,
        "exportaXLocExporta": null,
        "exportaXLocDespacho": null,
        "nRec": null,
        "tMed": null,
        "nProt": "135260008380630",
        "cStat": "100",
        "nfseNumero": null,
        "nfseCodigoVerificacao": null,
        "nfseChaveNacional": null,
        "nfseDataEmissao": null,
        "motivoCancelamento": null,
        "dataCancelamento": null,
        "xMotivo": "Autorizado o uso da NF-e",
        "dhRecbto": "2026-09-08T18:55:08-03:00",
        "dhCont": null,
        "xJust": null,
        "createdAt": "2026-09-08T18:55:07-03:00",
        "updatedAt": "2026-09-08T18:55:08-03:00",
        "linhas": [
            {
                "id": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                "numeroItem": 1,
                "codigoProduto": "MIF06H07",
                "descricao": "GL UTILITIES WATER E GAS MECHANICAL ITR - MIF06H07",
                "ncmCodigo": "8517.62.72",
                "cfopCodigo": "6102",
                "naturezaOperacaoId": null,
                "cfopEmitente": null,
                "unidadeComercial": "UN",
                "quantidadeComercial": "25.0000",
                "valorUnitario": "205.7464000000",
                "infoAdicional": null,
                "codigoBarras": null,
                "codigoBarrasTrib": null,
                "unidadeTributavel": null,
                "quantidadeTributavel": null,
                "valorUnitarioTrib": null,
                "valorBruto": "5143.66",
                "valorFrete": "0.00",
                "valorSeguro": "0.00",
                "valorDesconto": "0.00",
                "valorOutras": "0.00",
                "valorTotal": "5143.66",
                "origemProduto": "0",
                "numeroFci": null,
                "indDoacao": null,
                "indBemMovelUsado": null,
                "tpCredPresIbsZfm": null,
                "creditoIcmsTransferido": null,
                "cest": "2111000",
                "paisResultadoServico": null,
                "consumoNoExterior": null,
                "exTipi": null,
                "tipoItem": null,
                "fatorConversao": null,
                "naturezaReceita": null,
                "codigoItemDeclarante": null,
                "di": null,
                "cprodAnp": null,
                "combustivel": null,
                "dfeRef": null,
                "finalidadeAquisicao": null,
                "finalidadeOrigem": null,
                "createdAt": "2026-09-08T18:55:07-03:00",
                "updatedAt": "2026-09-08T18:55:07-03:00",
                "impostos": [
                    {
                        "id": "44560ede-9f8b-4deb-bc75-236b455735d1",
                        "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                        "transactionLineId": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                        "taxTypeId": "e1a097cf-b79d-439c-b839-73c0106c3d70",
                        "taxCodigo": "ICMS",
                        "cst": "00",
                        "cclasstrib": null,
                        "baseCalculo": "5143.66",
                        "reducaoBase": null,
                        "aliquota": "12.0000",
                        "aliquotaOriginal": null,
                        "reducaoAplicada": null,
                        "valor": "617.24",
                        "retido": false,
                        "comentario": null,
                        "origemCalculo": "MOTOR",
                        "cstOrigem": "TRATAMENTO",
                        "naturezaContabil": "DEBITO",
                        "sentidoDaPernaFixa": "C",
                        "geraLancamento": true,
                        "razaoDaPerna": "imposto devido pela operação: a perna do tributo é a obrigação",
                        "compoeTotalNf": false,
                        "stMvaPercentual": null,
                        "pDif": null,
                        "pFcpDif": null,
                        "pCredSN": null,
                        "vCredICMSSN": null,
                        "vIcmsDeson": null,
                        "motDesIcms": null,
                        "indDeduzDeson": null,
                        "ipiCenq": null,
                        "indISS": null,
                        "indIncentivo": null,
                        "codigoServicoLc116": null,
                        "desdobramentoTribNac": null,
                        "codigoCnae": null,
                        "codigoServicoMunicipalId": null,
                        "nbsSubitemId": null,
                        "codigoMunicipioIss": null,
                        "codigoMunicipioPrestacao": null,
                        "deducaoMaterial": null,
                        "difalAliqInternaDestino": null,
                        "difalAliqInterestadual": null,
                        "difalPercPartilhaDestino": null,
                        "difalFcpDestinoBase": null,
                        "difalFcpDestinoAliquota": null,
                        "difalFcpDestinoValor": null,
                        "createdAt": "2026-09-08T18:55:07-03:00"
                    },
                    {
                        "id": "65f54268-a61d-4485-8ede-a1cfc9a305b6",
                        "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                        "transactionLineId": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                        "taxTypeId": "7a316475-6712-4068-b3f6-1138b0b7257f",
                        "taxCodigo": "PIS",
                        "cst": "01",
                        "cclasstrib": null,
                        "baseCalculo": "4526.42",
                        "reducaoBase": null,
                        "aliquota": "0.6500",
                        "aliquotaOriginal": null,
                        "reducaoAplicada": null,
                        "valor": "29.42",
                        "retido": false,
                        "comentario": "cumulativo (base sem ICMS)",
                        "origemCalculo": "MOTOR",
                        "cstOrigem": null,
                        "naturezaContabil": "DEBITO",
                        "sentidoDaPernaFixa": "C",
                        "geraLancamento": true,
                        "razaoDaPerna": "imposto devido pela operação: a perna do tributo é a obrigação",
                        "compoeTotalNf": false,
                        "stMvaPercentual": null,
                        "pDif": null,
                        "pFcpDif": null,
                        "pCredSN": null,
                        "vCredICMSSN": null,
                        "vIcmsDeson": null,
                        "motDesIcms": null,
                        "indDeduzDeson": null,
                        "ipiCenq": null,
                        "indISS": null,
                        "indIncentivo": null,
                        "codigoServicoLc116": null,
                        "desdobramentoTribNac": null,
                        "codigoCnae": null,
                        "codigoServicoMunicipalId": null,
                        "nbsSubitemId": null,
                        "codigoMunicipioIss": null,
                        "codigoMunicipioPrestacao": null,
                        "deducaoMaterial": null,
                        "difalAliqInternaDestino": null,
                        "difalAliqInterestadual": null,
                        "difalPercPartilhaDestino": null,
                        "difalFcpDestinoBase": null,
                        "difalFcpDestinoAliquota": null,
                        "difalFcpDestinoValor": null,
                        "createdAt": "2026-09-08T18:55:07-03:00"
                    },
                    {
                        "id": "89b68a53-3dd8-435a-bc2f-1e576d1b29b0",
                        "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                        "transactionLineId": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                        "taxTypeId": "fecbbf63-19a2-483d-a4c8-75f93afc7231",
                        "taxCodigo": "COFINS",
                        "cst": "01",
                        "cclasstrib": null,
                        "baseCalculo": "4526.42",
                        "reducaoBase": null,
                        "aliquota": "3.0000",
                        "aliquotaOriginal": null,
                        "reducaoAplicada": null,
                        "valor": "135.79",
                        "retido": false,
                        "comentario": "cumulativo (base sem ICMS)",
                        "origemCalculo": "MOTOR",
                        "cstOrigem": null,
                        "naturezaContabil": "DEBITO",
                        "sentidoDaPernaFixa": "C",
                        "geraLancamento": true,
                        "razaoDaPerna": "imposto devido pela operação: a perna do tributo é a obrigação",
                        "compoeTotalNf": false,
                        "stMvaPercentual": null,
                        "pDif": null,
                        "pFcpDif": null,
                        "pCredSN": null,
                        "vCredICMSSN": null,
                        "vIcmsDeson": null,
                        "motDesIcms": null,
                        "indDeduzDeson": null,
                        "ipiCenq": null,
                        "indISS": null,
                        "indIncentivo": null,
                        "codigoServicoLc116": null,
                        "desdobramentoTribNac": null,
                        "codigoCnae": null,
                        "codigoServicoMunicipalId": null,
                        "nbsSubitemId": null,
                        "codigoMunicipioIss": null,
                        "codigoMunicipioPrestacao": null,
                        "deducaoMaterial": null,
                        "difalAliqInternaDestino": null,
                        "difalAliqInterestadual": null,
                        "difalPercPartilhaDestino": null,
                        "difalFcpDestinoBase": null,
                        "difalFcpDestinoAliquota": null,
                        "difalFcpDestinoValor": null,
                        "createdAt": "2026-09-08T18:55:07-03:00"
                    },
                    {
                        "id": "3cbff4de-29ad-4240-a2cd-be4fde547709",
                        "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                        "transactionLineId": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                        "taxTypeId": "53add3b9-7ff2-4596-b3ee-de5368186eab",
                        "taxCodigo": "CBS",
                        "cst": "000",
                        "cclasstrib": "000001",
                        "baseCalculo": "5143.66",
                        "reducaoBase": null,
                        "aliquota": "0.9000",
                        "aliquotaOriginal": "0.9000",
                        "reducaoAplicada": "0.0000",
                        "valor": "46.29",
                        "retido": false,
                        "comentario": null,
                        "origemCalculo": "MOTOR",
                        "cstOrigem": null,
                        "naturezaContabil": "SEM_EFEITO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "não credita nem custa: não há partida do tributo",
                        "compoeTotalNf": false,
                        "stMvaPercentual": null,
                        "pDif": null,
                        "pFcpDif": null,
                        "pCredSN": null,
                        "vCredICMSSN": null,
                        "vIcmsDeson": null,
                        "motDesIcms": null,
                        "indDeduzDeson": null,
                        "ipiCenq": null,
                        "indISS": null,
                        "indIncentivo": null,
                        "codigoServicoLc116": null,
                        "desdobramentoTribNac": null,
                        "codigoCnae": null,
                        "codigoServicoMunicipalId": null,
                        "nbsSubitemId": null,
                        "codigoMunicipioIss": null,
                        "codigoMunicipioPrestacao": null,
                        "deducaoMaterial": null,
                        "difalAliqInternaDestino": null,
                        "difalAliqInterestadual": null,
                        "difalPercPartilhaDestino": null,
                        "difalFcpDestinoBase": null,
                        "difalFcpDestinoAliquota": null,
                        "difalFcpDestinoValor": null,
                        "createdAt": "2026-09-08T18:55:07-03:00"
                    },
                    {
                        "id": "7b30d2d3-40d0-4b89-a5a4-834a74eea34e",
                        "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                        "transactionLineId": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                        "taxTypeId": "2724782d-0ad9-490f-89ad-b487fec7e000",
                        "taxCodigo": "IBS_ESTADUAL",
                        "cst": "000",
                        "cclasstrib": "000001",
                        "baseCalculo": "5143.66",
                        "reducaoBase": null,
                        "aliquota": "0.1000",
                        "aliquotaOriginal": "0.1000",
                        "reducaoAplicada": "0.0000",
                        "valor": "5.14",
                        "retido": false,
                        "comentario": null,
                        "origemCalculo": "MOTOR",
                        "cstOrigem": null,
                        "naturezaContabil": "SEM_EFEITO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "não credita nem custa: não há partida do tributo",
                        "compoeTotalNf": false,
                        "stMvaPercentual": null,
                        "pDif": null,
                        "pFcpDif": null,
                        "pCredSN": null,
                        "vCredICMSSN": null,
                        "vIcmsDeson": null,
                        "motDesIcms": null,
                        "indDeduzDeson": null,
                        "ipiCenq": null,
                        "indISS": null,
                        "indIncentivo": null,
                        "codigoServicoLc116": null,
                        "desdobramentoTribNac": null,
                        "codigoCnae": null,
                        "codigoServicoMunicipalId": null,
                        "nbsSubitemId": null,
                        "codigoMunicipioIss": null,
                        "codigoMunicipioPrestacao": null,
                        "deducaoMaterial": null,
                        "difalAliqInternaDestino": null,
                        "difalAliqInterestadual": null,
                        "difalPercPartilhaDestino": null,
                        "difalFcpDestinoBase": null,
                        "difalFcpDestinoAliquota": null,
                        "difalFcpDestinoValor": null,
                        "createdAt": "2026-09-08T18:55:07-03:00"
                    },
                    {
                        "id": "b4714f55-d117-42e8-9d06-d2a80a2e2b9b",
                        "transactionId": "ff8cfdfb-8f59-45c5-bf12-2f8b67105a43",
                        "transactionLineId": "1d0c57eb-e0e0-4775-8c78-9130b30c4ee4",
                        "taxTypeId": "5aa108ea-49c3-464a-9aca-fad0810b3486",
                        "taxCodigo": "IBS_MUNICIPAL",
                        "cst": "000",
                        "cclasstrib": "000001",
                        "baseCalculo": "5143.66",
                        "reducaoBase": null,
                        "aliquota": "0.0000",
                        "aliquotaOriginal": "0.0000",
                        "reducaoAplicada": "0.0000",
                        "valor": "0.00",
                        "retido": false,
                        "comentario": null,
                        "origemCalculo": "MOTOR",
                        "cstOrigem": null,
                        "naturezaContabil": "SEM_EFEITO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "não credita nem custa: não há partida do tributo",
                        "compoeTotalNf": false,
                        "stMvaPercentual": null,
                        "pDif": null,
                        "pFcpDif": null,
                        "pCredSN": null,
                        "vCredICMSSN": null,
                        "vIcmsDeson": null,
                        "motDesIcms": null,
                        "indDeduzDeson": null,
                        "ipiCenq": null,
                        "indISS": null,
                        "indIncentivo": null,
                        "codigoServicoLc116": null,
                        "desdobramentoTribNac": null,
                        "codigoCnae": null,
                        "codigoServicoMunicipalId": null,
                        "nbsSubitemId": null,
                        "codigoMunicipioIss": null,
                        "codigoMunicipioPrestacao": null,
                        "deducaoMaterial": null,
                        "difalAliqInternaDestino": null,
                        "difalAliqInterestadual": null,
                        "difalPercPartilhaDestino": null,
                        "difalFcpDestinoBase": null,
                        "difalFcpDestinoAliquota": null,
                        "difalFcpDestinoValor": null,
                        "createdAt": "2026-09-08T18:55:07-03:00"
                    }
                ]
            }
        ],
        "pagamentos": [],
        "danfeUrl": "/api/v1/fiscal/emitir/ff8cfdfb-8f59-45c5-bf12-2f8b67105a43/danfe",
        "xmlUrl": "/api/v1/fiscal/emitir/ff8cfdfb-8f59-45c5-bf12-2f8b67105a43/xml"
    };
  }

  function simularNota(payload, opcoes) {
    // return chamar('POST', '/fiscal/simular-nota', payload, opcoes);
    return { ok: true, code: 200, body: chumbado(), durationMs: 0 };
  }

  /**
   * `POST /fiscal/emitir`. **CONSOME NUMERAÇÃO**, assina e transmite na mesma chamada
   * (`emissao.service.ts:421` → `:2456`). Quando a resposta volta, o número já foi gasto.
   *
   * Sem retry, e não é esquecimento: reenviar o mesmo `idExterno` devolve a nota anterior —
   * inclusive rejeitada. Timeout sem resposta se resolve por `reconciliar`, não reemitindo.
   */
  function emitir(payload, opcoes) {
    // return chamar('POST', '/fiscal/emitir', payload, opcoes);
    //
    // CHUMBADO, mesma resposta do simular: ela veio de uma emissão autorizada de verdade, então
    // traz chave, número, série, protocolo e cStat 100 — é o que a persistência e o botão
    // precisam para serem exercitados. O payload ENVIADO continua sendo montado e gravado: é ele
    // que se confere hoje, não a resposta.
    log.audit('fp_client.emitir', 'RESPOSTA CHUMBADA — nada foi transmitido à SEFAZ. ' +
      'idExterno=' + (payload && payload.idExterno));
    return { ok: true, code: 200, body: chumbado(), durationMs: 0 };
  }

  /** `POST /transacoes/reclassificar`. Endereça o documento pela chave de acesso. */
  function reclassificar(payload, opcoes) {
    return chamar('POST', '/transacoes/reclassificar', payload, opcoes);
  }

  /** GET genérico. `caminho` já com query string quando houver. */
  function obter(caminho, opcoes) {
    return chamar('GET', caminho, null, opcoes);
  }

  /** POST genérico, para os endpoints de evento (`/fiscal/emitir/{id}/cancelar` etc.). */
  function postar(caminho, payload, opcoes) {
    return chamar('POST', caminho, payload, opcoes);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // interno
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET que devolve o corpo CRU, sem `JSON.parse`.
   *
   * XML e DANFE não são JSON: `interpretar` estouraria neles. Mesmo token e mesmo log da chamada
   * normal — o que muda é só não interpretar o corpo.
   *
   * @returns {{ok: boolean, code: number, corpo: string, tipo: string, durationMs: number}}
   */
  function baixar(caminho, opcoes) {
    opcoes = opcoes || {};
    var cfg = configuracao(opcoes.subsidiaria);
    var url = cfg.baseUrl + caminho;

    var inicio = new Date().getTime();
    var resposta = https.get({
      url: url,
      headers: { Accept: '*/*', Authorization: 'Bearer ' + token(cfg) }
    });
    var duracao = new Date().getTime() - inicio;

    // O corpo NÃO vai para o log: XML de nota grande enche o registro e não se lê dali — ele vira
    // anexo na transação, que é onde alguém procura.
    registrar('GET', url, null, resposta.code, '(binário/texto omitido)', duracao, opcoes);

    return {
      ok: resposta.code == 200,
      code: resposta.code,
      corpo: resposta.body,
      tipo: (resposta.headers && (resposta.headers['Content-Type'] || resposta.headers['content-type'])) || '',
      durationMs: duracao
    };
  }

  function chamar(metodo, caminho, payload, opcoes) {
    opcoes = opcoes || {};
    var cfg = configuracao(opcoes.subsidiaria);
    var url = cfg.baseUrl + caminho;

    var cabecalhos = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + token(cfg)
    };

    var corpo = payload ? JSON.stringify(payload) : null;
    var inicio = new Date().getTime();
    var resposta;

    resposta =
      metodo === 'GET'
        ? https.get({ url: url, headers: cabecalhos })
        : https.post({ url: url, headers: cabecalhos, body: corpo });
  

    var duracao = new Date().getTime() - inicio;
    var corpoResposta = interpretar(resposta.body);
    var ok = resposta.code == 200

    registrar(metodo, url, corpo, resposta.code, resposta.body, duracao, opcoes);

    // 401 depois de token válido = token revogado ou expirado antes da margem. Invalida o cache
    // para a PRÓXIMA chamada pegar um novo — sem repetir esta, que é o que o chamador não pediu.
    if (resposta.code === 401) {
      invalidarToken();
      log.error('fp_client.chamar', '401 em ' + caminho + ' — cache de token invalidado');
    }

    return { ok: ok, code: resposta.code, body: corpoResposta, durationMs: duracao };
  }

  /**
   * Token Bearer, do cache ou emitido agora.
   *
   * O `access_token` volta como texto simples na resposta do `/oauth/token` — não é segredo
   * armazenado, é credencial de curta duração —, então ele pode viver em `N/cache` e ser
   * concatenado num header comum. O que **nunca** sai de `SecureString` é o `client_secret`.
   */
  function token(cfg) {
    var c = cache.getCache({ name: NOME_CACHE, scope: cache.Scope.PROTECTED });
    var chave = 'tok_' + cfg.chaveCache;

    var t = c.get({
      key: chave,
      loader: function () {
        return emitirToken(cfg);
      },
      ttl: cfg.ttlToken
    });

    if (!t) throw new Error('fp_client: não foi possível obter token para ' + cfg.chaveCache);
    return t;
  }

  /**
   * `POST /oauth/token` com `client_secret_basic`.
   *
   * O header é montado em `SecureString`, exatamente como o exemplo de Basic auth da referência
   * do SuiteScript: `createSecureString` com os dois placeholders, `convertEncoding` para BASE_64,
   * e `appendSecureString({keepEncoding: true})` sobre o literal `'Basic '`.
   *
   * O `client_id` também entra por placeholder e não por concatenação de string: o par
   * `id:secret` tem de ser base64 do conteúdo INTEIRO, e misturar string comum com SecureString
   * antes do encode produziria um base64 do texto errado.
   */
  function emitirToken(cfg) {
    if (!cfg.secretSegredo) {
      throw new Error(
        'fp_client: subsidiária sem "FP - Script Id do Secret" para ' +
          cfg.chaveCache + '. O segredo vive em Setup > Company > Secrets, nunca em campo texto.'
      );
    }

    var par = https.createSecureString({
      input: '{' + cfg.secretClientId + '}:{' + cfg.secretSegredo + '}'
    });
    par.convertEncoding({
      toEncoding: encode.Encoding.BASE_64,
      fromEncoding: encode.Encoding.UTF_8
    });

    var basic = https.createSecureString({ input: 'Basic ' });
    basic.appendSecureString({ secureString: par, keepEncoding: true });

    var inicio = new Date().getTime();
    var r = https.post({
      url: cfg.baseUrl + '/oauth/token',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: basic
      },
      // `grant_type` e `scope` NÃO são segredo e vão no corpo normalmente. O que saiu do corpo
      // foi só o par de credenciais — ver o docblock do módulo.
      body: JSON.stringify({ grant_type: 'client_credentials', scope: ESCOPO })
    });
    var duracao = new Date().getTime() - inicio;

    if (r.code < 200 || r.code >= 300) {
      // MENSAGEM ACIONÁVEL, e o 401 aqui tem uma causa provável específica.
      var dica =
        r.code === 401
          ? ' — o motor pode não aceitar client_secret_basic ainda. Ver HANDOFF-FISCALPLATFORM.md item 9.'
          : '';
      throw new Error(
        'fp_client: /oauth/token devolveu HTTP ' + r.code + ' em ' + duracao + 'ms' + dica
      );
    }

    var corpo = interpretar(r.body);
    if (!corpo || !corpo.access_token) {
      throw new Error('fp_client: /oauth/token respondeu 2xx sem access_token');
    }

    log.audit('fp_client.emitirToken', 'token obtido em ' + duracao + 'ms · escopo=' + (corpo.scope || '?'));
    return corpo.access_token;
  }

  function invalidarToken() {
    cache.getCache({ name: NOME_CACHE, scope: cache.Scope.PROTECTED }).clear();
  
  }

  /**
   * Configuração da empresa, lida da SUBSIDIÁRIA — registro standard do NetSuite.
   *
   * `company → branch` do FiscalPlatform é `subsidiary → location` aqui, e os campos moram nos
   * dois registros nativos. Não há custom record de configuração: `location.subsidiary` já é a
   * relação, e duplicá-la num cadastro paralelo criaria uma segunda verdade.
   *
   * Mapeamento subsidiária ↔ filial continua sendo RÉGUA — o que impede o bundle de virar um
   * `if (subsidiary === 3)` disfarçado. Só que agora a régua é o CNPJ na Location.
   */
  function configuracao(subsidiaria) {
    var k = String(subsidiaria || 'default');
    if (cfgMemo[k]) return cfgMemo[k];

    if (!subsidiaria) {
      throw new Error('fp_client: configuração exige a subsidiária da transação');
    }

    var l = search.lookupFields({
      type: search.Type.SUBSIDIARY,
      id: subsidiaria,
      columns: [
        fpFields.idSubsidiaria('API_BASEURL'),
        fpFields.idSubsidiaria('API_CLIENTID'),
        fpFields.idSubsidiaria('API_SECRET')
      ]
    });

    var base = (l[fpFields.idSubsidiaria('API_BASEURL')] || '').replace(/\/+$/, '');
    if (!base) {
      throw new Error(
        'fp_client: subsidiária ' + k + ' sem "FP - Base URL da API". Preencha os campos FP na ' +
        'subsidiária (Setup > Company > Subsidiaries) antes de integrar.'
      );
    }

    var cfg = {
      baseUrl: base,
      secretClientId: l[fpFields.idSubsidiaria('API_CLIENTID')] || '',
      secretSegredo: l[fpFields.idSubsidiaria('API_SECRET')] || '',
      chaveCache: k,
      // TTL do cache abaixo do TTL do token, para nunca usar token no fio da navalha. O `/oauth/
      // token` do motor tem default 3.600 s (`oauth.dto.ts:26`); se o client for configurado com
      // outro, este número tem de acompanhar.
      ttlToken: 3600 - MARGEM_TTL_S
    };

    cfgMemo[k] = cfg;
    return cfg;
  }

  /**
   * CNPJ da filial, lido da LOCATION — é a chave que o FiscalPlatform usa para achar a branch.
   *
   * 14 dígitos sem máscara. O banco de lá só aceita dígitos (`chk_branches_cnpj_digitos`) e nada
   * completa zero à esquerda: CNPJ com zero suprimido não acha filial nenhuma. Devolve `null`
   * quando a location não tem CNPJ — quem chama decide se isso é erro ou transação sem filial.
   */
  function cnpjDaFilial(location) {
    if (!location) return null;
    var l = search.lookupFields({
      type: search.Type.LOCATION,
      id: location,
      columns: [fpFields.idLocation('CNPJ'), fpFields.idLocation('SERIE')]
    });
    var cnpj = String(l[fpFields.idLocation('CNPJ')] || '').replace(/\D/g, '');
    return cnpj ? { cnpj: cnpj, serie: l[fpFields.idLocation('SERIE')] || '' } : null;
  
  }

  /** JSON quando dá; o texto cru quando não. Corpo ilegível é dado de diagnóstico, não erro. */
  function interpretar(corpo) {
    if (!corpo) return null;
    return JSON.parse(corpo);
  
  }

  /**
   * Grava a chamada no `customrecord_fp_log`.
   *
   * **O PAYLOAD ENVIADO VAI JUNTO DO RETORNO, SEMPRE.** Sem ele, "o motor errou" e "eu mandei
   * errado" são indistinguíveis — e a segunda é a hipótese mais frequente.
   *
   * **OS HEADERS NÃO ENTRAM.** Nem o `Authorization`, nem "só o começo dele". Log de payload não
   * carrega credencial, e um Bearer em log é um Bearer vazado.
   *
   * Falha ao gravar log **não derruba a chamada**: perder o rastro é ruim, perder a emissão é pior.
   */
  function registrar(metodo, url, corpo, code, resposta, duracao, opcoes) {
    var tipo = fpFields.registro('LOG');
    if (!tipo) return;

    var r = record.create({ type: tipo, isDynamic: false });
    r.setValue({ fieldId: fpFields.idLog('ENDPOINT'), value: String(url).substring(0, 300) });
    r.setValue({ fieldId: fpFields.idLog('METODO'), value: metodo });
    r.setValue({ fieldId: fpFields.idLog('DURACAO'), value: duracao });
    if (code !== null && code !== undefined) {
      r.setValue({ fieldId: fpFields.idLog('HTTP'), value: code });
    }
    if (corpo) r.setValue({ fieldId: fpFields.idLog('PAYLOAD'), value: corpo });
    if (resposta) r.setValue({ fieldId: fpFields.idLog('RESPOSTA'), value: String(resposta) });
    if (opcoes && opcoes.corrId) {
      r.setValue({ fieldId: fpFields.idLog('CORRID'), value: opcoes.corrId });
    }
    if (opcoes && opcoes.transacao) {
      r.setValue({ fieldId: fpFields.idLog('TRANSACAO'), value: opcoes.transacao });
    }
    r.save({ ignoreMandatoryFields: true });
  
  }

  return {
    simularNota: simularNota,
    emitir: emitir,
    reclassificar: reclassificar,
    obter: obter,
    baixar: baixar,
    postar: postar,
    configuracao: configuracao,
    cnpjDaFilial: cnpjDaFilial,
    invalidarToken: invalidarToken
  };
});
