/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 *
 * O CLIQUE DO BOTÃO DE EMISSÃO. Só isso.
 *
 * Não tem `pageInit`, não tem `fieldChanged`, não valida nada: abrir uma tela é tudo o que ele
 * faz. A decisão de emitir é do Suitelet, que mostra o que vai ser emitido e só age no POST.
 *
 * ── SEM REGISTRO DE SCRIPT ─────────────────────────────────────────────────────────────────────
 *
 * Este arquivo NÃO tem `customscript_*.xml`. Ele é anexado ao formulário pelo
 * `form.clientScriptModulePath` do `beforeLoad`, e isso basta para o botão funcionar — um objeto
 * SDF a menos, e um deployment a menos para alguém reapontar por engano.
 */
define([], function () {

  /**
   * `window.open` e não `window.location`: a transação continua aberta atrás.
   *
   * Emissão que falha é o caso comum no começo — cadastro incompleto, certificado, SEFAZ fora —
   * e perder a transação de vista a cada tentativa transforma corrigir um CNPJ em três navegações.
   */
  function abrirEmissao(url) {
    window.open(url, '_blank');
  }

  return {
    pageInit: function () {},
    abrirEmissao: abrirEmissao
  };
});
