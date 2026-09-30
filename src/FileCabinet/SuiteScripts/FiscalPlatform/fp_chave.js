/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * VALIDADOR DA CHAVE DE ACESSO NA ENTRADA — servidor e cliente.
 *
 * Portado do `AVLR_AccessKeyValidation_MD` (ns-br/AvataxV3, Nafis Costa & Rogerio Horauti), com os
 * campos do bundle no lugar dos da Avalara:
 *
 *   chave                 custbody_enl_accesskey          → DOC_CHAVE  (custbody_fp_chave)
 *   modelo do tipo        custrecord_enl_fdt_model        → customrecord_fp_tipodoc.MODELO
 *   data do documento     custbody_enl_fiscaldocdate      → trandate (não há data do documento própria)
 *   CNPJ do fornecedor    custentity_enl_cnpjcpf          → cliente.CNPJ_CPF (custentity_fp_cnpj_cpf)
 *   CNPJ da filial        subsidiary.taxregistrationnumber → location.CNPJ (custrecord_fp_cnpj_filial)
 *   série / número        custbody_enl_fiscaldoc*          → DOC_SERIE / DOC_NUMERO
 *
 * QUANDO VALIDA: tipo de documento de TERCEIRO com modelo (NF-e, CT-e de terceiro). Aí a chave é
 * obrigatória. Documento próprio (a chave é o retorno da emissão) e NFS-e (sem chave de 44) não.
 * O "fornecedor internacional" do original não precisa de regra: importação não tem chave de
 * fornecedor, e o tipo dela não é de terceiro com modelo.
 *
 *   BLOQUEIA  44 dígitos · DV módulo 11 · modelo da chave × do tipo · mês/ano da chave × trandate ·
 *             outra vendor bill com a mesma chave
 *   AVISA     CNPJ do emitente ≠ fornecedor e ≠ nossa filial (o original também só avisava)
 *
 * UMA consulta para tudo (tipo, CNPJ do fornecedor, CNPJ da filial, duplicidade), por `UNION ALL`
 * — medida na conta. É a regra do bundle para lista e cadastro: junta, busca uma vez, preenche.
 */
