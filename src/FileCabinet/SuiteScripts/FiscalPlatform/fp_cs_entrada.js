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
 * Objeto próprio, `customscript_fp_cs_entrada`, implantado nas compras. O servidor repete a validação
 * no `beforeSubmit` do `fp_ue_simular` e recusa o save.
 */
define(['./fp_fields', './fp_chave'], function (fpFields, fpChave) {

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

  /**
   * `alert` e não `N/ui/message`: a mensagem aparece no topo da página, e quem salva pelo botão de
   * baixo não a vê. `alert` é síncrono, que é o que o `saveRecord` precisa para devolver false.
   */
  function saveRecord(ctx) {
    var r = fpChave.validar(ctx.currentRecord);
    if (!r.aplica) return true;
    if (!r.podeSalvar) {
      alert('[CHAVE DE ACESSO] Registro NÃO pode ser salvo\n\n' + r.erros.concat(r.avisos).join('\n'));
      return false;
    }
    if (r.avisos.length) alert('[CHAVE DE ACESSO] Validações\n\n' + r.avisos.join('\n'));
    return true;
  }

  return { fieldChanged: fieldChanged, saveRecord: saveRecord };
});
