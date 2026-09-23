/**
 * @NApiVersion 2.1
 * @NScriptType CustomGLPlugin
 *
 * CUSTOM GL LINES — TRADUZ O QUE O MOTOR DEVOLVEU EM LANÇAMENTO CONTÁBIL.
 *
 * Este arquivo NÃO decide tributo. Ele recebe, por linha e por tributo, o que o FiscalPlatform já
 * resolveu — `taxCodigo`, `naturezaContabil`, `compoeTotalNf`, `valor` — e pergunta ao cadastro
 * quais contas do NetSuite correspondem àquilo. A matriz CST × operação → natureza é régua do
 * motor e não tem cópia aqui: se aparecer `if (cst === ...)` neste arquivo, é defeito.
 *
 *     linhas[].impostos[]  →  customrecord_fp_impostos (gravado no save)
 *                                      ↓
 *                    (imposto × natureza × sentido × compõe total)
 *                                      ↓
 *                       customrecord_fp_classificador_contabil
 *                                      ↓
 *                            par de contas  →  customLines
 *
 * ── POR QUE A CHAVE NÃO É SÓ (IMPOSTO × NATUREZA) ─────────────────────────────────────────────
 *
 * Porque a mesma natureza é dois lançamentos diferentes conforme o sentido e conforme o tributo
 * estar por dentro ou por fora do preço:
 *
 *   · DIFERIDO na SAÍDA não lança (a responsabilidade foi transferida); na ENTRADA debita o custo
 *     contra ICMS diferido a recolher (RICMS/SP art. 430, I — sem direito a crédito, logo é
 *     imposto não recuperável e integra o custo por CPC 16 R1 item 11).
 *   · RETIDO_FONTE na SAÍDA credita o cliente; na ENTRADA debita o fornecedor. Inverte inteiro.
 *   · DEBITO com `compoeTotalNf = false` (ICMS/PIS/COFINS) debita dedução de receita; com `true`
 *     (IPI) o tributo não é receita (DL 1.598/77 art. 12 §4º) e a perna devedora vira o a receber.
 *
 * Por isso o cadastro carrega Sentido e Compõe Total, e por isso o SENTIDO vem da NATUREZA DE
 * OPERAÇÃO declarada, que guarda o E/S. Derivá-lo do tipo de transação erraria exatamente onde
 * dói: numa devolução de venda o documento é de venda e o movimento é de entrada.
 *
 * ── A PERNA VARIÁVEL ──────────────────────────────────────────────────────────────────────────
 *
 * Nem toda perna é conta fixa. No tributo recuperável de entrada o efeito contábil é EXPURGO: o
 * lançamento padrão já debitou estoque/despesa pelo valor cheio, e o crédito tem de voltar para a
 * MESMA conta que recebeu o custo — conta fixa ali produziria estoque inflado mais uma "outras
 * receitas" que não existe. Em ST e retenção, a contrapartida é o cliente/fornecedor.
 *
 * São três origens distintas, e é o CADASTRO que diz qual, não este código:
 *   CONTA_FIXA        a conta cadastrada na regra
 *   CONTA_DA_LINHA    a conta que a linha padrão do GL usou (estoque, despesa, CPV)
 *   CONTA_DO_PARCEIRO a conta do a receber / a pagar (linha-resumo do GL)
 *
 * ── AS GUARDAS ────────────────────────────────────────────────────────────────────────────────
 *
 * 1. PAR OU NADA. Toda perna sai acompanhada da outra. O NetSuite valida que as custom lines
 *    fecham entre si ("Transaction was not in balance", manual p.84) e meia perna derruba o GL
 *    inteiro da transação. Regra ausente, conta em branco, perna variável irresolúvel → não lança
 *    nada daquele tributo e registra o porquê no log.
 * 2. `SEM_EFEITO` sai fora ANTES do cadastro. Não é regra faltando: é o motor dizendo que não há
 *    lançamento. Hoje é o caso de CBS e IBS. Por isso `customlist_fp_natureza_contabil` não tem
 *    esse valor — cadastrá-lo seria convidar alguém a lhe dar conta.
 * 3. NÃO LANÇA ≠ REGRA AUSENTE. Regra CADASTRADA sem conta nas duas pernas é a que existe, é
 *    legítima, e cujo lançamento correto é nenhum (CUSTO por dentro: o tributo já entrou cheio
 *    no estoque). Regra AUSENTE é erro de cadastro e vai para o log como erro. A diferença entre
 *    as duas separa "decidido que não lança" de "esqueceram de cadastrar".
 * 4. NUNCA LANÇA. Exceção aqui não pode derrubar o save de quem está faturando. O manual não diz
 *    se derruba (p.83-86 só nomeia as mensagens), e na dúvida o `catch` é nosso.
 *
 * ── MEDIDO NO MANUAL (2026.2, 16/set/2026) ────────────────────────────────────────────────────
 *
 * p.50-51  SuiteScript 2.x tem UM parâmetro: `customizeGlImpact(context)`, com `standardLines`,
 *          `customLines`, `transactionRecord` e `book` — todos read-only. A forma de 4 parâmetros
 *          posicionais é do SuiteScript 1.0 e não é compatível.
 * p.53-55  `customLines.addNewLine()` devolve a linha; conta, valor e memo são ATRIBUIÇÃO DE
 *          PROPRIEDADE, não setter. `debitAmount`/`creditAmount` são STRING e têm de ser POSITIVOS.
 * p.56     `isBookSpecific = false` copia a linha para os books secundários pelo mapping de
 *          Multi-Book. Omitir ou pôr `true` prende a linha ao book primário.
 * p.66-71  `StandardLine` é inteiramente read-only. NÃO existe propriedade de item nem de número
 *          de linha da transação: NÃO HÁ como correlacionar uma standard line com a linha do
 *          sublist `item`. É a razão do rateio proporcional abaixo.
 * p.82     A linha de índice 0 é a LINHA-RESUMO, com o total de débitos e créditos. Para contar só
 *          as visíveis: `(debitAmount || creditAmount) && accountId`.
 * p.60-61  ⚠ `getText` e `getSublistText` NÃO EXISTEM na configuração SÍNCRONA. Por isso toda
 *          leitura aqui é `getValue`/`getSublistValue`, e o de-para de lista sai do SuiteQL.
 * p.11     `N/query` é explicitamente suportado; o manual recomenda buscar em vez de carregar
 *          registro e "limitar o uso dessas APIs".
 * p.83     Governança: 1000 unidades. Este arquivo gasta 10 (uma SuiteQL) no caminho feliz.
 * p.58     Em modo SÍNCRONO, criando transação nova, `transactionRecord.id` NÃO existe — só no
 *          assíncrono. Daí a leitura dos impostos tentar o sublist ANTES da consulta por id.
 *
 * ── A CAMADA DE COMPATIBILIDADE NÃO É CARREGADA AQUI, DE PROPÓSITO ────────────────────────────
 *
 * `fp_fields` faz `file.load` mais `search` para resolver o perfil, e o manual manda justamente
 * evitar isso dentro do plug-in (p.11-12, p.82), com 1000 unidades para o arquivo inteiro. Os
 * scriptids abaixo são todos de objetos que só nós temos — nenhum SuiteApp fiscal instalado
 * possui classificador contábil nem sublist de impostos por linha —, então não há de-para a fazer:
 * em qualquer perfil eles resolveriam para si mesmos pelo overlay parcial.
 */
