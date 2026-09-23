/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * CAMADA DE COMPATIBILIDADE — NOME LÓGICO → SCRIPTID FÍSICO.
 *
 * Nenhum outro módulo do bundle escreve scriptid literal. Todos perguntam aqui:
 *
 *     fpFields.id('DOC_CHAVE')     → 'custbody_fp_chave' ou o id do bundle instalado
 *     fpFields.padrao('TRANID')    → 'tranid'  (campo NATIVO — não passa por perfil)
 *     fpFields.registro('DOC_ENTRADA')
 *     fpFields.valor('DOC_STATUS', 'AUTORIZADA')
 *
 * ── POR QUE ESTA CAMADA EXISTE ─────────────────────────────────────────────────────────────────
 *
 * Quando um cliente troca o bundle da Oracle pelo nosso, o que dói não é o dado: é tudo que
 * APONTA para os ids antigos — saved search, relatório, formulário, workflow, CSV import salvo,
 * integração de terceiro, coluna de lista. Reusar o MESMO scriptid faz esse acervo continuar
 * funcionando sem que ninguém toque nele. É a diferença entre migração e projeto de migração.
 *
 * ── ⚠ NÃO CARREGUE ESTE MÓDULO EM CLIENT SCRIPT ───────────────────────────────────────────────
 *
 * Ele depende de `N/cache`, e **`N/cache` não existe no cliente**. MEDIDO no deploy de 2026-09-23:
 * `MODULE_DOES_NOT_EXIST: Module does not exist: N/cache.js`, e o objeto do client script falhou
 * inteiro na criação — não foi erro em runtime, foi o deploy recusando. Client script do bundle
 * usa scriptid literal, que é seguro justamente nos campos que só nós temos.
 *
 * ── AS TRÊS CAMADAS DE ORIGEM DE UM CAMPO, nesta ordem de preferência ──────────────────────────
 *
 * 1. NATIVO do NetSuite (`padrao()`): `tranid`, `externalid`, `subsidiary`, `location`, `entity`,
 *    `memo`, `status`, `trandate`. Não entra em perfil, não é configurável, não se duplica.
 *    MEDIDO no bundle 436209: a Oracle NÃO usa nativo para dado fiscal porque NÃO EXISTE nativo
 *    para dado fiscal — ela criou `custbody_fiscal_doc_number`, `custbody_operation_nature`,
 *    `custbody_psg_ei_status`. Onde há nativo, é ele; onde não há, cai na camada 2.
 * 2. SCRIPTID DO SUITEAPP INSTALADO (perfil): reaproveitamento. `custbody_psg_ei_status`,
 *    `custbody_fiscal_doc_number`, `custbody_operation_nature`.
 * 3. SCRIPTID NOSSO (perfil `original`): só onde nem o NetSuite nem o SuiteApp instalado têm
 *    campo — `custbody_fp_corrid`, `custbody_fp_sim_payload`, `custbody_fp_idexterno`.
 *
 * ── PERFIL É OVERLAY PARCIAL, NÃO SUBSTITUIÇÃO ─────────────────────────────────────────────────
 *
 * Chave ausente no perfil ativo resolve para o id do `original`. Sem isso, adotar um perfil
 * significaria perder todo campo que o outro bundle não tem — e nenhum bundle tem todos. Medido:
 * o Electronic Invoicing (436209) não traz campo de chave de acesso de 44 dígitos; ela vem do
 * `original` mesmo com o perfil `oracle_ei` ativo. O `naoMapeado` de cada perfil declara isso.
 *
 * ── DETECÇÃO É DE INSTALAÇÃO, NÃO DE EXECUÇÃO ──────────────────────────────────────────────────
 *
 * Não existe API suportada de SuiteScript que liste bundle/SuiteApp instalado. A detecção é por
 * SONDA: existe o custom record que assina aquele SuiteApp? Por isso o perfil detectado é
 * PERSISTIDO no campo `custrecord_fp_perfil_compat` da SUBSIDIÁRIA na primeira vez, e daí em
 * diante o persistido VENCE. Fica em registro standard, não em custom record de configuração.
 *
 * Um perfil que virasse sozinho passaria a gravar dado fiscal em outro campo e órfãozaria tudo
 * que foi gravado antes — em silêncio, porque nenhum dos dois campos dá erro. Detecção serve para
 * o setup não ser manual; a decisão fica registrada. Divergência entre sonda e persistido vira
 * AVISO no log, nunca troca automática.
 */
