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
        "cnpjEmpresa": "10664687000113",
        "naturezaOperacaoId": "COMPRA_IMPORT",
        "dataEmissao": "2026-06-12",
        "linhas": [
            {
                "ncm": "9030.84.90",
                "descricao": "Importacao PTC-810 - simular-nota via cnpjEmpresa (regra baixa II 20% para 10%)",
                "valorProduto": 49320.54,
                "quantidade": 1,
                "numeroItem": 1,
                "cfopCodigo": "3102",
                "valorBruto": 49320.54,
                "valorTotal": 49320.54,
                "impostos": [
                    {
                        "taxCodigo": "II",
                        "taxLabel": "II",
                        "cst": null,
                        "cclasstrib": null,
                        "baseCalculo": 49320.54,
                        "aliquota": 12.6,
                        "valor": 6214.39,
                        "retido": false,
                        "naturezaContabil": "CUSTO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "o tributo é custo: ele já está na perna da operação, e não tem perna própria",
                        "compoeTotalNf": true,
                        "comentario": "Imposto de Importacao (base = valor aduaneiro; origem NCM_IMPORTACAO) — ATENCAO: nenhuma despesa aduaneira informada (despesasBaseII/despesasBaseIcms/di.vAFRMM = 0); a base pode estar subestimada. Importacao raramente tem base sem Siscomex/AFRMM/capatazia — confira o valor aduaneiro.",
                        "origemCalculo": "CALCULADO",
                        "cenario": "ATUAL",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "IPI_IMP",
                        "taxLabel": "IPI",
                        "cst": "49",
                        "cclasstrib": null,
                        "baseCalculo": 55534.93,
                        "aliquota": 3.25,
                        "valor": 1804.89,
                        "retido": false,
                        "naturezaContabil": "CUSTO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "o tributo é custo: ele já está na perna da operação, e não tem perna própria",
                        "compoeTotalNf": true,
                        "comentario": "IPI-importacao (base = aduaneiro + II)",
                        "origemCalculo": "CALCULADO",
                        "cenario": "ATUAL",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "PIS_IMP",
                        "taxLabel": "PIS",
                        "cst": "70",
                        "cclasstrib": null,
                        "baseCalculo": 49320.54,
                        "aliquota": 2.1,
                        "valor": 1035.73,
                        "retido": false,
                        "naturezaContabil": "CUSTO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "o tributo é custo: ele já está na perna da operação, e não tem perna própria",
                        "compoeTotalNf": true,
                        "comentario": "PIS-importacao (Lei 10.865)",
                        "origemCalculo": "CALCULADO",
                        "cenario": "ATUAL",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "COFINS_IMP",
                        "taxLabel": "COFINS",
                        "cst": "70",
                        "cclasstrib": null,
                        "baseCalculo": 49320.54,
                        "aliquota": 9.65,
                        "valor": 4759.43,
                        "retido": false,
                        "naturezaContabil": "CUSTO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "o tributo é custo: ele já está na perna da operação, e não tem perna própria",
                        "compoeTotalNf": true,
                        "comentario": "COFINS-importacao (Lei 10.865)",
                        "origemCalculo": "CALCULADO",
                        "cenario": "ATUAL",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "ICMS_IMP",
                        "taxLabel": "ICMS",
                        "cst": "00",
                        "cclasstrib": null,
                        "baseCalculo": 0,
                        "aliquota": 0,
                        "valor": 0,
                        "retido": false,
                        "naturezaContabil": "RECUPERAVEL_INTEGRAL",
                        "sentidoDaPernaFixa": "D",
                        "geraLancamento": true,
                        "razaoDaPerna": "crédito do imposto: a perna do tributo é o direito a recuperar",
                        "compoeTotalNf": true,
                        "comentario": "ICMS-importacao NAO CALCULADO: interna do estado de desembaraco nao configurada (ncm_tax_rates/uf_difal_config) nem informada no request. Configure a UF de desembaraco.",
                        "origemCalculo": "CALCULADO",
                        "cenario": "ATUAL",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "CBS",
                        "taxLabel": "CBS",
                        "cst": "000",
                        "cclasstrib": "000001",
                        "baseCalculo": 49320.54,
                        "aliquota": 0.9,
                        "aliquotaOriginal": 0.9,
                        "reducaoAplicada": 0,
                        "valor": 443.88,
                        "retido": false,
                        "naturezaContabil": "SEM_EFEITO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "não credita nem custa: não há partida do tributo",
                        "compoeTotalNf": false,
                        "comentario": null,
                        "origemCalculo": "CALCULADO",
                        "cenario": "REFORMA",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "IBS_ESTADUAL",
                        "taxLabel": "IBS Estadual",
                        "cst": "000",
                        "cclasstrib": "000001",
                        "baseCalculo": 49320.54,
                        "aliquota": 0.1,
                        "aliquotaOriginal": 0.1,
                        "reducaoAplicada": 0,
                        "valor": 49.32,
                        "retido": false,
                        "naturezaContabil": "SEM_EFEITO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "não credita nem custa: não há partida do tributo",
                        "compoeTotalNf": false,
                        "comentario": null,
                        "origemCalculo": "CALCULADO",
                        "cenario": "REFORMA",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    },
                    {
                        "taxCodigo": "IBS_MUNICIPAL",
                        "taxLabel": "IBS Municipal",
                        "cst": "000",
                        "cclasstrib": "000001",
                        "baseCalculo": 49320.54,
                        "aliquota": 0,
                        "aliquotaOriginal": 0,
                        "reducaoAplicada": 0,
                        "valor": 0,
                        "retido": false,
                        "naturezaContabil": "SEM_EFEITO",
                        "sentidoDaPernaFixa": null,
                        "geraLancamento": false,
                        "razaoDaPerna": "não credita nem custa: não há partida do tributo",
                        "compoeTotalNf": false,
                        "comentario": null,
                        "origemCalculo": "CALCULADO",
                        "cenario": "REFORMA",
                        "deducaoMaterial": null,
                        "cstOrigem": null,
                        "ipiCenq": null
                    }
                ]
            }
        ],
        "totalProdutos": 49320.54,
        "totalNf": 63134.98
    }

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
    // CHUMBADO. ⚠ Até 2026-09-30 esta linha devolvia o `chumbado()` do SIMULAR — sem chave, sem
    // status —, e o comentário dizia o contrário. Nenhuma transação chegava a AUTORIZADA, e a
    // gravação do retorno da emissão nunca rodou (MEDICOES §15). Agora é a forma de
    // `TransactionComLinks`, que é o que o `POST /fiscal/emitir` devolve.
    log.audit('fp_client.emitir', 'RESPOSTA CHUMBADA — nada foi transmitido à SEFAZ. ' +
      'idExterno=' + (payload && payload.idExterno));
    return { ok: true, code: 200, body: emissaoChumbada(payload), durationMs: 0 };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHUMBADO — enquanto a plataforma não está no ar
  // ─────────────────────────────────────────────────────────────────────────────
  //
  // Cada resposta tem a FORMA que a rota real devolve, lida no fonte (emissao.controller.ts,
  // emissao.service.ts, nfe-transmissao.service.ts, nfe-reconciliacao.service.ts). É a forma que
  // se exercita aqui — o persist e o Suitelet —, não o conteúdo fiscal. Tudo sai no log como
  // "RESPOSTA CHUMBADA", e nada vai à rede.
  //
  // Para voltar ao real: `emitir` e `postar` chamam `chamar`, e as funções abaixo saem.

  /**
   * Nota AUTORIZADA derivada do payload. Idempotente como a rota real: o mesmo `idExterno` dá o
   * mesmo número e a mesma chave. cUF 35 fixo — a filial desta conta é SP. Número na faixa
   * 900.000.000+, que nenhuma série real alcança, para não se confundir com número de verdade.
   */
  function emissaoChumbada(p) {
    p = p || {};
    var numero = 900000000 + (parseInt(p.idExterno, 10) || 0);
    var serie = String(p.serie || '1');
    var d = String(p.dataEmissao || '2026-01-01');
    var mdfe = p.tipoDocumento === 'MDFE';
    if (mdfe) numero = 900000000 + (parseInt(String(p.idExterno).replace(/\D/g, ''), 10) || 0);
    var chave = chaveDeAcesso('35', d.substring(2, 4) + d.substring(5, 7), p.cnpjEmpresa, mdfe ? '58' : '55',
      serie, numero, '1', String(p.idExterno || 0).replace(/\D/g, '') || '0');
    // MDF-e: a forma da entidade `Mdfe` (`situacao` masculino, `mdfe.entity.ts:15`).
    if (mdfe) {
      return { chaveAcesso: chave, numero: numero, serie: serie, situacao: 'AUTORIZADO', cStat: '100',
        xMotivo: 'Autorizado o uso do MDF-e (CHUMBADO)', nProt: '1' + chave.substring(25, 39), ambiente: 2,
        idExterno: p.idExterno || null };
    }
    return {
      chaveAcesso: chave,
      numero: numero,
      serie: serie,
      status: 'AUTORIZADA',
      cStat: '100',
      xMotivo: 'Autorizado o uso da NF-e (CHUMBADO)',
      nProt: '1' + chave.substring(25, 39),
      ambiente: '2',
      idExterno: p.idExterno || null
    };
  }

  /** 44 dígitos: cUF AAMM CNPJ mod série(3) nNF(9) tpEmis cNF(8) DV — DV módulo 11, pesos 2..9. */
  function chaveDeAcesso(cUF, aamm, cnpj, mod, serie, nNF, tpEmis, semente) {
    var zeros = function (v, n) { v = String(v).replace(/\D/g, ''); while (v.length < n) v = '0' + v; return v.slice(-n); };
    var base = zeros(cUF, 2) + zeros(aamm, 4) + zeros(cnpj, 14) + zeros(mod, 2) + zeros(serie, 3) +
      zeros(nNF, 9) + zeros(tpEmis, 1) + zeros(semente, 8);
    var soma = 0, peso = 2;
    for (var i = base.length - 1; i >= 0; i--) { soma += Number(base.charAt(i)) * peso; peso = peso === 9 ? 2 : peso + 1; }
    var resto = soma % 11;
    return base + (resto < 2 ? 0 : 11 - resto);
  }

  /**
   * A resposta de cada rota de evento, na forma dela:
   *   consultar     → TransactionComLinks (a transação solta, como o emitir)
   *   reconciliar   → ResultadoReconciliacao { chaveAcesso, statusAnterior, desfecho, statusNovo?, cStat, xMotivo, nProt? }
   *   cancelar      → { transaction, evento }
   *   carta-correcao→ { transaction, evento }
   *   inutilizar    → { sucesso, cStat, xMotivo, nProt, dhRecbto, id } — da INUTILIZAÇÃO, não da nota
   */
  function eventoChumbado(caminho, payload) {
    var m = /\/(?:emitir|nfe)\/([^/]+)\/([a-z-]+)$/.exec(caminho) || [];
    var chave = m[1] || '';
    var acao = m[2] || '';
    var prot = '1' + String(chave).substring(25, 39);

    if (acao === 'consultar') {
      return { chaveAcesso: chave, status: 'AUTORIZADA', cStat: '100',
        xMotivo: 'Autorizado o uso da NF-e (CHUMBADO)', nProt: prot };
    }
    if (acao === 'reconciliar') {
      return { chaveAcesso: chave, statusAnterior: 'PROCESSANDO', desfecho: 'AUTORIZADA',
        statusNovo: 'AUTORIZADA', cStat: '100', xMotivo: 'Autorizado o uso da NF-e (CHUMBADO)', nProt: prot };
    }
    if (acao === 'cancelar') {
      return {
        transaction: { chaveAcesso: chave, status: 'CANCELADA' },
        evento: { sucesso: true, cStat: '135', xMotivo: 'Evento registrado e vinculado a NF-e (CHUMBADO)',
          nProt: '2' + String(chave).substring(25, 39), nSeqEvento: 1, xmlUrl: null }
      };
    }
    if (acao === 'carta-correcao') {
      return {
        transaction: { chaveAcesso: chave, status: 'AUTORIZADA' },
        evento: { sucesso: true, cStat: '135', xMotivo: 'Evento registrado e vinculado a NF-e (CHUMBADO)',
          nProt: '3' + String(chave).substring(25, 39), nSeqEvento: 1, xmlUrl: null }
      };
    }
    if (acao === 'inutilizar') {
      return { sucesso: true, cStat: '102', xMotivo: 'Inutilizacao de numero homologado (CHUMBADO)',
        nProt: '4' + String(chave).substring(25, 39), dhRecbto: null, id: null };
    }
    return null;
  }

  /**
   * `GET /fiscal/emitir/status-sefaz` — o autorizador da UF está no ar? Read-only, cache de 60 s
   * por filial do lado da plataforma. Devolve `{ cStat, xMotivo, emOperacao, tMed?, dhRetorno?,
   * xObs?, deCache }` (`nfe-autorizacao.client.ts:969`).
   */
  function statusSefaz(cnpjEmpresa, opcoes) {
    var caminho = '/fiscal/emitir/status-sefaz?cnpjEmpresa=' + encodeURIComponent(String(cnpjEmpresa || ''));
    // return obter(caminho, opcoes);
    log.audit('fp_client.statusSefaz', 'RESPOSTA CHUMBADA — nada foi à rede. ' + caminho);
    return { ok: true, code: 200, durationMs: 0,
      body: { cStat: '107', xMotivo: 'Servico em Operacao (CHUMBADO)', emOperacao: true, deCache: false } };
  }

  /**
   * `GET /transacoes/chave/:chave/existe?entradaSaida=E&cnpj=` — a nota do fornecedor já chegou pelo
   * DF-e? Devolve `{ existe, ocorrencias, id?, status?, numero? }` (`transacoes.service.existePorChave`).
   * O `id` é UUID da plataforma e NÃO entra no NetSuite.
   */
  function existePorChave(chave, cnpjFilial, opcoes) {
    var caminho = '/transacoes/chave/' + encodeURIComponent(String(chave)) + '/existe?entradaSaida=E&cnpj=' +
      encodeURIComponent(String(cnpjFilial || ''));
    // return obter(caminho, opcoes);
    log.audit('fp_client.existePorChave', 'RESPOSTA CHUMBADA — nada foi à rede. ' + caminho);
    return { ok: true, code: 200, durationMs: 0,
      body: { existe: true, ocorrencias: 1, status: 'AUTORIZADA', numero: 12345 } };
  }

  /**
   * `POST /transacoes/reclassificar`. Endereça o documento pela chave de acesso e devolve o
   * documento DETALHADO (`transacoes.service.detalhar`): `linhas[].impostos[]` com `taxCodigo`, `cst`,
   * `cclasstrib`, `baseCalculo`, `reducaoBase`, `aliquota`, `valor`, `naturezaContabil`,
   * `compoeTotalNf` — os nomes do resultado do `/simular`.
   */
  function reclassificar(payload, opcoes) {
    // return chamar('POST', '/transacoes/reclassificar', payload, opcoes);
    log.audit('fp_client.reclassificar', 'RESPOSTA CHUMBADA — nada foi à rede. chave=' + (payload && payload.chaveAcesso));
    return { ok: true, code: 200, durationMs: 0, body: reclassificacaoChumbada(payload) };
  }

  /**
   * O documento detalhado, na forma de `detalhar`. Sem o XML não há valor de verdade: uma linha por
   * `numeroItem` declarado (ou uma só), base 100 e ICMS/PIS/COFINS de entrada — é a FORMA que se
   * exercita, não o conteúdo.
   */
  function reclassificacaoChumbada(p) {
    p = p || {};
    var n = 1;
    (p.linhas || []).forEach(function (l) { if (l.numeroItem > n) n = l.numeroItem; });
    var linhas = [];
    for (var i = 1; i <= n; i++) {
      linhas.push({ numeroItem: i, impostos: [
        { taxCodigo: 'ICMS', cst: '00', cclasstrib: null, baseCalculo: 100, reducaoBase: null, aliquota: 12, valor: 12, naturezaContabil: 'RECUPERAVEL_INTEGRAL', compoeTotalNf: false },
        { taxCodigo: 'PIS', cst: '50', cclasstrib: null, baseCalculo: 88, reducaoBase: null, aliquota: 1.65, valor: 1.45, naturezaContabil: 'RECUPERAVEL_INTEGRAL', compoeTotalNf: false },
        { taxCodigo: 'COFINS', cst: '50', cclasstrib: null, baseCalculo: 88, reducaoBase: null, aliquota: 7.6, valor: 6.69, naturezaContabil: 'RECUPERAVEL_INTEGRAL', compoeTotalNf: false }
      ] });
    }
    return { chaveAcesso: p.chaveAcesso, origem: 'CAPTURA_XML', status: 'AUTORIZADA', entradaSaida: 'E',
      naturezaOperacao: p.naturezaOperacao || null, dataEntrada: p.dataEntrada || null, linhas: linhas };
  }

  /** GET genérico. `caminho` já com query string quando houver. */
  function obter(caminho, opcoes) {
    return chamar('GET', caminho, null, opcoes);
  }

  /** POST genérico, para os endpoints de evento (`/fiscal/emitir/{id}/cancelar` etc.). */
  function postar(caminho, payload, opcoes) {
    // return chamar('POST', caminho, payload, opcoes);
    var corpo = eventoChumbado(caminho, payload);
    if (!corpo) return chamar('POST', caminho, payload, opcoes);
    log.audit('fp_client.postar', 'RESPOSTA CHUMBADA — nada foi à rede. ' + caminho);
    return { ok: true, code: 200, body: corpo, durationMs: 0 };
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
   * A CHAMADA VAI PARA O LOG DE EXECUÇÃO, não para um custom record.
   *
   * Havia um `customrecord_fp_log` com oito campos gravando endpoint, método, duração, HTTP,
   * payload e resposta de CADA chamada. Ele foi removido: era uma tabela que cresce sem limite
   * para guardar o que o log de execução do NetSuite já guarda, e o payload de verdade — o que
   * interessa conferir — está anexado à própria transação.
   *
   * Aqui fica só a linha de auditoria. Payload e resposta NÃO entram nela: nota de centenas de
   * linhas encheria o log e o dado útil está no anexo.
   */
  function registrar(metodo, url, corpo, code, resposta, duracao, opcoes) {
    log.audit('fp_client', metodo + ' ' + url + ' → ' + code + ' em ' + duracao + 'ms' +
      (opcoes && opcoes.corrId ? ' · corrId ' + opcoes.corrId : '') +
      (opcoes && opcoes.transacao ? ' · transação ' + opcoes.transacao : ''));
  }

  return {
    simularNota: simularNota,
    emitir: emitir,
    statusSefaz: statusSefaz,
    existePorChave: existePorChave,
    reclassificar: reclassificar,
    obter: obter,
    baixar: baixar,
    postar: postar,
    configuracao: configuracao,
    cnpjDaFilial: cnpjDaFilial,
    invalidarToken: invalidarToken
  };
});
