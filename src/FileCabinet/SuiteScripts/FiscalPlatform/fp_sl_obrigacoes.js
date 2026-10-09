/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * A TELA "OBRIGAÇÕES" — escolhe o arquivo, dispara o `fp_mr_obrigacoes` e lista os CSVs prontos.
 *
 * Ela não monta arquivo: quem monta é o Map/Reduce, porque o volume não cabe aqui. O CSV baixado
 * vai para a tela de importação da plataforma, que valida pelo contrato e processa.
 *
 * Map/Reduce já rodando (outro pedido em curso) volta como mensagem, não como erro de página.
 */
define(['N/ui/serverWidget', 'N/task', 'N/query', 'N/runtime', 'N/url', 'N/log', './fp_obrigacoes_arquivos'],
  function (serverWidget, task, query, runtime, url, log, fpArquivos) {

    function onRequest(contexto) {
      var form = serverWidget.createForm({ title: 'Obrigações — arquivos para a plataforma' });
      var aviso = '';

      if (contexto.request.method === 'POST') {
        var tipo = contexto.request.parameters.custpage_fp_arquivo;
        var subsidiaria = contexto.request.parameters.custpage_fp_subsidiaria;
        try {
          var id = task.create({
            taskType: task.TaskType.MAP_REDUCE,
            scriptId: 'customscript_fp_mr_obrigacoes',
            deploymentId: 'customdeploy_fp_mr_obrigacoes',
            params: { custscript_fp_obr_arquivo: tipo, custscript_fp_obr_subsidiaria: subsidiaria }
          }).submit();
          aviso = 'Geração de ' + tipo + ' da subsidiária ' + subsidiaria + ' disparada (tarefa ' + id + '). Atualize a página para ver o arquivo na lista.';
          log.audit('fp_sl_obrigacoes', aviso);
        } catch (e) {
          aviso = 'Não disparou: ' + (e.message || String(e));
          log.error('fp_sl_obrigacoes', { name: e.name, message: e.message });
        }
      }

      var sel = form.addField({ id: 'custpage_fp_arquivo', type: serverWidget.FieldType.SELECT, label: 'Arquivo' });
      fpArquivos.tipos().forEach(function (t) { sel.addSelectOption({ value: t, text: t }); });
      sel.isMandatory = true;

      // POR SUBSIDIÁRIA: a importação na plataforma é por empresa, e só subsidiária com filial
      // (location com CNPJ) tem o que importar.
      var sub = form.addField({ id: 'custpage_fp_subsidiaria', type: serverWidget.FieldType.SELECT, label: 'Subsidiária' });
      fpArquivos.subsidiariasComFilial().forEach(function (s) { sub.addSelectOption({ value: String(s.id), text: s.nome }); });
      sub.isMandatory = true;
      form.addSubmitButton({ label: 'Gerar' });

      if (aviso) {
        form.addField({ id: 'custpage_fp_aviso', type: serverWidget.FieldType.INLINEHTML, label: ' ' })
          .defaultValue = '<p style="font-size:14px;padding:8px 0">' + escapar(aviso) + '</p>';
      }

      var lista = form.addSublist({ id: 'custpage_fp_arquivos', type: serverWidget.SublistType.LIST, label: 'Arquivos gerados' });
      lista.addField({ id: 'custpage_nome', type: serverWidget.FieldType.TEXT, label: 'Arquivo' });
      lista.addField({ id: 'custpage_data', type: serverWidget.FieldType.TEXT, label: 'Gerado em' });
      lista.addField({ id: 'custpage_link', type: serverWidget.FieldType.URL, label: 'Baixar' }).linkText = 'baixar';

      var pasta = runtime.getCurrentScript().getParameter({ name: 'custscript_fp_pasta_payload' });
      // URL ABSOLUTA: campo URL com endereço relativo já deu tela branca neste bundle (memória
      // formulario-se-organiza-por-objeto). A `url` do `file` vem relativa.
      var dominio = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION });
      if (pasta) {
        query.runSuiteQL({
          query: "SELECT id, name, url, TO_CHAR(createddate, 'YYYY-MM-DD HH24:MI') AS criado FROM file " +
                 "WHERE folder = ? AND name LIKE 'FP-%.csv' ORDER BY id DESC FETCH FIRST 50 ROWS ONLY",
          params: [pasta]
        }).asMappedResults().forEach(function (f, i) {
          lista.setSublistValue({ id: 'custpage_nome', line: i, value: f.name });
          lista.setSublistValue({ id: 'custpage_data', line: i, value: f.criado || ' ' });
          if (f.url) lista.setSublistValue({ id: 'custpage_link', line: i, value: dominio + f.url });
        });
      }

      contexto.response.writePage(form);
    }

    function escapar(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return { onRequest: onRequest };
  });
