/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 *
 * A CHAVE DE ACESSO NA TELA DA COMPRA — portado do `AVLR_AccessKeyValidation_CS` (ns-br/AvataxV3).
 *
 *   ao digitar a chave  → só dígitos; chave válida preenche série e número (DOC_SERIE / DOC_NUMERO)
 *   ao salvar           → `fp_chave.validar`: erro mostra a mensagem e NÃO salva; aviso mostra e salva
 *
 * A regra mora no `fp_chave`, que o servidor também usa — o cliente só pinta e bloqueia.
 * Anexado por `form.clientScriptModulePath` no `beforeLoad` do `fp_ue_simular`, só em compra.
 */
define(['N/ui/message', './fp_fields', './fp_chave'], function (message, fpFields, fpChave) {

  function fieldChanged(ctx) {
    var campoChave = fpFields.id('DOC_CHAVE');
    if (ctx.fieldId !== campoChave) return;
    var rec = ctx.currentRecord;
    var bruta = String(rec.getValue({ fieldId: campoChave }) || '');
    var chave = fpChave.digitos(bruta);
    if (chave !== bruta) rec.setValue({ fieldId: campoChave, value: chave, ignoreFieldChange: true });
    if (!fpChave.dvValido(chave)) return;
    var d = fpChave.dadosDaChave(chave);
    var cSerie = fpFields.id('DOC_SERIE'), cNumero = fpFields.id('DOC_NUMERO');
    if (cSerie) rec.setValue({ fieldId: cSerie, value: String(d.serie), ignoreFieldChange: true });
    if (cNumero) rec.setValue({ fieldId: cNumero, value: d.numero, ignoreFieldChange: true });
  }

  function saveRecord(ctx) {
    var r = fpChave.validar(ctx.currentRecord);
    if (!r.aplica) return true;
    if (!r.podeSalvar) {
      message.create({ type: message.Type.ERROR, title: '[CHAVE DE ACESSO] Registro NÃO pode ser salvo',
        message: r.erros.concat(r.avisos).join('<br>'), duration: 30000 }).show();
      return false;
    }
    if (r.avisos.length) {
      message.create({ type: message.Type.WARNING, title: '[CHAVE DE ACESSO] Validações',
        message: r.avisos.join('<br>'), duration: 30000 }).show();
    }
    return true;
  }

  return { fieldChanged: fieldChanged, saveRecord: saveRecord };
});
