/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * A GOVERNANÇA DE CADA EXECUÇÃO, MEDIDA NO FIM — e não estimada.
 *
 * Envolve o ponto de entrada: guarda a governança restante ao entrar e, num `finally`, loga quanto
 * foi usado e quanto sobrou. O `finally` é o que faz o número sair também quando o ponto de entrada
 * retorna cedo ou lança — que são justamente as execuções em que alguém vai querer saber o custo.
 *
 * Uma linha de AUDIT por execução, com rótulo fixo `fp_governanca`: filtrar o Execution Log por ele
 * dá o custo de cada ponto de entrada, nota a nota. É assim que se confere a regra do bundle —
 * custo constante por nota, nunca por linha —, e não por conta feita no papel.
 */
define(['N/runtime', 'N/log'], function (runtime, log) {

  function medir(rotulo, fn) {
    var script = runtime.getCurrentScript();
    var inicio = script.getRemainingUsage();
    try {
      return fn();
    } finally {
      var fim = script.getRemainingUsage();
      log.audit('fp_governanca', rotulo + ' · usou ' + (inicio - fim) + ' · restam ' + fim + ' (entrou com ' + inicio + ')');
    }
  }

  return { medir: medir };
});
