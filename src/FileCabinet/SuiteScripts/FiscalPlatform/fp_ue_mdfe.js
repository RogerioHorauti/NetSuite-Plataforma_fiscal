/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 *
 * OS BOTÕES DO MANIFESTO MDF-e — o `fp_ue_emissao` do `customrecord_fp_mdfe`.
 *
 * Só `beforeLoad`, só em VIEW de registro gravado, pela mesma razão do da transação: o Suitelet
 * emite o que está no BANCO, e em edição há alteração que ninguém salvou.
 *
 *   sem status / REJEITADO   Emitir                 (o mesmo idExterno: reenviar devolve o anterior)
 *   EM_TRANSMISSAO           Consultar SEFAZ
 *   AUTORIZADO               Encerrar + Cancelar    encerrar NÃO é opcional — fim da viagem
 *   ENCERRADO / CANCELADO    nada
 */
define(['N/runtime', 'N/url', 'N/log', './fp_mdfe', './fp_governanca'],
  function (runtime, url, log, fpMdfe, fpGovernanca) {

    function beforeLoad(scriptContext) {
      try {
        botoes(scriptContext);
      } catch (e) {
        log.error('fp_ue_mdfe.beforeLoad', { name: e.name, message: e.message, stack: e.stack });
      }
    }

    function botoes(scriptContext) {
      if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
      if (scriptContext.type !== scriptContext.UserEventType.VIEW) return;
      var id = scriptContext.newRecord.id;
      if (!id) return;

      var form = scriptContext.form;
      form.clientScriptModulePath = './fp_cs_transacao.js';
      var status = fpMdfe.valor(scriptContext.newRecord, 'STATUS').toUpperCase();

      if (!status || status === 'REJEITADO') {
        botao(form, 'custpage_fp_mdfe_emitir', 'Emitir MDF-e', scriptContext, id, 'emitir', true);
      }
      if (status === 'EM_TRANSMISSAO') {
        botao(form, 'custpage_fp_mdfe_consultar', 'Consultar SEFAZ', scriptContext, id, 'reconciliar', false);
      }
      if (status === 'AUTORIZADO') {
        botao(form, 'custpage_fp_mdfe_encerrar', 'Encerrar', scriptContext, id, 'encerrar', false,
          'Onde a viagem terminou: MUNICIPIO/UF (se não foi hoje, MUNICIPIO/UF/AAAA-MM-DD)');
        botao(form, 'custpage_fp_mdfe_cancelar', 'Cancelar', scriptContext, id, 'cancelar', false,
          'Justificativa do cancelamento (15 a 255 caracteres). Viagem que aconteceu se encerra, não se cancela:');
      }
    }

    function botao(form, idBotao, rotulo, scriptContext, id, acao, consome, pergunta) {
      var destino = url.resolveScript({
        scriptId: 'customscript_fp_sl_emissao',
        deploymentId: 'customdeploy_fp_sl_emissao',
        params: { tipo: scriptContext.newRecord.type, id: id, acao: acao }
      });
      form.addButton({
        id: idBotao,
        label: rotulo,
        functionName: "acionar('" + destino + "','" + rotulo + "'," + (consome ? 'true' : 'false') + ",'" +
          (pergunta || '') + "')"
      });
    }

    return {
      beforeLoad: function (c) { return fpGovernanca.medir('fp_ue_mdfe.beforeLoad ' + c.type, function () { return beforeLoad(c); }); }
    };
  });
