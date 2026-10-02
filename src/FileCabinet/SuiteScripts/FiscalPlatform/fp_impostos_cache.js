/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * OS IMPOSTOS APLICADOS, DO `beforeSubmit` PARA O GL PLUG-IN, PELO `N/cache`.
 *
 * A chave é o `corrId` (`custbody_fp_corrid`): campo de CORPO, que chega ao plug-in em qualquer
 * contexto de save. A sublista de registro filho, não — em CSV e webservice ela não vem, e o
 * plug-in não tinha o que lançar. E não depende do id da transação, que o plug-in síncrono não
 * recebe na criação (CustomGLLinesPlugIn.pdf p.17, p.64).
 *
 * O valor é o que foi APLICADO na transação — a simulação, ou na entrada o documento do
 * `reclassificar` —, já na forma que o `agrupar` do plug-in lê. A tradução da resposta do motor
 * mora aqui, uma vez, com os nomes do `fp_md_map_simular.aplicar`.
 *
 * ⚠ Cache não é armazenamento: expira, e o NetSuite pode descartá-lo antes. O plug-in que não
 * acha a chave cai na sublista e na consulta por id. Em CSV/webservice, sem sublista gravada, um
 * plug-in que rode DEPOIS da expiração (reexecução por atualização de custo — manual p.4, p.94)
 * não encontra nada. MEDICOES §8.10.
 */
define(['N/cache', 'N/log'], function (cache, log) {

  var NOME = 'fp_impostos';
  var TTL = 3600;
  // Limite do valor no N/cache: 500 KB. Acima disso o `put` falha; aqui recusa com log, e o
  // plug-in cai na sublista.
  var LIMITE = 500000;

  function obter() {
    return cache.getCache({ name: NOME, scope: cache.Scope.PUBLIC });
  }

  /**
   * Linha compacta: [imposto, natureza, valor, compoe, base, aliquota, perna, gera]. Array e não
   * objeto porque nota de 500 linhas com oito tributos cada cabe com folga só assim.
   */
  function gravar(corrId, resposta) {
    if (!corrId) return;
    var linhas = [];
    ((resposta && resposta.linhas) || []).forEach(function (l) {
      (l.impostos || []).forEach(function (t) {
        linhas.push([t.taxCodigo || '', t.naturezaContabil || '', t.valor || 0, t.compoeTotalNf === true ? 1 : 0,
          t.baseCalculo || 0, t.aliquota === undefined ? null : t.aliquota, t.sentidoDaPernaFixa || '',
          t.geraLancamento === true ? 1 : 0]);
      });
    });
    var valor = JSON.stringify(linhas);
    if (valor.length > LIMITE) {
      log.error('fp_impostos_cache.gravar', 'impostos com ' + valor.length + ' caracteres, acima do limite do ' +
        'N/cache — o GL plug-in vai ler a sublista. corrId=' + corrId);
      return;
    }
    obter().put({ key: corrId, value: valor, ttl: TTL });
  }

  /** `null` quando não há chave no cache; senão a lista na forma do `agrupar`. */
  function ler(corrId) {
    if (!corrId) return null;
    var valor = obter().get({ key: corrId });
    if (!valor) return null;
    return JSON.parse(valor).map(function (a) {
      return { imposto: String(a[0]), natureza: String(a[1]), valor: Number(a[2]) || 0, compoe: a[3] === 1,
        base: Number(a[4]) || 0, aliquota: a[5] === null ? 0 : Number(a[5]), perna: String(a[6]).toUpperCase(),
        gera: a[7] === 1 };
    });
  }

  return { gravar: gravar, ler: ler };
});