define(['N/query', './fp_fields'], function (query, fpFields) {

  function digitos(v) { return String(v === null || v === undefined ? '' : v).replace(/\D/g, ''); }

  /** DV módulo 11, pesos 2..9 da direita para a esquerda; resto 0 ou 1 → 0. */
  function dv(chave43) {
    var soma = 0, peso = 2;
    for (var i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43.charAt(i)) * peso; peso = peso === 9 ? 2 : peso + 1; }
    var resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  function dvValido(chave) {
    var c = digitos(chave);
    return c.length === 44 && String(dv(c.slice(0, 43))) === c.charAt(43);
  }

  /** As partes da chave: cUF, AAMM, CNPJ do emitente, modelo, série, número, tpEmis, cNF, DV. */
  function dadosDaChave(chave) {
    var c = digitos(chave);
    return { uf: c.slice(0, 2), ano: c.slice(2, 4), mes: c.slice(4, 6), cnpj: c.slice(6, 20), modelo: c.slice(20, 22),
      serie: Number(c.slice(22, 25)), numero: Number(c.slice(25, 34)), tpEmis: c.slice(34, 35), cNF: c.slice(35, 43), dv: c.slice(43, 44) };
  }

  /**
   * Valida a chave da compra. `rec` é o registro (servidor) ou o `currentRecord` (cliente).
   * Devolve `{ aplica, podeSalvar, erros[], avisos[], serie, numero }`.
   */
  function validar(rec) {
    var r = { aplica: false, podeSalvar: true, erros: [], avisos: [], serie: null, numero: null };
    var campoChave = fpFields.id('DOC_CHAVE'), campoTipo = fpFields.id('TIPODOC');
    var tipoId = campoTipo && rec.getValue({ fieldId: campoTipo });
    if (!tipoId) return r;

    var chave = digitos(campoChave && rec.getValue({ fieldId: campoChave }));
    var entity = rec.getValue({ fieldId: fpFields.padrao('ENTITY') });
    var location = rec.getValue({ fieldId: fpFields.padrao('LOCATION') });
    var b = buscar(tipoId, entity, location, chave, rec.id);

    if (b.emissaoPropria || !b.modelo) return r;   // documento próprio, ou sem chave de 44
    r.aplica = true;

    if (!chave) { r.erros.push('[CHAVE] obrigatória para ' + b.nome + '.'); r.podeSalvar = false; return r; }
    if (chave.length !== 44) { r.erros.push('[CHAVE] deve conter 44 dígitos (tem ' + chave.length + ').'); r.podeSalvar = false; return r; }
    if (!dvValido(chave)) { r.erros.push('[CHAVE] dígito verificador inconsistente.'); r.podeSalvar = false; return r; }

    var d = dadosDaChave(chave);
    r.serie = d.serie; r.numero = d.numero;

    if (d.modelo !== b.modelo) {
      r.erros.push('[MODELO] ' + b.nome + ' é modelo ' + b.modelo + ', a chave é modelo ' + d.modelo + '.');
    }

    var data = rec.getValue({ fieldId: fpFields.padrao('TRANDATE') });
    if (!data) {
      r.erros.push('[DATA DO DOCUMENTO] não informada.');
    } else {
      if (typeof data === 'string') data = new Date(data);
      var mmaa = ('0' + (data.getMonth() + 1)).slice(-2) + '/' + data.getFullYear();
      var daChave = d.mes + '/20' + d.ano;
      if (mmaa !== daChave) r.erros.push('[DATA DO DOCUMENTO] ' + mmaa + ', a chave é de ' + daChave + '.');
    }

    if (b.duplicadas.length) r.erros.push('[CHAVE] lançamento em duplicidade: ' + b.duplicadas.join(', ') + '.');

    // O original também só avisava: nota emitida pela própria filial (devolução, retorno) é legítima.
    if (d.cnpj !== b.cnpjFornecedor && d.cnpj !== b.cnpjFilial) {
      r.avisos.push('[CNPJ DO EMITENTE] a chave é de ' + d.cnpj + '; o fornecedor tem ' + (b.cnpjFornecedor || '(sem CNPJ no cadastro)') + '.');
    }

    r.podeSalvar = r.erros.length === 0;
    return r;
  }

  /** Tipo, CNPJ do fornecedor, CNPJ da filial e duplicidade — UMA consulta, `UNION ALL`. */
  function buscar(tipoId, entity, location, chave, idAtual) {
    var tabTipo = fpFields.registro('TIPODOC');
    var cCod = fpFields.idTipoDoc('CODIGO'), cEmi = fpFields.idTipoDoc('EMISSAO_PROPRIA'), cMod = fpFields.idTipoDoc('MODELO');
    var cCnpjForn = fpFields.idCliente('CNPJ_CPF'), cCnpjFil = fpFields.idLocation('CNPJ'), cChave = fpFields.id('DOC_CHAVE');
    var partes = ["SELECT 'TIPO' AS g, name || '|' || NVL(" + cCod + ", '') || '|' || " + cEmi + " || '|' || NVL(" + cMod + ", '') AS txt FROM " + tabTipo + ' WHERE id = ?'];
    var params = [tipoId];
    if (entity && cCnpjForn) { partes.push("SELECT 'FORN' AS g, " + cCnpjForn + ' AS txt FROM vendor WHERE id = ?'); params.push(entity); }
    if (location && cCnpjFil) { partes.push("SELECT 'FILIAL' AS g, " + cCnpjFil + ' AS txt FROM location WHERE id = ?'); params.push(location); }
    if (chave.length === 44 && cChave) {
      partes.push("SELECT 'DUP' AS g, tranid AS txt FROM transaction WHERE type = 'VendBill' AND " + cChave + ' = ?' + (idAtual ? ' AND id <> ?' : ''));
      params.push(chave); if (idAtual) params.push(idAtual);
    }
    var linhas = query.runSuiteQL({ query: partes.join(' UNION ALL '), params: params }).asMappedResults();
    var b = { nome: '', codigo: '', emissaoPropria: false, modelo: '', cnpjFornecedor: '', cnpjFilial: '', duplicadas: [] };
    for (var i = 0; i < linhas.length; i++) {
      var g = linhas[i].g, t = linhas[i].txt === null || linhas[i].txt === undefined ? '' : String(linhas[i].txt);
      if (g === 'TIPO') { var p = t.split('|'); b.nome = p[0]; b.codigo = p[1]; b.emissaoPropria = p[2] === 'T'; b.modelo = p[3] || ''; }
      else if (g === 'FORN') b.cnpjFornecedor = digitos(t);
      else if (g === 'FILIAL') b.cnpjFilial = digitos(t);
      else if (g === 'DUP') b.duplicadas.push(t);
    }
    return b;
  }

  return { digitos: digitos, dvValido: dvValido, dadosDaChave: dadosDaChave, validar: validar };
});