define(['N/file', 'N/cache', 'N/search', 'N/runtime', 'N/log'], function (file, cache, search, runtime, log) {
  var PASTA_PERFIS = '/SuiteScripts/FiscalPlatform/perfis/';
  var PERFIL_ORIGINAL = 'original';

  var NOME_CACHE = 'fp_perfil';
  var TTL_CACHE = 3600;

  /**
   * Ordem de sondagem. A primeira assinatura encontrada ganha, então perfil MAIS ESPECÍFICO vem
   * antes: uma conta pode ter Electronic Invoicing e Brazil Localization ao mesmo tempo, e o de
   * cima é o que manda no de-para.
   */
  var PERFIS_CONHECIDOS = ['oracle_ei', 'oracle_brl', 'avalara'];

  /**
   * CAMPOS NATIVOS DO NETSUITE.
   *
   * Ficam FORA do perfil de propósito: id nativo não muda por bundle instalado, e deixá-lo
   * configurável só criaria a possibilidade de alguém apontar `tranid` para outro lugar. Onde
   * existe nativo, é ele — é o "máximo de standard possível" na prática.
   *
   * ⚠ Cada entrada abaixo tem de ser conferida no Records Browser DA VERSÃO DA CONTA antes do
   * primeiro deploy. Id nativo afirmado de memória é o erro mais barato de cometer e o mais caro
   * de achar: o campo existe, o `getValue` devolve `null`, e nada dá erro.
   */
  var NATIVOS = {
    TRANID: 'tranid',
    EXTERNALID: 'externalid',
    TRANDATE: 'trandate',
    ENTITY: 'entity',
    SUBSIDIARY: 'subsidiary',
    LOCATION: 'location',
    MEMO: 'memo',
    STATUS: 'status',
    APPROVALSTATUS: 'approvalstatus',
    CURRENCY: 'currency',
    SUBTOTAL: 'subtotal',
    TOTAL: 'total'
  };

  var memo = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Campo NATIVO do NetSuite. Lança se a chave não existe — erro de programação, não de dado,
   * e falhar alto aqui é melhor que devolver `undefined` para um `getValue`.
   *
   * @param {string} chave
   * @returns {string}
   */
  function padrao(chave) {
    var id = NATIVOS[chave];
    if (!id) throw new Error('fp_fields.padrao: chave nativa desconhecida: ' + chave);
    return id;
  }

  /**
   * Campo de transação (body) pelo nome lógico, resolvido no perfil ativo.
   *
   * Devolve `null` quando a chave não existe em perfil nenhum — o chamador decide se isso é
   * opcional (não grava) ou defeito (lança). Devolver null em vez de lançar é deliberado: campo
   * que só existe em alguns perfis é a regra, não a exceção.
   *
   * @param {string} chave
   * @returns {string|null}
   */
  function id(chave) {
    return resolver('transacao', chave);
  }

  /** Campo de linha (sublist `item`). */
  function idLinha(chave) {
    return resolver('linha', chave);
  }

  /** Campo de item (cadastro). */
  function idItem(chave) {
    return resolver('item', chave);
  }

  /** Custom record type pelo nome lógico. */
  function registro(chave) {
    return resolver('registros', chave);
  }

  /**
   * Valor de campo de lista, traduzido para o perfil ativo.
   *
   * É a metade esquecida do de-para. Mapear `DOC_STATUS` para `custbody_psg_ei_status` e gravar
   * nele a nossa string `'AUTORIZADA'` não funciona: o campo do outro bundle é List/Record, e o
   * que ele aceita é o internal id do valor DELE. Campo certo com valor nosso é falha silenciosa
   * — grava, não reclama, e a saved search do cliente não acha nada.
   *
   * Sem mapa de valor para a chave, devolve o valor canônico inalterado (caso do `original`,
   * onde os campos são Free-Form Text).
   *
   * @param {string} chave nome lógico do campo
   * @param {string} valorCanonico nosso valor
   * @returns {string}
   */
  function valor(chave, valorCanonico) {
    var p = perfilAtivo();
    var mapa = p.valores && p.valores[chave];
    if (!mapa) return valorCanonico;
    if (Object.prototype.hasOwnProperty.call(mapa, valorCanonico)) return mapa[valorCanonico];

    // Valor canônico sem tradução num perfil QUE TEM mapa para esta chave é buraco de de-para,
    // não dado ausente. Vai para o log: gravar o canônico num List/Record vai falhar de todo
    // jeito, e o log é o que diz por quê.
    log.error('fp_fields.valor', 'perfil ' + p.perfil + ' não traduz ' + chave + '=' + valorCanonico);
    return valorCanonico;
  }

  /**
   * `true` quando o campo é do SuiteApp instalado e nós NÃO devemos escrever nele.
   *
   * Existe porque reaproveitar id não é o mesmo que ter permissão de gravar: objeto de bundle
   * gerenciado pode estar bloqueado, e o SuiteApp instalado pode ter script próprio escrevendo
   * no mesmo campo. Campo em disputa é campo que perde dado, e qual dos dois ganha depende de
   * ordem de execução — que não é nossa para controlar. O perfil declara em `somenteLeitura`, e
   * o mapeador respeita.
   */
  function somenteLeitura(chave) {
    var p = perfilAtivo();
    return !!(p.somenteLeitura && p.somenteLeitura.indexOf(chave) > -1);
  }

  /** Perfil ativo, carregado (memo → cache → config → sonda → original). */
  function perfilAtivo() {
    if (memo) return memo;

    var c = cache.getCache({ name: NOME_CACHE, scope: cache.Scope.PROTECTED });
    var bruto = c.get({
      key: 'ativo',
      loader: function () {
        return JSON.stringify(montarPerfilAtivo());
      },
      ttl: TTL_CACHE
    });

    memo = JSON.parse(bruto);
    return memo;
  }

  /** Invalida o cache — chamar depois de trocar o perfil na subsidiária. */
  function invalidar() {
    memo = null;
    cache.getCache({ name: NOME_CACHE, scope: cache.Scope.PROTECTED }).remove({ key: 'ativo' });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // interno
  // ─────────────────────────────────────────────────────────────────────────────

  function resolver(secao, chave) {
    var p = perfilAtivo();

    var doPerfil = p[secao] && p[secao][chave];
    if (doPerfil) return doPerfil;

    // OVERLAY PARCIAL: chave que o perfil não mapeia cai no `original`.
    var orig = p._original;
    var doOriginal = orig && orig[secao] && orig[secao][chave];
    return doOriginal || null;
  }

  function montarPerfilAtivo() {
    var original = carregarJson(PERFIL_ORIGINAL);

    var escolhido = perfilConfigurado();
    var origem = 'configurado';

    if (!escolhido) {
      escolhido = sondar();
      origem = escolhido ? 'sonda' : 'padrao';
    }

    if (!escolhido || escolhido === PERFIL_ORIGINAL) {
      original._original = clonarSecoes(original);
      original.origem = origem;
      log.audit('fp_fields', 'perfil ativo: original (' + origem + ')');
      return original;
    }

    var perfil;
    try {
      perfil = carregarJson(escolhido);
    } catch (e) {
      // Perfil configurado que não carrega NÃO derruba nada: cai no original e grita no log.
      // O contrário — abortar — deixaria a conta inteira sem simulação por um JSON malformado.
      log.error('fp_fields', 'perfil ' + escolhido + ' não carregou (' + (e.message || e) + '); usando original');
      original._original = clonarSecoes(original);
      original.origem = 'padrao_por_falha';
      return original;
    }

    perfil._original = clonarSecoes(original);
    perfil.origem = origem;
    log.audit('fp_fields', 'perfil ativo: ' + perfil.perfil + ' (' + origem + ')');
    return perfil;
  }

  function clonarSecoes(p) {
    return {
      transacao: p.transacao || {},
      linha: p.linha || {},
      item: p.item || {},
      registros: p.registros || {}
    };
  }

  function carregarJson(nome) {
    var f = file.load({ id: PASTA_PERFIS + 'fp_perfil_' + nome + '.json' });
    return JSON.parse(f.getContents());
  }

  /**
   * Perfil registrado na subsidiária. Vence a sonda — ver o docblock do módulo.
   *
   * @returns {string|null}
   */
function perfilConfigurado() {
    try {
      // O perfil mora num campo da SUBSIDIÁRIA, registro standard — não há custom record de
      // configuração. Vale a PRIMEIRA subsidiária que tiver o campo preenchido: bundle instalado
      // é fato da conta inteira, não de uma subsidiária, então a primeira resposta serve para
      // todas. Divergência entre subsidiárias seria erro de cadastro, e viraria aviso no log.
      var r = search
        .create({
          type: search.Type.SUBSIDIARY,
          filters: [['custrecord_fp_perfil_compat', 'isnotempty', '']],
          columns: ['custrecord_fp_perfil_compat']
        })
        .run()
        .getRange({ start: 0, end: 1 });

      if (!r || !r.length) return null;
      return r[0].getValue({ name: 'custrecord_fp_perfil_compat' }) || null;
    } catch (e) {
      // Campo ainda não existe (antes do primeiro deploy) — não é erro, é instalação nova.
      log.debug('fp_fields.perfilConfigurado', e.message || e);
      return null;
    }
  }

  /**
   * SONDA: procura a assinatura de cada perfil conhecido, na ordem de `PERFIS_CONHECIDOS`.
   *
   * A assinatura é um CUSTOM RECORD TYPE, não um campo: record type é o que o SuiteApp cria e
   * mantém entre versões, enquanto campo entra e sai de release. `search.create` com type
   * inexistente lança, e é justamente esse lance que responde "não está instalado".
   *
   * @returns {string|null}
   */
  function sondar() {
    for (var i = 0; i < PERFIS_CONHECIDOS.length; i++) {
      var nome = PERFIS_CONHECIDOS[i];
      var p;
      try {
        p = carregarJson(nome);
      } catch (e) {
        continue;
      }

      var assinatura = p.deteccao && p.deteccao.assinatura;
      if (!assinatura || !assinatura.id) continue;

      if (existeRecordType(assinatura.id)) {
        log.audit('fp_fields.sondar', 'assinatura ' + assinatura.id + ' encontrada → perfil ' + nome);
        return nome;
      }
    }
    return null;
  }

  function existeRecordType(tipo) {
    try {
      search.create({ type: tipo, filters: [], columns: ['internalid'] }).runPaged({ pageSize: 1 });
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    padrao: padrao,
    id: id,
    idLinha: idLinha,
    idItem: idItem,
    registro: registro,
    valor: valor,
    somenteLeitura: somenteLeitura,
    perfilAtivo: perfilAtivo,
    invalidar: invalidar,
    PERFIL_ORIGINAL: PERFIL_ORIGINAL,
    PERFIS_CONHECIDOS: PERFIS_CONHECIDOS
  };
});
