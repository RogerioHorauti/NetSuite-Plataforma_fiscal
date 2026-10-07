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
define(['N/query'], function (query) {

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

  /** `{ subsidiaria: [cnpj, ...] }` das locations com CNPJ — as FILIAIS do desenho da plataforma. */
  function filiaisPorSubsidiaria() {
    var mapa = {};
    todas('SELECT subsidiary, custrecord_fp_cnpj_filial AS cnpj FROM location ' +
          "WHERE custrecord_fp_cnpj_filial IS NOT NULL AND isinactive = 'F'").forEach(function (l) {
      var cnpj = String(l.cnpj || '').replace(/\D/g, '');
      if (cnpj.length !== 14) return;
      var s = String(l.subsidiary);
      (mapa[s] = mapa[s] || []).push(cnpj);
    });
    return mapa;
  }

  /**
   * PLANO_DE_CONTAS v1 — `contratos/importacao-csv/plano_de_contas.v1.md`.
   *
   * Uma linha por conta, com as filiais em `filiais`. As filiais são as locations com CNPJ das
   * subsidiárias da conta (`account.subsidiary` volta como lista "1, 2, 3"): conta sem nenhuma
   * filial brasileira não entra — a subsidiária pode não ser do Brasil.
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
    linhas: function () {
      var filiais = filiaisPorSubsidiaria();
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
        var cnpjs = {};
        String(c.subsidiary || '').split(',').forEach(function (s) {
          (filiais[s.trim()] || []).forEach(function (x) { cnpjs[x] = true; });
        });
        var lista = Object.keys(cnpjs);
        if (!lista.length) return;
        var pai = c.parent && porId[String(c.parent)];
        out.push(linhaCsv([c.acctnumber, c.nome, c.issummary === 'T' ? 'S' : 'A', '', nivel(c),
          pai ? pai.acctnumber : '', '', '', '', c.alt, c.isinactive === 'T' ? 'false' : 'true', lista.join('|')]));
      });
      return out;
    }
  };

  var ARQUIVOS = { PLANO_DE_CONTAS: PLANO_DE_CONTAS };

  function definicao(tipo) {
    var d = ARQUIVOS[tipo];
    if (!d) throw new Error('arquivo de obrigação desconhecido: ' + tipo + ' (há: ' + Object.keys(ARQUIVOS).join(', ') + ')');
    return d;
  }

  return { definicao: definicao, tipos: function () { return Object.keys(ARQUIVOS); }, linhaCsv: linhaCsv };
});
