/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 *
 * O BOTÃO DE EMISSÃO NA TRANSAÇÃO. Só isso: injeta o botão e some.
 *
 * ── POR QUE NÃO ESTÁ NO `fp_ue_simular` ────────────────────────────────────────────────────────
 *
 * Simular e emitir não cobrem os mesmos documentos. A simulação roda em oito tipos, inclusive
 * pedido de venda e pedido de compra — documentos que NÃO viram nota fiscal e existem justamente
 * para prever tributo antes de virarem uma. Emissão roda só onde existe documento a emitir.
 *
 * Juntar os dois num User Event só faria o deployment de um arrastar o outro: para o botão
 * aparecer na Transfer Order, a simulação teria de estar deployada lá; para a simulação rodar no
 * pedido de venda, o botão de emitir apareceria nele. Dois scripts, duas listas de deployment, e
 * cada um aparece exatamente onde faz sentido.
 *
 * ── SÓ `beforeLoad` ────────────────────────────────────────────────────────────────────────────
 *
 * Não há `beforeSubmit` nem `afterSubmit` aqui, e não é omissão: emitir é ato explícito, fora do
 * save. Um User Event que emitisse no save queimaria um número por clique em "Salvar".
 */
define(['N/ui/serverWidget', 'N/url', 'N/runtime', 'N/log', './fp_fields'],
  function (serverWidget, url, runtime, log, fpFields) {

    /**
     * Onde EXISTE documento fiscal a emitir.
     *
     * Lista própria, e menor que a do simulador de propósito: pedido de venda, pedido de compra e
     * autorização de devolução simulam tributo e não emitem documento — existem para prever o
     * imposto ANTES de virarem nota.
     */
    var TIPOS = ['invoice', 'vendorbill', 'vendorcredit', 'creditmemo', 'transferorder'];

    /** A subaba que o `fp_ue_simular` monta. Campo sem container cai no topo do formulário. */
    var SUBABA = 'custtab_fp_fiscal';

    function beforeLoad(scriptContext) {
      try {
        injetarBotoes(scriptContext);
      } catch (e) {
        // Botão é conveniência. Trocar "sem botão" por "não abre a transação" é o pior negócio
        // possível — e emitir continua acessível pela URL do Suitelet.
        log.error('fp_ue_emissao.beforeLoad', { name: e.name, message: e.message, stack: e.stack });
      }
    }

    /**
     * Só em transação JÁ GRAVADA: o `idExterno` é o internal id, e num registro novo ele não
     * existe. Emitir uma transação que ainda não foi salva não é uma operação que exista.
     *
     * Só em VIEW, nunca em EDIT. Em edição o usuário tem alterações não salvas na tela, e o
     * Suitelet emitiria o que está no BANCO — emitir uma versão que ninguém está vendo é o tipo
     * de surpresa que custa um número.
     *
     * `clientScriptModulePath` e não registro de script: um objeto SDF a menos.
     */
    function injetarBotoes(scriptContext) {
      if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
      if (scriptContext.type !== scriptContext.UserEventType.VIEW) return;
      if (TIPOS.indexOf(scriptContext.newRecord.type) === -1) return;

      var id = scriptContext.newRecord.id;
      if (!id) return;

      var form = scriptContext.form;
      form.clientScriptModulePath = './fp_cs_transacao.js';

      botao(form, 'custpage_fp_emitir', 'Emitir ' + tipoDeclarado(scriptContext.newRecord),
        scriptContext, id, 'emitir', true);

      // Consultar só faz sentido depois de transmitida, e é o que resolve nota em PROCESSANDO.
      var campoStatus = fpFields.id('DOC_STATUS');
      var status = campoStatus
        ? String(scriptContext.newRecord.getValue({ fieldId: campoStatus }) || '')
        : '';

      if (status) {
        botao(form, 'custpage_fp_consultar', 'Consultar SEFAZ', scriptContext, id, 'consultar', false);
      }

      linkDoXml(form, scriptContext, id);
    }

    /**
     * LINK, NÃO BOTÃO.
     *
     * Botão é para ação; baixar um arquivo é navegação, e um terceiro botão na barra só engorda a
     * fileira. Como campo URL ele fica na subaba fiscal, ao lado da chave e do protocolo — que é
     * onde alguém procura o XML.
     *
     * Exige chave: é por ela que a plataforma encontra o documento.
     */
    function linkDoXml(form, scriptContext, id) {
      var campoChave = fpFields.id('DOC_CHAVE');
      var chave = campoChave
        ? String(scriptContext.newRecord.getValue({ fieldId: campoChave }) || '')
        : '';
      if (!chave) return;

      var campo = form.addField({
        id: 'custpage_fp_xml',
        type: serverWidget.FieldType.URL,
        label: 'XML',
        container: SUBABA
      });

      campo.linkText = 'Baixar XML';
      campo.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
      campo.defaultValue = endereco(scriptContext, id, 'xml');
    }

    /**
     * O CÓDIGO declarado, tal como está na lista — `NFE`, `CTE`, `MDFE`.
     *
     * É o vocabulário do catálogo da plataforma, e é ele que aparece no botão. Já esteve chumbado
     * em "Emitir NF-e", e o bundle emite cinco tipos: o botão anunciava NF-e numa transação
     * marcada como CT-e. Já esteve com a descrição junto no valor da lista, e isso quebrava o
     * payload — o que sai tem de ser exatamente o que o catálogo conhece.
     */
    function tipoDeclarado(novoRegistro) {
      var campo = fpFields.id('TIPODOC');
      if (!campo) return 'documento fiscal';
      return String(novoRegistro.getText({ fieldId: campo }) || '').trim() || 'documento fiscal';
    }

    /**
     * `consome` diz ao cliente se ele pergunta antes. Quem sabe disso é aqui, não o cliente: a
     * diferença entre gastar número e não gastar é do endpoint, não da tela.
     */
    function botao(form, idBotao, rotulo, scriptContext, id, acao, consome) {
      form.addButton({
        id: idBotao,
        label: rotulo,
        functionName: "acionar('" + endereco(scriptContext, id, acao) + "','" + rotulo + "'," +
          (consome ? 'true' : 'false') + ")"
      });
    }

    function endereco(scriptContext, id, acao) {
      return url.resolveScript({
        scriptId: 'customscript_fp_sl_emissao',
        deploymentId: 'customdeploy_fp_sl_emissao',
        params: { tipo: scriptContext.newRecord.type, id: id, acao: acao }
      });
    }

    return { beforeLoad: beforeLoad };
  });