define(['N/query', 'N/log', './fp_fields'], function (query, log, fpFields) {
  /**
   * Ids pela camada de compatibilidade, resolvidos UMA vez por execução.
   *
   * Antes eram literais aqui, com a justificativa de que `fp_fields` fazia `file.load` e o manual
   * manda evitar API pesada no plug-in (p.11-12, p.82). Os perfis viraram módulo AMD: sumiram o
   * `N/file` e o `N/cache`, e o que sobra é resolução em memória mais, no máximo, uma busca para
   * descobrir o perfil ativo — que fica memoizada. A justificativa caiu, e o literal com ela.
   */
  var ids = null;

  function campos() {
    if (ids) return ids;
    ids = {
      SUBLIST: fpFields.idImposto('SUBLIST'),
      IMP: {
        TAXCODIGO: fpFields.idImposto('TAXCODIGO'),
        NATUREZA: fpFields.idImposto('NATUREZA_CONTABIL'),
        VALOR: fpFields.idImposto('VALOR'),
        COMPOE: fpFields.idImposto('COMPOE_TOTAL'),
        LINHA: fpFields.idImposto('NUMERO_LINHA'),
        BASE: fpFields.idImposto('BASE_CALCULO'),
        ALIQUOTA: fpFields.idImposto('ALIQUOTA'),
        PERNA: fpFields.idImposto('PERNA'),
        GERA: fpFields.idImposto('GERA_LANCAMENTO'),
        TRANSACAO: fpFields.idImposto('TRANSACAO')
      },
      CC: {
        IMPOSTO: fpFields.idClassificador('IMPOSTO'),
        NATUREZA: fpFields.idClassificador('NATUREZA'),
        PERNA: fpFields.idClassificador('PERNA'),
        COMPOE: fpFields.idClassificador('COMPOE_TOTAL'),
        CONTA_TRIBUTO: fpFields.idClassificador('CONTA_TRIBUTO'),
        CONTRA_ORIGEM: fpFields.idClassificador('CONTRAPARTIDA_ORIGEM'),
        CONTRA: fpFields.idClassificador('CONTRAPARTIDA'),
        CODIGO_IMPOSTO: fpFields.idClassificador('CODIGO_IMPOSTO')
      },
      REG: {
        IMPOSTOS: fpFields.registro('IMPOSTOS'),
        IMPOSTO: fpFields.registro('IMPOSTO'),
        CLASSIFICADOR: fpFields.registro('CLASSIFICADOR')
      },
      NATUREZA_TX: fpFields.id('NATUREZA'),
      NUMERO: fpFields.id('DOC_NUMERO'),
      SERIE: fpFields.id('DOC_SERIE'),
      CHAVE: fpFields.id('DOC_CHAVE'),
      SUB_NATIVO: fpFields.idSubsidiaria('CONTA_IMPOSTO_NATIVO'),
      SUB_ESTORNO: fpFields.idSubsidiaria('CONTA_ESTORNO_CONTRA')
    };
    return ids;
  }

  /** Estorno do imposto nativo — as duas contas são cadastro na subsidiária, não palpite daqui. */

  /**
   * Identidade do documento para o histórico do lançamento.
   *
   * `tranid` é NATIVO e sempre existe. Os três do FiscalPlatform só existem depois da EMISSÃO —
   * em transação apenas simulada a nota ainda não foi gerada, e o histórico sai com o número do
   * documento do ERP. Cada um entra no texto se, e só se, estiver preenchido.
   */
  
  /** Essência econômica por natureza (ITG 2000 itens 6 "d" e 8). Redação, não régua fiscal:
   *  nenhuma entrada aqui decide CST, base, alíquota ou conta. `{t}` = tributo, `{op}` = sentido. */
  var FRASE = {
    DEBITO:                '{t} sobre {op}',
    RECUPERAVEL_INTEGRAL:  '{t} a recuperar sobre {op}',
    RECUPERAVEL_RATEIO:    '{t} a recuperar sobre {op}, crédito a ratear',
    RECUPERAVEL_PRESUMIDO: 'Crédito presumido de {t}',
    CUSTO:                 '{t} não recuperável integrado ao custo',
    SUSPENSO:              '{t} suspenso',
    DIFERIDO:              '{t} diferido',
    RETIDO_FONTE:          '{t} retido na fonte',
    ST_A_RECOLHER:         '{t} por substituição tributária a recolher',
    ST_JA_RECOLHIDO:       '{t} por substituição tributária já retido',
    ESTORNO_DEBITO:        'Estorno de {t} sobre {op}',
    ESTORNO_ST:            'Estorno de {t} por substituição tributária'
  };

  /** Teto prudente: a ECD dá 65535 ao HIST do I250; quem aperta é o `Memo` (pendência 18). */
  var MEMO_MAX = 255;

  /**
   * Valores de PROTOCOLO do motor, não regra tributária. Ler a resposta não é decidir tributo.
   *
   * ⚠ `SEM_EFEITO` NÃO aparece mais aqui, e é um ganho: a plataforma passou a devolver
   * `geraLancamento`, que cobre SEM_EFEITO, CUSTO, SUSPENSO, DIFERIDO e ST_JA_RECOLHIDO de uma
   * vez (`sentido-do-lancamento.ts`, `SEM_PARTIDA_PROPRIA`). Um literal fiscal a menos no ERP.
   */
  var ENTRADA = 'ENTRADA';
  var SAIDA = 'SAIDA';
  var INDIFERENTE = 'INDIFERENTE';
  var DEBITO = 'D';
  var CREDITO = 'C';

  var ORIGEM_FIXA = 'CONTA_FIXA';
  var ORIGEM_LINHA = 'CONTA_DA_LINHA';
  var ORIGEM_PARCEIRO = 'CONTA_DO_PARCEIRO';

  // ─────────────────────────────────────────────────────────────────────────────

  function customizeGlImpact(context) {
    try {
      executar(context);
    } catch (e) {
      // GUARDA 4. Quem está faturando não pode perder o save por causa da contabilização do
      // imposto. Sem lançamento e com o motivo no Execution Log é pior que certo e melhor que
      // um GL pela metade.
      log.error('fp_gl_lines_plugin', {
        name: e.name,
        message: e.message,
        stack: e.stack
      });
    }
  }

  function executar(context) {
    var tx = context.transactionRecord;
    var book = context.book;

    var impostos = lerImpostos(tx);
    if (!impostos.length) {
      log.debug('fp_gl_lines_plugin', 'sem impostos do FiscalPlatform nesta transação — nada a lançar');
      return;
    }

    // O sentido NAO decide mais a perna — quem decide e a plataforma. Aqui ele serve so a
    // redacao do historico ("sobre vendas" x "sobre compras"). Faltando, o historico fica
    // menos preciso; derrubar o lancamento inteiro por causa de uma palavra seria pior.
    var sentido = lerSentido(tx);
    if (!sentido) {
      log.audit('fp_gl_lines_plugin',
        'sem natureza de operação na transação, ou natureza sem E/S. O lançamento sai; ' +
        'o histórico fica sem "sobre vendas/compras".');
    }


    var grupos = agrupar(impostos);
    if (!grupos.length) return;

    var regras = carregarRegua();
    if (!regras.length) {
      log.error('fp_gl_lines_plugin',
        'classificador contábil vazio ou sem linhas ativas — nenhum imposto pode ser contabilizado');
      return;
    }

    var doc = identidadeDoDocumento(tx);
    var contas = mapearContasPadrao(context.standardLines);

    var lancados = 0;
    var i;

    for (i = 0; i < grupos.length; i++) {
      if (lancar(context.customLines, grupos[i], {
        sentido: sentido,
        doc: doc,
        regras: regras,
        contas: contas,
        book: book
      })) lancados++;
    }

    log.audit('fp_gl_lines_plugin',
      'book ' + book.id + ' · ' + grupos.length + ' grupo(s) de imposto · ' +
      lancados + ' contabilizado(s)');

    estornarImpostoNativo(context, tx);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // leitura do que o motor devolveu
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Impostos pelo sublist do registro filho; se ele não vier, pela consulta ao pai.
   *
   * O sublist PRIMEIRO, e a ordem importa: em modo síncrono, criando transação nova, o manual diz
   * que `transactionRecord.id` não existe (p.58), e sem id a consulta por pai não tem por onde
   * começar. O manual não documenta leitura de sublist de registro filho, então o `try` aqui é
   * suspeita legítima, não pessimismo decorativo.
   */
  function lerImpostos(tx) {
    var doSublist = lerImpostosDoSublist(tx);
    if (doSublist.length) return doSublist;

    var id = tx.id;
    if (!id) return [];
    return lerImpostosPorConsulta(id);
  }

  function lerImpostosDoSublist(tx) {
    var C = campos();
    var linhas = [];
    try {
      var n = tx.getLineCount({ sublistId: C.SUBLIST });
      if (!n || n < 0) return [];

      for (var i = 0; i < n; i++) {
        linhas.push({
          imposto: texto(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.TAXCODIGO, line: i })),
          natureza: texto(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.NATUREZA, line: i })),
          valor: numero(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.VALOR, line: i })),
          compoe: booleano(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.COMPOE, line: i })),
          base: numero(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.BASE, line: i })),
          aliquota: numero(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.ALIQUOTA, line: i })),
          perna: texto(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.PERNA, line: i })).toUpperCase(),
          gera: booleano(tx.getSublistValue({ sublistId: C.SUBLIST, fieldId: C.IMP.GERA, line: i }))

        });
      }
    } catch (e) {
      log.debug('fp_gl_lines_plugin.lerImpostosDoSublist',
        'sublist ' + C.SUBLIST + ' não legível aqui (' + (e.message || e) + ') — caindo na consulta');
      return [];
    }
    return linhas;
  }

  function lerImpostosPorConsulta(idTransacao) {
    var C = campos();
    var sql =
      'SELECT ' +
      '  ' + C.IMP.TAXCODIGO + ' AS imposto, ' +
      '  ' + C.IMP.NATUREZA + ' AS natureza, ' +
      '  ' + C.IMP.VALOR + ' AS valor, ' +
      '  ' + C.IMP.COMPOE + ' AS compoe, ' +
      '  ' + C.IMP.BASE + ' AS base, ' +
      '  ' + C.IMP.ALIQUOTA + ' AS aliquota, ' +
      '  ' + C.IMP.PERNA + ' AS perna, ' +
      '  ' + C.IMP.GERA + ' AS gera ' +
      'FROM ' + C.REG.IMPOSTOS + ' ' +
      'WHERE ' + C.IMP.TRANSACAO + ' = ? AND isinactive = ' + "'F'";

    var linhas = [];
    try {
      var r = query.runSuiteQL({ query: sql, params: [idTransacao] }).asMappedResults();
      for (var i = 0; i < r.length; i++) {
        linhas.push({
          imposto: texto(r[i].imposto),
          natureza: texto(r[i].natureza),
          valor: numero(r[i].valor),
          compoe: booleano(r[i].compoe),
          base: numero(r[i].base),
          aliquota: numero(r[i].aliquota),
          perna: texto(r[i].perna).toUpperCase(),
          gera: booleano(r[i].gera)
        });
      }
    } catch (e) {
      log.error('fp_gl_lines_plugin.lerImpostosPorConsulta', e.message || e);
      return [];
    }
    return linhas;
  }

  /**
   * Sentido pela NATUREZA DE OPERAÇÃO declarada, e só por ela.
   *
   * Não há campo de sentido na transação: quem abriu o pedido já escolheu a natureza, e
   * `customrecord_fp_natureza_operacao` guarda o E/S dela. É dado que já existe — duplicá-lo num
   * campo de transação seria uma segunda verdade que alguém teria de manter sincronizada.
   */
  function lerSentido(tx) {
    var C = campos();
    var natureza = numero(tx.getValue({ fieldId: C.NATUREZA_TX }));
    if (!natureza) return null;

    try {
      var r = query.runSuiteQL({
        query: 'SELECT ' + fpFields.idNatureza('ENTRADA_SAIDA') + ' AS es FROM ' +
               fpFields.registro('NATUREZA_OPERACAO') + ' WHERE id = ?',
        params: [natureza]
      }).asMappedResults();
      if (r.length) {
        var s = normalizarSentido(r[0].es);
        if (s) return s;
      }
    } catch (e) {
      log.error('fp_gl_lines_plugin.lerSentido', e.message || e);
    }
    return null;
  }

  function normalizarSentido(v) {
    var t = texto(v).toUpperCase();
    if (t === 'E' || t === ENTRADA) return ENTRADA;
    if (t === 'S' || t === SAIDA) return SAIDA;
    return null;
  }

  /**
   * Um lançamento por (imposto × natureza × compõe total), somando as linhas da nota.
   *
   * Agrupar não é escolha de estilo: `StandardLine` não expõe nada que amarre uma linha do GL à
   * linha do sublist `item` (manual p.66-71), então guardar o `numeroItem` de cada imposto daria
   * uma precisão que não há como usar. E é também como o razão brasileiro se lê — uma linha de
   * "ICMS sobre vendas" por nota, não uma por item.
   *
   * `compoeTotalNf` entra na chave porque troca o par contábil dentro da MESMA natureza.
   */
  function agrupar(impostos) {
    var mapa = {};
    var ordem = [];

    for (var i = 0; i < impostos.length; i++) {
      var t = impostos[i];
      if (!t.imposto || !t.natureza) continue;

      // GUARDA 2 — a PLATAFORMA diz que não há partida própria, e isso não é regra faltando.
      // Cobre SEM_EFEITO, CUSTO, SUSPENSO, DIFERIDO e ST_JA_RECOLHIDO sem nomear nenhum deles.
      if (!t.gera) continue;
      // Tributo de valor zero não vira lançamento de valor zero: vira nada. IBS municipal a 0,00%
      // é o caso de hoje, e um par 0,00/0,00 só sujaria o GL Impact.
      if (!t.valor) continue;

      var chave = t.imposto + '\u0000' + t.natureza + '\u0000' + (t.compoe ? '1' : '0') +
                  '\u0000' + t.perna;
      if (!mapa[chave]) {
        mapa[chave] = { imposto: t.imposto, natureza: t.natureza, compoe: t.compoe,
                        perna: t.perna,
                        valor: 0, base: 0, aliquota: null, aliquotaUnica: true };
        ordem.push(chave);
      }
      mapa[chave].valor += t.valor;
      mapa[chave].base += t.base;

      // ALÍQUOTA SÓ VAI PARA O HISTÓRICO SE FOR ÚNICA NA NOTA.
      // A linha de GL é agregada por tributo na nota inteira; com itens a 12% e a 18%,
      // imprimir "aliq 12,00%" seria informação falsa no Diário. Havendo mais de uma,
      // sai só a base somada — que é verdadeira.
      var acc = mapa[chave];
      if (acc.aliquota === null) acc.aliquota = t.aliquota;
      else if (acc.aliquota !== t.aliquota) acc.aliquotaUnica = false;
    }

    var grupos = [];
    for (var j = 0; j < ordem.length; j++) {
      var g = mapa[ordem[j]];
      g.valor = arredondar(g.valor);
      g.base = arredondar(g.base);
      if (g.valor) grupos.push(g);
    }
    return grupos;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // régua
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * UMA consulta, a régua inteira. São dezenas de linhas, não milhares.
   *
   * `BUILTIN.DF` devolve o texto do campo List/Record. É o caminho obrigatório aqui porque
   * `getText` não existe no plug-in síncrono (manual p.60-61) e porque o que o motor manda é a
   * string canônica (`DEBITO`, `ENTRADA`), não o internal id do valor da lista nesta conta.
   */
  function carregarRegua() {
    var C = campos();
    var sql =
      'SELECT ' +
      '  i.' + C.CC.CODIGO_IMPOSTO + ' AS imposto, ' +
      '  BUILTIN.DF(c.' + C.CC.NATUREZA + ') AS natureza, ' +
      '  c.' + C.CC.PERNA + ' AS perna, ' +
      '  BUILTIN.DF(c.' + C.CC.COMPOE + ') AS compoe, ' +
      '  BUILTIN.DF(c.' + C.CC.CONTRA_ORIGEM + ') AS contra_origem, ' +
      '  c.' + C.CC.CONTA_TRIBUTO + ' AS conta_tributo, ' +
      '  c.' + C.CC.CONTRA + ' AS conta_contra ' +
      'FROM ' + C.REG.CLASSIFICADOR + ' c ' +
      'JOIN ' + C.REG.IMPOSTO + ' i ON i.id = c.' + C.CC.IMPOSTO + ' ' +
      "WHERE c.isinactive = 'F'";

    try {
      return query.runSuiteQL({ query: sql }).asMappedResults();
    } catch (e) {
      log.error('fp_gl_lines_plugin.carregarRegua', e.message || e);
      return [];
    }
  }

  /**
   * A regra mais ESPECÍFICA que casa, e o desempate é por especificidade, não por ordem.
   *
   * Imposto, natureza e PERNA casam exato — a perna vem da plataforma e não se negocia.
   * `compoeTotalNf` é o único discriminante opcional: `INDIFERENTE` é o default do cadastro, e a
   * regra que nomeia `SIM`/`NAO` é exceção escrita de propósito, e exceção de propósito ganha.
   */
  function acharRegra(grupo, ctx) {
    var candidatas = [];
    var i;

    for (i = 0; i < ctx.regras.length; i++) {
      var r = ctx.regras[i];

      if (texto(r.imposto).toUpperCase() !== grupo.imposto.toUpperCase()) continue;
      if (texto(r.natureza).toUpperCase() !== grupo.natureza.toUpperCase()) continue;

      if (texto(r.perna).toUpperCase() !== grupo.perna) continue;

      var comp = texto(r.compoe).toUpperCase();
      if (comp !== INDIFERENTE && comp !== (grupo.compoe ? 'SIM' : 'NAO')) continue;

      candidatas.push({ regra: r, peso: comp !== INDIFERENTE ? 1 : 0 });
    }

    if (!candidatas.length) return null;

    var melhor = candidatas[0];
    var empate = false;
    for (i = 1; i < candidatas.length; i++) {
      if (candidatas[i].peso > melhor.peso) { melhor = candidatas[i]; empate = false; }
      else if (candidatas[i].peso === melhor.peso) empate = true;
    }

    if (empate) {
      log.error('fp_gl_lines_plugin.acharRegra',
        'mais de uma regra igualmente específica para ' + grupo.imposto + ' / ' + grupo.natureza +
        ' / ' + ctx.sentido + ' — o cadastro está ambíguo e a escolha virou sorteio. Corrija.');
    }
    return melhor.regra;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // lançamento
  // ─────────────────────────────────────────────────────────────────────────────

function lancar(customLines, grupo, ctx) {
    var rotulo = grupo.imposto + ' / ' + grupo.natureza +
      ' / perna ' + (grupo.perna || '(nao decidida)') +
      ' / compoe=' + (grupo.compoe ? 'SIM' : 'NAO');

    // A PLATAFORMA NAO DECIDIU, e isso nao e dado faltando.
    // `sentidoDaPernaFixa` vazio com `geraLancamento` verdadeiro e o sinal explicito de
    // "pergunte ao contador" — hoje e o caso de CREDITO_TRANSFERIDO e ESTORNO_ST
    // (`sentido-do-lancamento.ts`). Chutar D ou C aqui produziria lancamento errado em
    // silencio, que e pior que nao lancar. A razao dela vai inteira para o log.
    if (grupo.perna !== DEBITO && grupo.perna !== CREDITO) {
      log.error('fp_gl_lines_plugin',
        rotulo + ' — a plataforma NAO decidiu a perna. ' + formatar(grupo.valor) +
        ' nao foi contabilizado. O porque esta no razaoDaPerna do retorno.json anexado a ' +
        'transacao. E pergunta para a contabilidade, nao erro de cadastro.');
      return false;
    }

    var regra = acharRegra(grupo, ctx);
    if (!regra) {
      log.error('fp_gl_lines_plugin',
        'sem regra no classificador contabil para ' + rotulo + ' — ' +
        formatar(grupo.valor) + ' nao foi contabilizado. Cadastre a linha.');
      return false;
    }

    // NAO LANCA — regra que existe e nao nomeia contrapartida fixa nenhuma.
    if (naoPosta(regra)) {
      log.debug('fp_gl_lines_plugin', rotulo + ' — regra cadastrada sem contrapartida: ' +
        formatar(grupo.valor) + ' nao gera lancamento proprio. E o esperado, nao falta de cadastro.');
      return false;
    }

    var contaTributo = numero(regra.conta_tributo);
    var contra = resolverPerna(regra.contra_origem, regra.conta_contra, ctx.contas, grupo.valor);

    // GUARDA 1 — par ou nada. Meia perna desbalanceia as custom lines e o NetSuite recusa o GL
    // da transacao inteira, nao so deste imposto.
    if (!contaTributo || !contra) {
      log.error('fp_gl_lines_plugin',
        rotulo + ' — ' + (!contaTributo ? 'conta do tributo em branco' :
        'contrapartida irresoluvel (' + regra.contra_origem + ')') + '. ' +
        formatar(grupo.valor) + ' nao foi contabilizado — meia perna derrubaria o GL inteiro.');
      return false;
    }

    var memo = historico(grupo, ctx);
    var tributoEhDebito = grupo.perna === DEBITO;
    var i;

    // A perna do tributo e UMA conta; a contrapartida pode vir rateada em varias.
    novaLinha(customLines, contaTributo, grupo.valor, tributoEhDebito, memo);
    for (i = 0; i < contra.length; i++) {
      novaLinha(customLines, contra[i].conta, contra[i].valor, !tributoEhDebito, memo);
    }

    return true;
  }

  /** Regra que existe e nao nomeia contrapartida fixa: decidido que nao lanca. */
  function naoPosta(regra) {
    return texto(regra.contra_origem).toUpperCase() === ORIGEM_FIXA && !numero(regra.conta_contra);
  }


  /**
   * Histórico do lançamento — é o que vai para o campo HIST do I250 na ECD.
   *
   * Ordem: essência econômica, documento, valores, id. A montagem é por partes descartáveis
   * porque o `Memo` tem teto: se estourar, cai primeiro a chave de 44 dígitos, depois a base e a
   * alíquota. A frase e o id NUNCA caem — a frase é a exigência do item 8 da ITG 2000, e o id é
   * a amarração com a plataforma.
   */
  function historico(grupo, ctx) {
    var op = ctx.sentido === ENTRADA ? 'compras' : (ctx.sentido === SAIDA ? 'vendas' : 'a operação');
    var modelo = FRASE[texto(grupo.natureza).toUpperCase()] || '{t}';
    var frase = modelo.replace('{t}', grupo.imposto).replace('{op}', op);

    var fixo = [frase];
    if (ctx.doc.documento) fixo.push(ctx.doc.documento);

    // Base e alíquota são COPIADAS do que o motor devolveu. O ERP não divide valor por alíquota
    // para descobrir base: a divisão reversa erra no arredondamento item a item, e o Diário
    // ficaria com um número que não é o da apuração.
    var opcional = [];
    if (ctx.doc.chave) opcional.push('chave ' + ctx.doc.chave);
    if (grupo.base) {
      var v = 'base ' + moeda(grupo.base);
      if (grupo.aliquotaUnica && grupo.aliquota) v += ' aliq ' + moeda(grupo.aliquota) + '%';
      opcional.push(v);
    }

    var id = ctx.doc.id ? 'id ' + ctx.doc.id : null;

    var partes = fixo.concat(opcional);
    if (id) partes.push(id);
    var texto_ = partes.join(' - ');

    // Estourou: descarta opcional do fim para o começo, preservando frase + documento + id.
    while (texto_.length > MEMO_MAX && opcional.length) {
      opcional.pop();
      partes = fixo.concat(opcional);
      if (id) partes.push(id);
      texto_ = partes.join(' - ');
    }

    return texto_.length > MEMO_MAX ? texto_.substring(0, MEMO_MAX) : texto_;
  }

  /**
   * Número/série, chave e internal id da transação.
   *
   * ⚠ `tx.id` NÃO EXISTE no plug-in síncrono quando a transação está sendo CRIADA (manual p.58,
   * p.11) — só no assíncrono ou na edição. Quando falta, o histórico sai sem o id e o log diz.
   * Número, série e chave só existem depois da EMISSÃO; em transação apenas simulada o
   * documento é o `tranid` do NetSuite.
   */
  function identidadeDoDocumento(tx) {
    var C = campos();
    var numero = texto(valorDe(tx, C.NUMERO));
    var serie = texto(valorDe(tx, C.SERIE));
    var chave = texto(valorDe(tx, C.CHAVE));
    var tranid = texto(valorDe(tx, 'tranid'));

    var documento = null;
    if (numero) documento = 'NF-e ' + numero + (serie ? '/' + serie : '');
    else if (tranid) documento = 'doc ' + tranid;

    var id = tx.id ? String(tx.id) : '';
    if (!id) {
      log.debug('fp_gl_lines_plugin.identidadeDoDocumento',
        'sem internal id — plug-in síncrono criando transação (manual p.58). Histórico sai sem o id.');
    }

    return { documento: documento, chave: chave, id: id };
  }

  function valorDe(tx, campo) {
    try {
      return tx.getValue({ fieldId: campo });
    } catch (e) {
      return '';
    }
  }

  /** Formato brasileiro: 5143.66 -> "5.143,66". O arquivo da ECD é ISO-8859-1 e aceita os dois. */
  function moeda(v) {
    var n = arredondar(Math.abs(v)).toFixed(2).split('.');
    return n[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + n[1];
  }

  /**
/**
   * Estorna a linha que o motor de imposto NATIVO do NetSuite postou.
   *
   * O Legacy Tax é modelo americano: um tributo por linha, uma alíquota. Ele não representa a
   * tributação brasileira, mas posta assim mesmo — e standard line é read-only (manual p.66-71),
   * então não há como impedir que nasça. Sobra estornar.
   *
   * ZERO HEURÍSTICA na escolha das contas: as duas vêm da subsidiária. O plug-in não adivinha qual
   * linha é do motor nativo (`isTaxable` e `taxAmount` só valem para CRÉDITO em conta de imposto,
   * p.69-70, e a linha do Legacy Tax aqui é débito) nem para onde devolver o valor. Cadastro em
   * branco = não estorna, que é o default seguro.
   */
  function estornarImpostoNativo(context, tx) {
    var cfg = configuracaoDoEstorno(tx);
    if (!cfg || !cfg.nativa) return;

    if (!cfg.contra) {
      log.error('fp_gl_lines_plugin.estornarImpostoNativo',
        'conta do motor nativo cadastrada sem conta que recebe o estorno — nada estornado. ' +
        'Meia perna derrubaria o GL inteiro.');
      return;
    }

    // GUARDA DE INVERSÃO. Motor de imposto não posta em conta de RESULTADO DE RECEITA; se a conta
    // apontada é `Income`, os dois campos foram trocados no cadastro. Medido: sem esta guarda a
    // inversão fez o plug-in zerar a receita inteira (R$ 200) em vez do imposto (R$ 14), e nada
    // reclamou — o par fechava.
    if (String(cfg.tipoNativa || '').toUpperCase() === 'INCOME') {
      log.error('fp_gl_lines_plugin.estornarImpostoNativo',
        'a conta do motor nativo (' + cfg.nativa + ') é de RECEITA. Motor de imposto não posta em ' +
        'receita — os dois campos estão trocados na subsidiária. Nada estornado.');
      return;
    }

    var linhas = context.standardLines;
    var debito = 0;
    var credito = 0;

    for (var i = 0; i < linhas.count; i++) {
      var l = linhas.getLine({ index: i });
      if (numero(l.accountId) !== cfg.nativa) continue;
      debito += numero(l.debitAmount);
      credito += numero(l.creditAmount);
    }

    var liquido = arredondar(debito - credito);
    if (!liquido) return;

    // Inverte: o que o nativo debitou, creditamos, e vice-versa.
    var memo = 'Estorno do imposto apurado pelo motor nativo do NetSuite';
    novaLinha(context.customLines, cfg.nativa, liquido, liquido < 0, memo);
    novaLinha(context.customLines, cfg.contra, liquido, liquido > 0, memo);

    log.audit('fp_gl_lines_plugin.estornarImpostoNativo',
      'conta ' + cfg.nativa + ' zerada em ' + formatar(liquido) + ' contra ' + cfg.contra);
  }

  /**
   * As duas contas do estorno e o TIPO da primeira, numa consulta só.
   *
   * O tipo vem junto de propósito: é o que permite recusar o cadastro invertido sem uma segunda
   * ida ao banco, e governança no plug-in é 1000 unidades para o arquivo inteiro (manual p.83).
   */
  function configuracaoDoEstorno(tx) {
    var C = campos();
    var sub = numero(valorDe(tx, 'subsidiary'));
    if (!sub) return null;
    try {
      var r = query.runSuiteQL({
        query:
          'SELECT s.' + C.SUB_NATIVO + ' AS nativa, ' +
          '       s.' + C.SUB_ESTORNO + ' AS contra, ' +
          '       a.accttype AS tipo ' +
          'FROM subsidiary s LEFT JOIN account a ON a.id = s.' + C.SUB_NATIVO + ' ' +
          'WHERE s.id = ?',
        params: [sub]
      }).asMappedResults();
      if (!r.length) return null;
      return { nativa: numero(r[0].nativa), contra: numero(r[0].contra), tipoNativa: r[0].tipo };
    } catch (e) {
      log.error('fp_gl_lines_plugin.configuracaoDoEstorno', e.message || e);
      return null;
    }
  }


  function novaLinha(customLines, conta, valor, ehDebito, memo) {
    var l = customLines.addNewLine();
    l.accountId = conta;

    // STRING e POSITIVO (manual p.55). Mandar número, ou negativo para "inverter o lado",
    // é "Cannot Parse Value" / "Amount to debit must be positive" — e o erro só aparece no save.
    if (ehDebito) l.debitAmount = formatar(valor);
    else l.creditAmount = formatar(valor);

    l.memo = memo;

    // A linha tem de existir nos books secundários também: o imposto é o mesmo fato em todos.
    // Omitir esta propriedade a prenderia ao book primário (manual p.56).
    l.isBookSpecific = false;
    return l;
  }

  /**
   * Devolve `[{conta, valor}]` — lista, e não conta única, por causa do rateio.
   *
   * `CONTA_DA_LINHA` pode ser mais de uma conta: uma nota com item de estoque e item de despesa
   * tem duas contas de custo. Como o manual não dá como amarrar a standard line à linha do
   * sublist `item` (p.66-71), a divisão possível é a PROPORCIONAL ao valor que cada conta recebeu
   * — que é o que um rateio de expurgo de custo faz de todo jeito. O resíduo de centavo vai para
   * a maior parcela, para que o par continue fechando exatamente.
   *
   * `null` = irresolúvel, e o chamador não lança nada.
   */
  function resolverPerna(origem, contaFixa, contas, valor) {
    var o = texto(origem).toUpperCase();

    if (o === ORIGEM_FIXA) {
      var c = numero(contaFixa);
      return c ? [{ conta: c, valor: valor }] : null;
    }

    if (o === ORIGEM_PARCEIRO) {
      return contas.parceiro ? [{ conta: contas.parceiro, valor: valor }] : null;
    }

    if (o === ORIGEM_LINHA) {
      if (!contas.linha.length) return null;
      return ratear(contas.linha, valor);
    }

    return null;
  }

  function ratear(parcelas, total) {
    var soma = 0;
    var i;
    for (i = 0; i < parcelas.length; i++) soma += parcelas[i].peso;
    if (!soma) return null;

    var centavosTotal = Math.round(total * 100);
    var out = [];
    var acumulado = 0;
    var maior = 0;

    for (i = 0; i < parcelas.length; i++) {
      var centavos = Math.round(centavosTotal * (parcelas[i].peso / soma));
      acumulado += centavos;
      out.push({ conta: parcelas[i].conta, centavos: centavos });
      if (parcelas[i].peso > parcelas[maior].peso) maior = i;
    }

    // O resíduo do arredondamento vai para a maior parcela. Sem isto o par não fecha e o
    // NetSuite recusa o GL da transação — por um centavo.
    out[maior].centavos += (centavosTotal - acumulado);

    var r = [];
    for (i = 0; i < out.length; i++) {
      if (out[i].centavos) r.push({ conta: out[i].conta, valor: out[i].centavos / 100 });
    }
    return r.length ? r : null;
  }

  /**
   * Separa as contas padrão em "do parceiro" e "da linha".
   *
   * Índice 0 é a LINHA-RESUMO (manual p.82): é ela que carrega a conta de a receber / a pagar da
   * transação. As demais, com valor e conta, são as contas de custo, receita e despesa — o lado
   * que um expurgo de custo tem de devolver.
   *
   * O peso é o valor absoluto da linha: é a base do rateio proporcional.
   */
  function mapearContasPadrao(standardLines) {
    var contas = { parceiro: null, linha: [] };
    var porConta = {};
    var ordem = [];

    var n = standardLines.count;
    for (var i = 0; i < n; i++) {
      var l = standardLines.getLine({ index: i });

      var debito = numero(l.debitAmount);
      var credito = numero(l.creditAmount);
      var conta = numero(l.accountId);

      // Condição literal do manual (p.82-83) para descartar as linhas ocultas do GL Impact.
      if (!(debito || credito) || !conta) continue;

      if (i === 0) { contas.parceiro = conta; continue; }

      var peso = Math.abs(debito || credito);
      if (!porConta[conta]) { porConta[conta] = 0; ordem.push(conta); }
      porConta[conta] += peso;
    }

    for (var j = 0; j < ordem.length; j++) {
      contas.linha.push({ conta: ordem[j], peso: porConta[ordem[j]] });
    }
    return contas;
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function texto(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function numero(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  /** Checkbox volta ora booleano, ora `'T'`/`'F'`, ora `'true'`, conforme a origem da leitura. */
  function booleano(v) {
    if (v === true || v === false) return v;
    var s = texto(v).toUpperCase();
    return s === 'T' || s === 'TRUE' || s === 'Y' || s === '1';
  }
  function arredondar(v) {
    return Math.round(v * 100) / 100;
  }

  function formatar(v) {
    return arredondar(Math.abs(v)).toFixed(2);
  }

  return {
    customizeGlImpact: customizeGlImpact
  };
});
