/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * ENTRADA — a compra lançada no NetSuite declara à plataforma o que a nota do fornecedor não diz.
 *
 * ── O FLUXO, E POR QUE NÃO É LOTE ──────────────────────────────────────────────────────────────
 *
 * Quem lança a compra já decidiu insumo × revenda × ativo × uso e consumo. É nesse momento, no
 * `beforeSubmit` da vendor bill, que a natureza vai à plataforma — não num Map/Reduce depois, em
 * que ninguém está olhando e a decisão já esfriou. Este módulo só MONTA e COMPARA; quem chama a
 * rede é o `fp_client`, e quem orquestra é o `fp_ue_simular`.
 *
 *   `POST /transacoes/reclassificar` — `ReclassificarDto` (`reclassificar.dto.ts`):
 *     chaveAcesso · naturezaOperacao (cabeçalho) · dataEntrada · linhas[{numeroItem, naturezaOperacao}]
 *   A plataforma reprocessa a nota CAPTURADA pelo motor atual, a partir do XML guardado, e devolve
 *   o documento detalhado (`transacoes.service.detalhar`): `linhas[].impostos[]` com os mesmos nomes
 *   do resultado do `/simular` — por isso o `fp_md_map_simular.aplicar` o grava sem adaptação.
 *
 * ── ⚠ O CASAMENTO DA LINHA É PELO nItem DO XML ─────────────────────────────────────────────────
 *
 * `numeroItem` é o `nItem` da nota do FORNECEDOR. O bundle numera as linhas da vendor bill na
 * ordem em que estão (a mesma numeração do `/simular`). Se a vendor bill não seguir a ordem do XML
 * — linha a mais, duas juntadas, ordem trocada —, a natureza de LINHA cai no item errado. A de
 * CABEÇALHO não tem esse risco, e é por isso que só vai natureza de linha onde a linha declarou.
 *
 * ── A COMPARAÇÃO NÃO TEM VEREDITO ──────────────────────────────────────────────────────────────
 *
 * Documento (o que o fornecedor destacou, reprocessado) × simulação (o que o motor calcula para a
 * mesma compra pelos dados do NetSuite). O bundle mostra os DOIS valores, por linha e tributo, e
 * não decide se a diferença é incoerência: tolerância, quais tributos contam e o que é aceitável é
 * régua, e régua é da plataforma (CLAUDE.md, "não recalcule para conferir").
 */
define(['./fp_fields'], function (fpFields) {

  /** Corpo do `reclassificar`, ou `null` quando a compra não declarou chave. */
  function montarReclassificar(newRecord, dataIsoDe, codigoLinhas) {
    var campoChave = fpFields.id('CHAVE_ENTRADA');
    var chave = String((campoChave && newRecord.getValue({ fieldId: campoChave })) || '').replace(/\D/g, '');
    if (!chave) return null;

    var corpo = { chaveAcesso: chave };

    var campoNat = fpFields.id('NATUREZA');
    var natureza = campoNat && newRecord.getText({ fieldId: campoNat });
    if (natureza) corpo.naturezaOperacao = natureza;

    var campoData = fpFields.id('DATA_ENTRADA');
    var data = campoData && dataIsoDe(newRecord.getValue({ fieldId: campoData }));
    if (data) corpo.dataEntrada = data;

    // Natureza de LINHA só onde a linha declarou — a linha calada herda o cabeçalho lá.
    var linhas = [];
    for (var i = 0; i < codigoLinhas.length; i++) {
      if (codigoLinhas[i]) linhas.push({ numeroItem: i + 1, naturezaOperacao: codigoLinhas[i] });
    }
    if (linhas.length) corpo.linhas = linhas;

    return corpo;
  }

  /**
   * Documento × simulação, por linha e tributo. Devolve `{ quadro, diferentes }`: o quadro inteiro
   * vai para o rastro; `diferentes` são as entradas em que os dois valores não são iguais ao
   * centavo — contagem, não julgamento.
   */
  function comparar(documento, simulacao) {
    var idx = {};
    function indexar(fonte, lado) {
      var ls = (fonte && fonte.linhas) || [];
      for (var i = 0; i < ls.length; i++) {
        var n = ls[i].numeroItem || (i + 1);
        var imps = ls[i].impostos || [];
        for (var j = 0; j < imps.length; j++) {
          var k = n + '|' + imps[j].taxCodigo;
          idx[k] = idx[k] || { numeroItem: n, taxCodigo: imps[j].taxCodigo };
          idx[k][lado] = { cst: imps[j].cst || null, base: num(imps[j].baseCalculo),
            aliquota: num(imps[j].aliquota), valor: num(imps[j].valor) };
        }
      }
    }
    indexar(documento, 'documento');
    indexar(simulacao, 'simulacao');

    var quadro = [], diferentes = [];
    for (var k in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, k)) continue;
      var e = idx[k];
      quadro.push(e);
      var vd = e.documento ? e.documento.valor : null;
      var vs = e.simulacao ? e.simulacao.valor : null;
      if (vd === null || vs === null || Math.round(vd * 100) !== Math.round(vs * 100)) diferentes.push(e);
    }
    quadro.sort(function (a, b) { return a.numeroItem - b.numeroItem || String(a.taxCodigo).localeCompare(String(b.taxCodigo)); });
    diferentes.sort(function (a, b) { return a.numeroItem - b.numeroItem; });
    return { quadro: quadro, diferentes: diferentes };
  }

  /** Uma linha legível por diferença, com os dois lados literais. Até `max` linhas. */
  function descrever(diferentes, max) {
    var out = [];
    for (var i = 0; i < diferentes.length && i < max; i++) {
      var e = diferentes[i];
      out.push('item ' + e.numeroItem + ' · ' + e.taxCodigo + ' — documento ' + lado(e.documento) +
        ' | simulação ' + lado(e.simulacao));
    }
    if (diferentes.length > max) out.push('… e mais ' + (diferentes.length - max) + ' (quadro inteiro no anexo -comparacao.json)');
    return out;
  }

  function lado(v) {
    if (!v) return 'ausente';
    return 'CST ' + (v.cst || '—') + ', base ' + v.base + ', ' + v.aliquota + '%, valor ' + v.valor;
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  return { montarReclassificar: montarReclassificar, comparar: comparar, descrever: descrever };
});
