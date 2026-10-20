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
 * ── CREDENCIAL: PREFERÊNCIA DE EMPRESA, CORPO FORM-URLENCODED ─────────────────────────────────
 *
 * O motor lê as credenciais só do CORPO (`client_secret_post`, `oauth.controller.ts:43`). O
 * client_id e o client_secret vêm dos parâmetros de EMPRESA `custscript_fp_client_id` e
 * `custscript_fp_client_secret` (Setup > Company > General Preferences > Custom Preferences),
 * declarados no `customscript_fp_ue_simular` como a `custscript_fp_pasta_payload`. API Secrets
 * não deu para criar em Company na conta (2026-10-19). O segredo nunca vai para log.
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
  'N/runtime',
  'N/log',
  './fp_fields'
], function (https, cache, search, record, runtime, log, fpFields) {
  var NOME_CACHE = 'fp_token';
  var MARGEM_TTL_S = 300;

  /**
   * A CONEXÃO, NO CÓDIGO (2026-10-07, Rogerio) — nada de configuração por subsidiária.
   *
   *   BASE_URL        a API. Sem barra no fim; os caminhos já começam com `/`.
   *   PARAM_*         os parâmetros de EMPRESA com o client id e o client secret do OAuth. O VALOR
   *                   mora na preferência, nunca aqui nem em log.
   *
   * Uma plataforma e um client OAuth para a conta inteira. O escopo do tenant vem do token, e a
   * filial de cada documento, do CNPJ da Location (`cnpjDaFilial`).
   */
  var BASE_URL = 'https://hml.fiscalplatform.com.br/api/v1';
  var PARAM_CLIENT_ID = 'custscript_fp_client_id';
  var PARAM_CLIENT_SECRET = 'custscript_fp_client_secret';

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
  function simularNota(payload, opcoes) {
    return chamar('POST', '/fiscal/simular-nota', payload, opcoes);
  }

  /**
   * `POST /fiscal/emitir`. **CONSOME NUMERAÇÃO**, assina e transmite na mesma chamada
   * (`emissao.service.ts:421` → `:2456`). Quando a resposta volta, o número já foi gasto.
   *
   * Sem retry, e não é esquecimento: reenviar o mesmo `idExterno` devolve a nota anterior —
   * inclusive rejeitada. Timeout sem resposta se resolve por `reconciliar`, não reemitindo.
   */
  function emitir(payload, opcoes) {
    return chamar('POST', '/fiscal/emitir', payload, opcoes);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHUMBADO — só os eventos que gravam na SEFAZ (cancelar, CC-e, inutilizar, encerrar/cancelar
  // MDF-e). A plataforma está no ar em hml desde 2026-10-19; o resto, emitir incluso, vai à rede.
  // ─────────────────────────────────────────────────────────────────────────────
  //
  // Cada resposta tem a FORMA que a rota real devolve, lida no fonte (emissao.controller.ts,
  // emissao.service.ts, nfe-transmissao.service.ts, nfe-reconciliacao.service.ts). É a forma que
  // se exercita aqui — o persist e o Suitelet —, não o conteúdo fiscal. Tudo sai no log como
  // "RESPOSTA CHUMBADA", e nada vai à rede.
  //
  // Para voltar ao real: `postar` chama `chamar`, e a função abaixo sai.

  /**
   * A resposta de cada rota de evento, na forma dela:
   *   consultar     → TransactionComLinks (a transação solta, como o emitir)
   *   reconciliar   → ResultadoReconciliacao { chaveAcesso, statusAnterior, desfecho, statusNovo?, cStat, xMotivo, nProt? }
   *   cancelar      → { transaction, evento }
   *   carta-correcao→ { transaction, evento }
   *   inutilizar    → { sucesso, cStat, xMotivo, nProt, dhRecbto, id } — da INUTILIZAÇÃO, não da nota
   */
  function eventoChumbado(caminho, payload) {
    // MDF-e: `ResultadoEventoMdfe` (`mdfe-eventos.service.ts:57`) no encerrar/cancelar; a forma da
    // reconciliação (`situacao.service.ts:78-81`) no reconciliar.
    var md = /\/mdfe\/([^/]+)\/(encerrar|cancelar|reconciliar)$/.exec(caminho);
    if (md) {
      var tp = { encerrar: '110112', cancelar: '110111' }[md[2]];
      if (!tp) return { chaveAcesso: md[1], situacaoAnterior: 'EM_TRANSMISSAO', situacaoNova: 'AUTORIZADO',
        cStat: '100', xMotivo: 'Autorizado o uso do MDF-e (CHUMBADO)' };
      return { id: null, chaveAcesso: md[1], tpEvento: tp, nSeqEvento: 1, situacao: 'REGISTRADO', cStat: '135',
        xMotivo: 'Evento registrado e vinculado a MDF-e (CHUMBADO)', nProt: '2' + String(md[1]).substring(25, 39) };
    }
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
    return obter(caminho, opcoes);
  }

  /**
   * `GET /transacoes/chave/:chave/existe?entradaSaida=E&cnpj=` — a nota do fornecedor já chegou pelo
   * DF-e? Devolve `{ existe, ocorrencias, id?, status?, numero? }` (`transacoes.service.existePorChave`).
   * O `id` é UUID da plataforma e NÃO entra no NetSuite.
   */
  function existePorChave(chave, cnpjFilial, opcoes) {
    var caminho = '/transacoes/chave/' + encodeURIComponent(String(chave)) + '/existe?entradaSaida=E&cnpj=' +
      encodeURIComponent(String(cnpjFilial || ''));
    return obter(caminho, opcoes);
  }

  /**
   * `POST /transacoes/reclassificar`. Endereça o documento pela chave de acesso e devolve o
   * documento DETALHADO (`transacoes.service.detalhar`): `linhas[].impostos[]` com `taxCodigo`, `cst`,
   * `cclasstrib`, `baseCalculo`, `reducaoBase`, `aliquota`, `valor`, `naturezaContabil`,
   * `compoeTotalNf` — os nomes do resultado do `/simular`.
   */
  function reclassificar(payload, opcoes) {
    return chamar('POST', '/transacoes/reclassificar', payload, opcoes);
  }

  /** GET genérico. `caminho` já com query string quando houver. */
  function obter(caminho, opcoes) {
    return chamar('GET', caminho, null, opcoes);
  }

  /** POST genérico, para os endpoints de evento (`/fiscal/emitir/{id}/cancelar` etc.). */
  function postar(caminho, payload, opcoes) {
    // consultar/reconciliar só leem a SEFAZ: vão à rede. Os eventos que gravam seguem chumbados.
    var corpo = /\/(consultar|reconciliar)$/.test(caminho) ? null : eventoChumbado(caminho, payload);
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
    var cfg = configuracao();
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
    var cfg = configuracao();
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
    // 2xx, não só 200: o `/fiscal/emitir` responde 201 Created, e com `== 200` a emissão aceita
    // caía no ramo de recusa — chave e status não chegavam à transação.
    var ok = resposta.code >= 200 && resposta.code < 300;

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
   * concatenado num header comum. O `client_secret` nunca vai para cache nem log.
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
   * `POST /oauth/token` com as credenciais NO CORPO (`client_secret_post`), que é o que o motor lê
   * (`oauth.controller.ts:43`, `@Body() TokenRequestDto`), em `x-www-form-urlencoded`.
   *
   * Medido (`MEDICOES.md` §27): form-urlencoded dá 200 no hml. Os valores vêm das preferências de
   * empresa (`credenciais`); o corpo nunca vai para log.
   */
  function emitirToken(cfg) {
    var cred = credenciais();
    var corpo =
      'grant_type=client_credentials' +
      '&client_id=' + encodeURIComponent(cred.clientId) +
      '&client_secret=' + encodeURIComponent(cred.clientSecret) +
      '&scope=' + encodeURIComponent(ESCOPO);

    var inicio = new Date().getTime();
    var r = https.request({
      method: https.Method.POST,
      url: cfg.baseUrl + '/oauth/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: corpo
    });
    var duracao = new Date().getTime() - inicio;

    if (r.code < 200 || r.code >= 300) {
      // O corpo da recusa vem do motor ("client_id inválido ou inativo") e é o que diz a causa.
      throw new Error(
        'fp_client: /oauth/token devolveu HTTP ' + r.code + ' em ' + duracao + 'ms: ' + String(r.body || '').slice(0, 300)
      );
    }

    var resposta = interpretar(r.body);
    if (!resposta || !resposta.access_token) {
      throw new Error('fp_client: /oauth/token respondeu 2xx sem access_token');
    }

    log.audit('fp_client.emitirToken', 'token obtido em ' + duracao + 'ms · escopo=' + (resposta.scope || '?'));
    return resposta.access_token;
  }

  /**
   * client_id e client_secret das preferências de EMPRESA. Lido só com o cache de token vazio. Em
   * branco lança com o nome da preferência: o motor responderia só "client_id inválido", que não
   * diz onde está a falta.
   */
  function credenciais() {
    var script = runtime.getCurrentScript();
    var clientId = script.getParameter({ name: PARAM_CLIENT_ID });
    var clientSecret = script.getParameter({ name: PARAM_CLIENT_SECRET });
    if (!clientId || !clientSecret) {
      throw new Error(
        'fp_client: preencha "FiscalPlatform Client ID" e "FiscalPlatform Client Secret" em Setup > Company > ' +
        'General Preferences > Custom Preferences (' + PARAM_CLIENT_ID + ' / ' + PARAM_CLIENT_SECRET + ').'
      );
    }
    return { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() };
  }

  function invalidarToken() {
    cache.getCache({ name: NOME_CACHE, scope: cache.Scope.PROTECTED }).clear();
  
  }

  /**
   * A configuração da conexão — constantes do topo deste arquivo. O parâmetro `subsidiaria` que os
   * chamadores passam não decide mais nada aqui; a filial de cada documento vem do CNPJ da Location.
   */
  function configuracao() {
    if (cfgMemo.fp) return cfgMemo.fp;
    if (!BASE_URL) {
      throw new Error('fp_client: BASE_URL da API não definida no fp_client.js.');
    }
    cfgMemo.fp = {
      baseUrl: BASE_URL,
      chaveCache: 'fp',
      // TTL do cache abaixo do TTL do token, para nunca usar token no fio da navalha. O `/oauth/
      // token` do motor tem default 3.600 s (`oauth.dto.ts:26`); se o client for configurado com
      // outro, este número tem de acompanhar.
      ttlToken: 3600 - MARGEM_TTL_S
    };
    return cfgMemo.fp;
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
