/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 *
 * GERA O CSV DE UMA OBRIGAÇÃO — o arquivo que a tela de importação da plataforma processa.
 *
 * Map/Reduce porque o volume não cabe numa requisição de Suitelet: um export real de plano de
 * contas teve 58 mil linhas, e o razão de um mês fica nessa ordem. Quem dispara é o Suitelet
 * "Obrigações" (`N/task`), com o tipo do arquivo no parâmetro `custscript_fp_obr_arquivo`.
 *
 *   getInputData   as linhas do arquivo, já no layout da plataforma (`fp_obrigacoes_arquivos`)
 *   map            repassa cada linha para o `summarize`, com a posição como chave
 *   summarize      grava o CSV na pasta do bundle (`custscript_fp_pasta_payload`), em partes de
 *                  até ~9 MB — o `N/file` não passa de 10 MB —, cada parte com o cabeçalho
 *
 * Um arquivo POR SUBSIDIÁRIA (`custscript_fp_obr_subsidiaria`): a importação é por empresa.
 * Nome: `FP-<arquivo>-sub<id>-<AAAAMMDDHHmm>-<parte>.csv`. Erro de qualquer etapa vai inteiro para o log.
 */
define(['N/runtime', 'N/file', 'N/log', './fp_obrigacoes_arquivos'],
  function (runtime, file, log, fpArquivos) {

    var LIMITE_BYTES = 9 * 1024 * 1024;

    function definicao() {
      return fpArquivos.definicao(runtime.getCurrentScript().getParameter({ name: 'custscript_fp_obr_arquivo' }));
    }

    function subsidiaria() {
      return runtime.getCurrentScript().getParameter({ name: 'custscript_fp_obr_subsidiaria' });
    }

    function getInputData() {
      var d = definicao();
      var linhas = d.linhas(subsidiaria());
      log.audit('fp_mr_obrigacoes', d.tipo + ' · subsidiária ' + subsidiaria() + ' · ' + linhas.length + ' linha(s)');
      return linhas;
    }

    function map(context) {
      context.write({ key: String(context.key), value: context.value });
    }

    function summarize(summary) {
      if (summary.inputSummary.error) log.error('fp_mr_obrigacoes.input', summary.inputSummary.error);
      summary.mapSummary.errors.iterator().each(function (k, e) { log.error('fp_mr_obrigacoes.map ' + k, e); return true; });

      var d = definicao();
      var pasta = runtime.getCurrentScript().getParameter({ name: 'custscript_fp_pasta_payload' });
      if (!pasta) {
        log.error('fp_mr_obrigacoes', 'parâmetro "Pasta do Payload" não definido nas Preferências da Empresa — o arquivo NÃO foi gravado.');
        return;
      }

      var linhas = [];
      summary.output.iterator().each(function (k, v) { linhas.push({ i: Number(k), v: v }); return true; });
      linhas.sort(function (a, b) { return a.i - b.i; });

      var cabecalho = fpArquivos.linhaCsv(d.colunas);
      var carimbo = new Date().toISOString().replace(/\D/g, '').substring(0, 12);
      var partes = [], atual = null, bytes = 0;
      var abrir = function () {
        atual = file.create({
          name: 'FP-' + d.arquivo + '-sub' + subsidiaria() + '-' + carimbo + '-' + (partes.length + 1) + '.csv',
          fileType: file.Type.CSV, folder: pasta, encoding: file.Encoding.UTF_8
        });
        atual.appendLine({ value: cabecalho });
        bytes = cabecalho.length + 2;
      };
      var fechar = function () { partes.push(atual.name + ' (id ' + atual.save() + ')'); };

      abrir();
      linhas.forEach(function (l) {
        if (bytes + l.v.length + 2 > LIMITE_BYTES) { fechar(); abrir(); }
        atual.appendLine({ value: l.v });
        bytes += l.v.length + 2;
      });
      fechar();

      log.audit('fp_mr_obrigacoes', d.tipo + ' · ' + linhas.length + ' linha(s) em ' + partes.length +
        ' arquivo(s): ' + partes.join(', '));
    }

    return { getInputData: getInputData, map: map, summarize: summarize };
  });
