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

  /**
   * Os CNPJs das FILIAIS (locations com CNPJ) de UMA subsidiária.
   *
   * O arquivo é POR SUBSIDIÁRIA porque a importação é por EMPRESA: o contrato exige que cada CNPJ
   * de `filiais` "seja da empresa que importa", e subsidiária ↔ empresa da plataforma. Conta
   * compartilhada entre subsidiárias sairia com CNPJ de duas empresas, e o arquivo seria recusado.
   */
  function filiaisDaSubsidiaria(subsidiaria) {
    var cnpjs = [];
    todas('SELECT custrecord_fp_cnpj_filial AS cnpj FROM location ' +
          "WHERE subsidiary = ? AND custrecord_fp_cnpj_filial IS NOT NULL AND isinactive = 'F'", [subsidiaria])
      .forEach(function (l) {
        var cnpj = String(l.cnpj || '').replace(/\D/g, '');
        if (cnpj.length === 14 && cnpjs.indexOf(cnpj) === -1) cnpjs.push(cnpj);
      });
    return cnpjs;
  }

  /** As subsidiárias que TÊM filial com CNPJ — as únicas que geram arquivo. `[{id, nome}]`. */
  function subsidiariasComFilial() {
    // Subconsulta e não JOIN + DISTINCT: este dá "Invalid or unsupported search" (medido na conta).
    return todas("SELECT s.id, s.name AS nome FROM subsidiary s WHERE s.isinactive = 'F' AND s.id IN " +
      "(SELECT l.subsidiary FROM location l WHERE l.custrecord_fp_cnpj_filial IS NOT NULL AND l.isinactive = 'F') " +
      'ORDER BY s.name');
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
    linhas: function (subsidiaria) {
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

  var ARQUIVOS = { PLANO_DE_CONTAS: PLANO_DE_CONTAS };

  function definicao(tipo) {
    var d = ARQUIVOS[tipo];
    if (!d) throw new Error('arquivo de obrigação desconhecido: ' + tipo + ' (há: ' + Object.keys(ARQUIVOS).join(', ') + ')');
    return d;
  }

  return { definicao: definicao, tipos: function () { return Object.keys(ARQUIVOS); }, linhaCsv: linhaCsv,
    subsidiariasComFilial: subsidiariasComFilial };
});
