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
 * ── PERFIL É MÓDULO, NÃO ARQUIVO ──────────────────────────────────────────────────────────────
 *
 * Os perfis eram `.json` carregados com `file.load`, com `N/cache` em volta só para amortizar o
 * custo. Viraram módulo AMD: some a ida ao File Cabinet, some o cache, e — o que mais importa —
 * **este módulo passa a funcionar em Client Script**. Enquanto dependesse de `N/file` e
 * `N/cache`, que não existem no cliente, todo client script do bundle era obrigado a chumbar
 * scriptid. MEDIDO no deploy de 2026-09-23: `MODULE_DOES_NOT_EXIST: Module does not exist:
 * N/cache.js`, e o objeto do client script falhou inteiro na criação.
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
define(['N/search', 'N/query', 'N/runtime', 'N/log', './perfis/fp_perfil_original', './perfis/fp_perfil_oracle_ei'],
  function (search, query, runtime, log, perfilOriginal, perfilOracleEi) {

  /** Os perfis conhecidos, por nome. Acrescentar perfil é acrescentar aqui e no PERFIS_CONHECIDOS. */
  var PERFIS = {
    original: perfilOriginal,
    oracle_ei: perfilOracleEi
  };
  var PERFIL_ORIGINAL = 'original';


  /**
   * Os perfis que a sonda percorre, DERIVADOS dos módulos carregados — nunca uma lista à parte.
   *
   * ⚠ Havia aqui `['oracle_ei', 'oracle_brl', 'avalara']`, e dois desses nomes não existem em
   * `PERFIS`: a sonda chegava em `oracle_brl` e `carregarModulo` lançava "perfil desconhecido".
   * Lista escrita à mão ao lado de um mapa é sempre duas verdades esperando divergir.
   */
  var PERFIS_CONHECIDOS = Object.keys(PERFIS).filter(function (n) { return n !== PERFIL_ORIGINAL; });


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

  /** Campo do sublist de impostos. `SUBLIST` devolve o id do próprio sublist. */
  function idImposto(chave) {
    return resolver('impostos', chave);
  }

  /** Campo do classificador contábil. */
  function idClassificador(chave) {
    return resolver('classificador', chave);
  }

  /** Campo FP na Subsidiary. */
  function idSubsidiaria(chave) {
    return resolver('subsidiaria', chave);
  }

  /** Campo FP na Location. */
  function idLocation(chave) {
    return resolver('location', chave);
  }

  /** Campo FP na entity (customer/vendor). */
  function idCliente(chave) {
    return resolver('cliente', chave);
  }

  /** Campo do de-para de país (customrecord_fp_pais). */
  function idPais(chave) {
    return resolver('pais', chave);
  }

  /** Campo FP no registro de endereço. */
  function idEndereco(chave) {
    return resolver('endereco', chave);
  }

  /** Campo do custom record de log. */
  function idLog(chave) {
    return resolver('log', chave);
  }

  /** Campo do cadastro de natureza de operação. */
  function idNatureza(chave) {
    return resolver('natureza_operacao', chave);
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


  /** Perfil ativo, resolvido uma vez por execução. Sem cache: os perfis são módulos, já em memória. */
  function perfilAtivo() {
    if (!memo) memo = montarPerfilAtivo();
    return memo;
  }


  /** Esquece o perfil resolvido. Chamar depois de trocar o perfil na subsidiária. */
  function invalidar() {
    memo = null;
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
    var original = carregarModulo(PERFIL_ORIGINAL);

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
    perfil = carregarModulo(escolhido);
  

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


  /**
   * O perfil pelo nome, do mapa de módulos.
   *
   * Lança para nome desconhecido, e é de propósito: nome de perfil vem de constante deste arquivo
   * ou de campo da subsidiária, e nos dois casos um valor que não existe é erro de configuração
   * que precisa aparecer, não cair calado no original.
   */
  function carregarModulo(nome) {
    var p = PERFIS[nome];
    if (!p) {
      // Quem digitou isso foi uma pessoa, no campo da subsidiária. A mensagem tem de dizer onde
      // corrigir e o que vale — erro que só nomeia o problema faz o usuário abrir chamado.
      throw new Error(
        'fp_fields: perfil "' + nome + '" não existe. Corrija o campo "Perfil de Compatibilidade" ' +
        'na Subsidiária: use ' + Object.keys(PERFIS).join(', ') + ', ou deixe VAZIO para o bundle ' +
        'detectar sozinho pelo SuiteApp instalado.');
    }
    return JSON.parse(JSON.stringify(p));
  }

  /**
   * Perfil registrado na subsidiária. Vence a sonda — ver o docblock do módulo.
   *
   * @returns {string|null}
   */
function perfilConfigurado() {
    // ⚠ O ÚNICO SCRIPTID LITERAL QUE PODE EXISTIR NO BUNDLE, e ele é literal por necessidade:
    // este campo é o que DIZ qual perfil carregar. Resolvê-lo pela camada seria pedir ao perfil
    // que decidisse qual perfil usar. É o bootstrap, e por isso não entra em perfil nenhum.
    var CAMPO_PERFIL = 'custrecord_fp_perfil_compat';

    // O perfil mora num campo da SUBSIDIÁRIA, registro standard — não há custom record de
    // configuração. Vale a PRIMEIRA subsidiária que tiver o campo preenchido: bundle instalado
    // é fato da conta inteira, não de uma subsidiária, então a primeira resposta serve para
    // todas. Divergência entre subsidiárias seria erro de cadastro, e viraria aviso no log.
    var r = search
      .create({
        type: search.Type.SUBSIDIARY,
        filters: [[CAMPO_PERFIL, 'isnotempty', '']],
        columns: [CAMPO_PERFIL]
      })
      .run()
      .getRange({ start: 0, end: 1 });

    if (!r || !r.length) return null;
    return r[0].getValue({ name: CAMPO_PERFIL }) || null;
  
  }

  /**
   * SONDA: qual SuiteApp fiscal está instalado nesta conta.
   *
   * Pelo **bundle instalado**, não por assinatura de record type. O record type era sondado
   * provocando `INVALID_RCRD_TYPE` de propósito — exceção como resposta, dentro de auxiliar, que é
   * exatamente o que não pode existir aqui. E o bundle é o fato mais direto: é ele que se instala.
   *
   * @returns {string|null}
   */
  function sondar() {
    var instalados = bundlesInstalados();
    if (!instalados) return null;

    for (var i = 0; i < PERFIS_CONHECIDOS.length; i++) {
      var nome = PERFIS_CONHECIDOS[i];
      var ids = (PERFIS[nome].deteccao && PERFIS[nome].deteccao.bundleIds) || [];
      for (var b = 0; b < ids.length; b++) {
        if (instalados[String(ids[b])]) {
          log.audit('fp_fields.sondar', 'bundle ' + ids[b] + ' instalado → perfil ' + nome);
          return nome;
        }
      }
    }
    return null;
  }

  /** `{ '237702': true, ... }` dos bundles instalados na conta. */
  function bundlesInstalados() {
    var mapa = {};
    search.create({
      type: search.Type.BUNDLE_INSTALLATION,
      filters: [],
      columns: ['name']
    }).run().each(function (linha) {
      mapa[String(linha.id)] = true;
      return true;
    });
    return mapa;
  }

  return {
    padrao: padrao,
    id: id,
    idLinha: idLinha,
    idItem: idItem,
    registro: registro,
    idImposto: idImposto,
    idClassificador: idClassificador,
    idSubsidiaria: idSubsidiaria,
    idLocation: idLocation,
    idCliente: idCliente,
    idPais: idPais,
    idEndereco: idEndereco,
    idLog: idLog,
    idNatureza: idNatureza,
    valor: valor,
    somenteLeitura: somenteLeitura,
    perfilAtivo: perfilAtivo,
    invalidar: invalidar,
    PERFIL_ORIGINAL: PERFIL_ORIGINAL,
    PERFIS_CONHECIDOS: PERFIS_CONHECIDOS
  };
});
