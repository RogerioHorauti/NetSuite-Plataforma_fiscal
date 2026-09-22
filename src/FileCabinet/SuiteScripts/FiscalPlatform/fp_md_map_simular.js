/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([],
    
    () => {

        const montar = (newRecord) => 
        {
            let obj = {}
             
                obj["cnpjEmpresa"] = "10664687000113"
                obj["idExterno"] = "NF309-COMODATO-FLEX-V3"
                obj["naturezaOperacaoId"] = "REMESSA_COMODATO"
                obj["indFinal"] = "1"
                obj["dataEmissao"] = "2026-09-03"
                obj["tipoDocumento"] = "NFE"
                obj["serie"] = "2"
                obj["infAdicContrib"] = "SAIDAS DE MERCADORIA DE USO E CONSUMO, A TITULO DE COMODATO - NAO INCIDENCIA DE ICMS ART. 7o, IX, DO RICMS-SP"
                obj["indPres"] = "9"

                obj["destinatario"] = {}
                obj["destinatario"]["ie"] = "669483743111"
                obj["destinatario"]["uf"] = "SP"
                obj["destinatario"]["cep"] = "18087170"
                obj["destinatario"]["nome"] = "FLEXTRONICS INTERNATIONAL TECNOLOGIA LTDA."
                obj["destinatario"]["pais"] = "1058"
                obj["destinatario"]["email"] = "flex@flex.com"
                obj["destinatario"]["bairro"] = "Iporanga"
                obj["destinatario"]["numero"] = "6315"
                obj["destinatario"]["cnpjCpf"] = "74404229000551"
                obj["destinatario"]["indIeDest"] = 1
                obj["destinatario"]["municipio"] = "Sorocaba"
                obj["destinatario"]["codigoIbge"] = "3552205"
                obj["destinatario"]["logradouro"] = "Avenida Liberdade"
                obj["destinatario"]["complemento"] = "Bloco 1, Predios 09, 10, 11 e 12"
                
                obj["pagamento"] = []
                let objpag = {}
                    objpag["forma"] = "90"
                    objpag["valor"] = 0
                obj["pagamento"].push(objpag)
                    
                    
                obj["transporte"] = {}
                obj["transporte"]["modFrete"] = "3"

                obj["transporte"]["volumes"] = []
                let objvol = {}
                    objvol["especie"] = "VOLUME"
                    objvol["pesoBruto"] = 150
                    objvol["quantidade"] = 1
                    objvol["pesoLiquido"] = 150
                    obj["transporte"]["volumes"].push(objvol)
                
                obj["linhas"] = []
                let objitem = {}
                    objitem["ncm"] = "84233011"
                    objitem["unidade"] = "UN"
                    objitem["descricao"] = "DOSADOR PARA RESINA PU MODELO DRPU - E002/GA"
                    objitem["cfopCodigo"] = "5908"
                    objitem["numeroItem"] = 1
                    objitem["quantidade"] = 1
                    objitem["codigoBarras"] = "SEM GTIN"
                    objitem["valorProduto"] = 115000
                    objitem["codigoProduto"] = "000926"
                    objitem["origemProduto"] = "0"
                obj["linhas"].push(objitem)   

            return obj
        }

        const aplicar = (newRecord, json) => 
        {
            log.debug('json', json)
            removeImpostos(newRecord)

            // Índice CORRIDO do sublist, e não o índice do imposto dentro da linha.
            // Usar `i1` fazia a linha 2 da nota reescrever as posições 0..n que a linha 1 já tinha
            // ocupado: nota de 1 item passava, nota de 2 itens perdia os impostos do primeiro em
            // silêncio — sem erro, sem log, com o total certo na tela.
            let linhaSublist = 0

            json.linhas.map(function (e, i) 
            {
                e.impostos.map(function (e1, i1) 
                {
                    const linha = linhaSublist++

                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_numerolinha_imp',
                        value: i+1,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_taxcodigo_imp',
                        value: e1.taxCodigo,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_cst_imp',
                        value: e1.cst,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_cclasstrib_imp',
                        value: e1.cclasstrib,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_base_calculo_imp',
                        value: e1.baseCalculo,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_reducaobase_imp',
                        value: e1.reducaoBase,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_aliquota_imp',
                        value: e1.aliquota,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_valor_imp',
                        value: e1.valor,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_naturezacontabil_imp',
                        value: e1.naturezaContabil,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_compoetotalnf_imp',
                        value: e1.compoeTotalNf,
                        line: linha
                    })

                    // O CONTRATO NOVO — a plataforma decide a perna do tributo, e o ERP para de
                    // rederivar o sentido cruzando natureza com entradaSaida
                    // (fiscal-platform: sentido-do-lancamento.ts).
                    // Gravados como REFLEXO. `perna` vazia nao e falta de dado: e a plataforma
                    // dizendo que NAO decide o caso, e a razao e o que explica isso.
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_perna_imp',
                        value: e1.sentidoDaPernaFixa || '',
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_geralancamento_imp',
                        value: e1.geraLancamento === true,
                        line: linha
                    })
                    newRecord.setSublistValue({
                        sublistId: 'recmachcustrecord_fp_transacao_imp',
                        fieldId: 'custrecord_fp_razaoperna_imp',
                        value: e1.razaoDaPerna || '',
                        line: linha
                    })
                })
            })

            return {resumo: ''}
        }

        function removeImpostos(transactionLoad) {
            var _numLines = transactionLoad.getLineCount({ sublistId: 'recmachcustrecord_fp_transacao_imp' });
            for (var int = 0; int < _numLines; int++) {
                transactionLoad.removeLine({ sublistId: 'recmachcustrecord_fp_transacao_imp', line: 0 });
            }
        }

        return {montar, aplicar}

    });