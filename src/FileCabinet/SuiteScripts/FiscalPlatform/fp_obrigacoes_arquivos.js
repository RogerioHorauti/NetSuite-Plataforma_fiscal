/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * OS ARQUIVOS DAS OBRIGAÇÕES — o CSV que a tela de importação da plataforma recebe.
 *
 * O LAYOUT É DA PLATAFORMA, e este módulo só o segue: `fiscal-platform/contratos/importacao-csv/
 * <tipo>.v<n>.md` (gerado de `backend/src/modules/importacao/layouts/`). Coluna a mais, a menos ou
 * com outro nome recusa o arquivo inteiro lá — por isso os nomes daqui são os de lá, letra a letra.
 *
 * Formato comum (o "Formato do arquivo" do contrato): UTF-8, `;` como delimitador, cabeçalho na
 * primeira linha, data AAAA-MM-DD, decimal `.`, aspas RFC 4180, listas separadas por `|`.
 *
 * O bundle TRADUZ e não classifica: o que não tem origem no NetSuite sai VAZIO — nunca derivado
 * aqui (a `natureza` do plano de contas é o caso: régua da plataforma).
 */
define(['N/query', 'N/runtime', './fp_fields'], function (query, runtime, fpFields) {

  /** Um campo CSV pelas regras do contrato: aspas quando tem `;`, aspas ou quebra de linha. */
  function campo(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function linhaCsv(valores) {
    return valores.map(campo).join(';');
  }

  /** SuiteQL paginada: 1.000 linhas por página, 10 unidades cada. */
  function todas(sql, params) {
    var out = [];
    var paginado = query.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000 });
    paginado.pageRanges.forEach(function (r) {
      out = out.concat(paginado.fetch({ index: r.index }).data.asMappedResults());
    });
    return out;
  }

  /**
   * Os CNPJs das FILIAIS (locations com CNPJ) de UMA subsidiária.
   *
   * O arquivo é POR SUBSIDIÁRIA porque a importação é por EMPRESA: o contrato exige que cada CNPJ
   * de `filiais` "seja da empresa que importa", e subsidiária ↔ empresa da plataforma. Conta
   * compartilhada entre subsidiárias sairia com CNPJ de duas empresas, e o arquivo seria recusado.
   */
  function filiaisDaSubsidiaria(subsidiaria) {
    var porLocation = locationsDaSubsidiaria(subsidiaria), cnpjs = [];
    Object.keys(porLocation).forEach(function (k) {
      if (cnpjs.indexOf(porLocation[k]) === -1) cnpjs.push(porLocation[k]);
    });
    return cnpjs;
  }

  /**
   * `{ idDaLocation: cnpj }` das locations com CNPJ da subsidiária.
   *
   * ⚠ Filtrar `location` por `subsidiary = ?` dá "Invalid or unsupported search" (medido em
   * 2026-10-09). Lê as locations com CNPJ e filtra aqui — como as contas, cuja subsidiária também
   * volta como lista.
   */
  function locationsDaSubsidiaria(subsidiaria) {
    var mapa = {};
    todas("SELECT id, subsidiary, custrecord_fp_cnpj_filial AS cnpj FROM location " +
          "WHERE custrecord_fp_cnpj_filial IS NOT NULL AND isinactive = 'F'")
      .forEach(function (l) {
        var subs = String(l.subsidiary || '').split(',').map(function (x) { return x.trim(); });
        if (subs.indexOf(String(subsidiaria)) === -1) return;
        var cnpj = String(l.cnpj || '').replace(/\D/g, '');
        if (cnpj.length === 14) mapa[String(l.id)] = cnpj;
      });
    return mapa;
  }

  /** Todas as subsidiárias ativas, `[{id, nome}]` — a tela lista todas (Rogerio, 2026-10-09). */
  function subsidiarias() {
    return todas("SELECT id, name AS nome FROM subsidiary WHERE isinactive = 'F' ORDER BY name");
  }

  /**
   * PLANO_DE_CONTAS v1 — `contratos/importacao-csv/plano_de_contas.v1.md`.
   *
   * Uma linha por conta DA SUBSIDIÁRIA pedida (`account.subsidiary` volta como lista "1, 2, 3"),
   * com as filiais (locations com CNPJ) DELA em `filiais`. Subsidiária sem filial brasileira não
   * gera arquivo — ela pode não ser do Brasil.
   *
   *   nome        `accountsearchdisplaynamecopy` (o `fullname` traz "Pai : Filho")
   *   nivel       profundidade na árvore do `parent`, a partir de 1
   *   natureza, codigoReduzido, codigoReferencialSped, codigoAglutinacao   VAZIOS: sem origem aqui
   */
  var PLANO_DE_CONTAS = {
    tipo: 'PLANO_DE_CONTAS',
    arquivo: 'plano_de_contas_v1',
    colunas: ['codigo', 'nome', 'indicador', 'natureza', 'nivel', 'codigoPai', 'codigoReduzido',
      'codigoReferencialSped', 'codigoAglutinacao', 'dataAlteracao', 'ativa', 'filiais'],
    linhas: function (p) {
      var subsidiaria = p.subsidiaria;
      var filiais = filiaisDaSubsidiaria(subsidiaria);
      if (!filiais.length) {
        throw new Error('a subsidiária ' + subsidiaria + ' não tem filial (location) com CNPJ: não há o que importar.');
      }
      var lista = filiais.join('|');
      var contas = todas("SELECT a.id, a.parent, a.acctnumber, a.accountsearchdisplaynamecopy AS nome, " +
        "a.issummary, a.isinactive, a.subsidiary, TO_CHAR(a.lastmodifieddate, 'YYYY-MM-DD') AS alt " +
        "FROM account a WHERE a.accttype <> 'NonPosting'");
      var porId = {};
      contas.forEach(function (c) { porId[String(c.id)] = c; });

      var nivel = function (c) {
        var n = 1, p = c.parent, guarda = 0;
        while (p && porId[String(p)] && guarda++ < 50) { n++; p = porId[String(p)].parent; }
        return n;
      };

      var out = [];
      contas.forEach(function (c) {
        var subs = String(c.subsidiary || '').split(',').map(function (s) { return s.trim(); });
        if (subs.indexOf(String(subsidiaria)) === -1) return;
        var pai = c.parent && porId[String(c.parent)];
        out.push(linhaCsv([c.acctnumber, c.nome, c.issummary === 'T' ? 'S' : 'A', '', nivel(c),
          pai ? pai.acctnumber : '', '', '', '', c.alt, c.isinactive === 'T' ? 'false' : 'true', lista]));
      });
      return out;
    }
  };

  /**
   * LANCAMENTOS_CONTABEIS v1 — `contratos/importacao-csv/lancamentos_contabeis.v1.md`.
   *
   * O razão LANÇADO da subsidiária na competência: `transactionaccountingline` com `posting = 'T'`
   * — inclusive as linhas do GL plug-in, que estão lá como as outras (medido na transação 1705: 13
   * linhas, débito = crédito = 176,38). Uma linha do CSV por PARTIDA, as colunas do lançamento
   * repetidas, como o contrato pede.
   *
   *   idExterno     o internal id da transação — identidade estável; reimportar substitui
   *   cnpj          o da location do CABEÇALHO; sem location, o da filial ÚNICA da subsidiária;
   *                 com mais de uma filial e sem location, a transação NÃO entra (contada no log)
   *   data          `trandate` (DT_LCTO); a competência filtra por ela
   *   numero        `tranid` · historico `memo` · origem o tipo da transação · chaveAcesso `DOC_CHAVE`
   *   conta         `acctnumber`. Linha de `transactionaccountingline` SEM conta NÃO é partida: medido
   *                 em 2022-03 (sub 3), com elas a bill 1633 dá débito 50.600 × crédito 25.300, e o
   *                 excesso é exatamente as duas linhas sem conta (10.000 + 15.300); sem elas, fecha —
   *                 idem 1681, 1683, 1685. Por isso o JOIN em `account` é INNER
   *   natureza/valor  D/C pelo lado em que o valor está, sem sinal; partida de valor zero não entra
   *   numeroItem    `custcol_fp_numero_item` da linha da transação — o elo do COD_CTA com o C170
   *   indLcto       VAZIO: "a plataforma não deriva; vazio é legítimo até a ECD" (o contrato)
   *
   * ⚠ MULTIBOOK: com a feature ligada, só o livro principal. NÃO medido (a sandbox tem um livro só).
   */
  var LANCAMENTOS_CONTABEIS = {
    tipo: 'LANCAMENTOS_CONTABEIS',
    arquivo: 'lancamentos_contabeis_v1',
    porCompetencia: true,
    colunas: ['cnpj', 'idExterno', 'data', 'chaveAcesso', 'numero', 'historico', 'origem', 'indLcto',
      'conta', 'natureza', 'valor', 'numeroItem', 'codigoParticipante', 'centroCusto'],
    linhas: function (p) {
      var locs = locationsDaSubsidiaria(p.subsidiaria);
      var unicas = {};
      Object.keys(locs).forEach(function (k) { unicas[locs[k]] = true; });
      var cnpjsDaSub = Object.keys(unicas);
      if (!cnpjsDaSub.length) {
        throw new Error('a subsidiária ' + p.subsidiaria + ' não tem filial (location) com CNPJ: não há o que importar.');
      }
      var m = /^(\d{4})-(\d{2})$/.exec(String(p.competencia || ''));
      if (!m) throw new Error('competência inválida: "' + p.competencia + '" (use AAAA-MM).');
      var de = m[1] + '-' + m[2] + '-01';
      var ate = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().substring(0, 10);

      var livro = runtime.isFeatureInEffect({ feature: 'MULTIBOOK' })
        ? " AND tal.accountingbook = (SELECT id FROM accountingbook WHERE isprimary = 'T')" : '';
      var cChave = fpFields.id('DOC_CHAVE'), cItem = fpFields.idLinha('LINHA_NUMERO_ITEM');
      var partidas = todas('SELECT t.id, t.tranid, TO_CHAR(t.trandate, \'YYYY-MM-DD\') AS data, t.memo, ' +
        'BUILTIN.DF(t.type) AS origem, ' + (cChave ? 't.' + cChave : 'NULL') + ' AS chave, tlm.location AS loc, a.acctnumber AS conta, ' +
        'tal.debit, tal.credit, ' + (cItem ? 'tl.' + cItem : 'NULL') + ' AS item ' +
        'FROM transactionaccountingline tal JOIN transaction t ON t.id = tal.transaction ' +
        "JOIN transactionline tlm ON tlm.transaction = t.id AND tlm.mainline = 'T' " +
        'JOIN account a ON a.id = tal.account ' +
        'LEFT JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline ' +
        "WHERE tal.posting = 'T' AND tlm.subsidiary = ? AND t.trandate BETWEEN TO_DATE(?, 'YYYY-MM-DD') " +
        "AND TO_DATE(?, 'YYYY-MM-DD')" + livro + ' ORDER BY t.id, tal.transactionline',
        [p.subsidiaria, de, ate]);

      var out = [], semFilial = {};
      partidas.forEach(function (x) {
        var deb = Number(x.debit) || 0, cred = Number(x.credit) || 0;
        if (!deb && !cred) return;
        var cnpj = (x.loc && locs[String(x.loc)]) || (!x.loc && cnpjsDaSub.length === 1 ? cnpjsDaSub[0] : '');
        if (!cnpj) { semFilial[x.id] = true; return; }
        out.push(linhaCsv([cnpj, x.id, x.data, String(x.chave || '').replace(/\D/g, ''), x.tranid, x.memo,
          x.origem, '', x.conta, deb ? 'D' : 'C', (deb || cred).toFixed(2), x.item, '', '']));
      });
      p.avisos = [];
      if (Object.keys(semFilial).length) {
        p.avisos.push(Object.keys(semFilial).length + ' transação(ões) fora do arquivo: sem location com CNPJ desta ' +
          'subsidiária no cabeçalho, e a subsidiária tem mais de uma filial (ids ' + Object.keys(semFilial).slice(0, 20).join(', ') + ').');
      }
      return out;
    }
  };

  var ARQUIVOS = { PLANO_DE_CONTAS: PLANO_DE_CONTAS, LANCAMENTOS_CONTABEIS: LANCAMENTOS_CONTABEIS };

  function definicao(tipo) {
    var d = ARQUIVOS[tipo];
    if (!d) throw new Error('arquivo de obrigação desconhecido: ' + tipo + ' (há: ' + Object.keys(ARQUIVOS).join(', ') + ')');
    return d;
  }

  return { definicao: definicao, tipos: function () { return Object.keys(ARQUIVOS); }, linhaCsv: linhaCsv,
    subsidiarias: subsidiarias, filiaisDaSubsidiaria: filiaisDaSubsidiaria };
});
