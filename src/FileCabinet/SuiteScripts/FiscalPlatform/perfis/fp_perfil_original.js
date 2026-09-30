/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * PERFIL DE COMPATIBILIDADE — MÓDULO, não arquivo de dados.
 *
 * Era `.json` carregado com `file.load`. Virou módulo AMD por três razões, e a terceira
 * é a que mandou:
 *   1. `file.load` custa ida ao File Cabinet a cada resolução de perfil;
 *   2. o `N/cache` que existia só para amortizar esse custo pôde ser removido;
 *   3. **`N/file` e `N/cache` não existem em Client Script** — enquanto o perfil fosse
 *      arquivo, a camada de compatibilidade era inutilizável no cliente, e todo client
 *      script do bundle era obrigado a chumbar scriptid.
 *
 * O conteúdo é o mesmo de antes, sem uma vírgula alterada.
 */
define([], function () {
  return {
    "perfil": "original",
    "descricao": "Instalação nossa. É o FALLBACK: usado quando nenhum SuiteApp fiscal conhecido é detectado, e usado por chave sempre que o perfil ativo não mapeia aquela chave (overlay parcial).",
  
    "_leia": [
      "ESTE ARQUIVO É O CATÁLOGO CANÔNICO DE NOMES LÓGICOS. Todo nome lógico do bundle nasce aqui.",
      "Um perfil de compatibilidade (fp_perfil_oracle_ei.json etc.) é um OVERLAY sobre este: ele",
      "redireciona as chaves que o SuiteApp instalado já tem, e cala nas que não tem — as caladas",
      "resolvem para o id daqui. Ver o docblock de fp_fields.js.",
      "",
      "CAMPO NATIVO DO NETSUITE NÃO ENTRA AQUI. tranid, externalid, subsidiary, location, entity,",
      "memo, status, trandate ficam em fp_fields.NATIVOS, fora de perfil — id nativo não muda por",
      "bundle instalado, e deixá-lo configurável só criaria a chance de alguém reapontá-lo."
    ],
  
    "deteccao": {
      "bundleIds": [],
      "suiteAppIds": [],
      "assinatura": null,
      "_nota": "O original não tem assinatura: ele é o que sobra quando nenhuma outra casa."
    },
  
    "transacao": {
      "_grupo_documento": [
        "Identidade do documento fiscal DEVOLVIDA PELO MOTOR.",
        "",
        "⚠ O PREFIXO `DOC_` E CONTRATO, nao estilo. `fp_ue_simular.limparNaCopia` limpa TODA chave",
        "desta secao que comece com `DOC_` (mais `CORRID`), sem lista chumbada -- entao campo novo",
        "de resultado nasce aqui com o prefixo e passa a ser limpo na copia sozinho.",
        "",
        "Campo que o ERP DECLARA nao leva o prefixo e NAO e limpo: natureza, tipo de documento e",
        "frete sao decisao de quem abriu a transacao, e a copia os herda de proposito."
      ],
      "DOC_CHAVE": "custbody_fp_chave",
      "DOC_NUMERO": "custbody_fp_numero",
      "DOC_SERIE": "custbody_fp_serie",
      "DOC_STATUS": "custbody_fp_status",
      "DOC_CSTAT": "custbody_fp_cstat",
      "DOC_XMOTIVO": "custbody_fp_xmotivo",
      "DOC_PROTOCOLO": "custbody_fp_protocolo",
      "DOC_IDEXTERNO": "custbody_fp_idexterno",
      "DOC_XML": "custbody_fp_xml",
      "DOC_DANFE": "custbody_fp_danfe",
      
      "_grupo_declaracao": "o que o ERP DECLARA - o dado que so ele tem. Aba PRINCIPAL, depois do memo (fp_form.js).",
      "TIPODOC": "custbody_fp_tipodoc",
      "NATUREZA": "custbody_fp_natureza",
  
      "_grupo_infra": "mecanismo de mensagem síncrona — ver fp_msg.js",
      "CORRID": "custbody_fp_corrid",
  
      "_grupo_transporte": [
        "modFrete NAO se deriva de campo nativo: shipmethod e carrier sao logistica internacional",
        "e nao dizem de quem e a RESPONSABILIDADE pelo frete, que e o que o grupo X declara."
      ],
      "FRETE_MODALIDADE": "custbody_fp_frete_modalidade",
      "TRANSPORTADORA": "custbody_fp_transportadora",
      "VEICULO_PLACA": "custbody_fp_veiculo_placa",
      "VEICULO_UF": "custbody_fp_veiculo_uf",
      "VEICULO_RNTC": "custbody_fp_veiculo_rntc",
      "VAGAO": "custbody_fp_vagao",
      "BALSA": "custbody_fp_balsa",
      "RET_VSERV": "custbody_fp_ret_vserv",
      "RET_VBCRET": "custbody_fp_ret_vbcret",
      "RET_PICMSRET": "custbody_fp_ret_picmsret",
      "RET_VICMSRET": "custbody_fp_ret_vicmsret",
      "RET_CFOP": "custbody_fp_ret_cfop",
      "RET_CMUNFG": "custbody_fp_ret_cmunfg",

      "_grupo_prestacao": [
        "ONDE o servico foi prestado, na subaba Local da Prestacao. E de CORPO e nao de linha: o",
        "DTO admite por linha, mas uma nota de servico e de UM local -- a NFS-e e municipal.",
        "",
        "O LOCAL e um ENDERECO DE CADASTRO, nao texto: escolhe-se a entidade e uma entrada do",
        "address book dela. Municipio, UF e pais saem do endereco, e a plataforma resolve o IBGE",
        "por nome + UF. Digitar codigo IBGE em cada nota era onde o erro nascia.",
        "",
        "PAIS_RESULTADO e CONSUMO_EXTERIOR NAO saem de endereco nenhum: sao DECLARACAO de quem",
        "prestou, e testes diferentes -- o resultado e o do ISS (LC 116/2003, art. 2o, p.u.), o",
        "consumo e o da LC 214/2025, art. 80. Um nao dispensa o outro, e o DTO diz que o resultado",
        "NAO se deriva do endereco do tomador."
      ],
      "ENTIDADE_PRESTACAO": "custbody_fp_entidade_prestacao",
      "LOCAL_PRESTACAO": "custbody_fp_local_prestacao",
      "PAIS_RESULTADO": "custbody_fp_pais_resultado",
      "CONSUMO_EXTERIOR": "custbody_fp_consumo_exterior",

      "_grupo_adicionais": [
        "Campos do EmitirNotaDto que NAO existem no SimulacaoNotaInputDto -- so vao na emissao.",
        "Nenhum leva prefixo DOC_ porque sao DECLARACAO do ERP, nao retorno do motor: a copia",
        "os herda de proposito (ver limparNaCopia).",
        "",
        "indFinal FICA DE FORA, e nao e esquecimento: o motor o deriva da natureza",
        "(consumidorFinal) e o DTO diz que NULL = derivar, valor explicito = override. Mandar 0",
        "por engano sobrepoe a derivacao e o indFinal e eixo do DIFAL -- o silencio viraria",
        "recolhimento a menor."
      ],
      "IND_PRES": "custbody_fp_ind_pres",
      "INFADIC_FISCO": "custbody_fp_infadic_fisco",
      "INFADIC_CONTRIB": "custbody_fp_infadic_contrib",
      "EXP_LOCAL": "custbody_fp_exp_local",
      "EXP_UF": "custbody_fp_exp_uf",
      "EXP_DESPACHO": "custbody_fp_exp_despacho",
      "CONT_VIA": "custbody_fp_cont_via",
      "CONT_JUSTIFICATIVA": "custbody_fp_cont_justificativa",

      "_grupo_datas": [
        "Datas que so o ERP sabe, e que vao TAMBEM no /simular (sao do SimulacaoNotaInputDto).",
        "DATA_SAIDA NAO e o shipdate nativo: aquele e a data PREVISTA e o NetSuite o preenche",
        "sozinho (na 2233, trandate + 2). O fato gerador do ICMS/IPI e a saida real."
      ],
      "DATA_SAIDA": "custbody_fp_data_saida",

      "_grupo_entrada": [
        "Na COMPRA, a chave da nota do FORNECEDOR vai no proprio DOC_CHAVE, que o beforeLoad abre",
        "para digitacao so na compra; a data de entrada tem campo proprio. Com a natureza, sao o",
        "corpo do POST /transacoes/reclassificar. A guarda 4 conta o DOC_CHAVE como mudanca na compra."
      ],
      "DATA_ENTRADA": "custbody_fp_data_entrada",
      "COMPETENCIA_ORIGINAL": "custbody_fp_competencia_original",
      "DATA_REAJUSTE": "custbody_fp_data_reajuste"
  
    },
  
    "linha": {
      "_nota": [
        "CAMPO DE LINHA e o que muda A CADA VENDA do mesmo produto. Atributo da mercadoria que se",
        "repete em toda nota e campo de ITEM -- ver a secao `item`. O DTO nao separa os dois: a",
        "SimulacaoLinhaDto mistura NCM (item) com quantidade (linha), e quem separa e este perfil.",
        "",
        "Errar o lado custa caro nos dois sentidos: NCM como campo de linha faz alguem redigitar",
        "a cada nota ate divergir; lote como campo de item faz todas as notas do produto sairem",
        "com o lote da ultima."
      ],
      "LINHA_NATUREZA": "custcol_fp_natureza",
      "LINHA_CFOP": "custcol_fp_cfop",
      "LINHA_NUMERO_ITEM": "custcol_fp_numero_item",
      "LINHA_INFO_ADICIONAL": "custcol_fp_info_adicional",
      "LINHA_CHAVE_REF": "custcol_fp_chave_ref",
      "LINHA_ITEM_REF": "custcol_fp_linha_ref",
      "LINHA_DOACAO": "custcol_fp_doacao",
      "LINHA_DEDUCAO_MATERIAL": "custcol_fp_deducao_material",
      "LINHA_VALOR_FRETE": "custcol_fp_valor_frete",
      "LINHA_VALOR_SEGURO": "custcol_fp_valor_seguro",
      "LINHA_VALOR_DESCONTO": "custcol_fp_valor_desconto",
      "LINHA_VALOR_OUTRAS": "custcol_fp_valor_outras",
      "LINHA_DESP_BASE_II": "custcol_fp_desp_base_ii",
      "LINHA_DESP_BASE_ICMS": "custcol_fp_desp_base_icms",
      "LINHA_CRED_ICMS_TRANSF": "custcol_fp_cred_icms_transf",
      "LINHA_QTD_TRIB": "custcol_fp_qtd_trib",
      "LINHA_VUNIT_TRIB": "custcol_fp_vunit_trib",
      "LINHA_HIPOTESE_ST": "custcol_fp_hipotese_st",
      "LINHA_BEM_USADO": "custcol_fp_bem_usado",
      "LINHA_CRED_ZFM": "custcol_fp_cred_zfm",
      "LINHA_DI": "custcol_fp_di",
      "LINHA_DI_ADICAO": "custcol_fp_di_adicao",
      "LINHA_DI_SEQ": "custcol_fp_di_seq",
      "LINHA_DI_FABRICANTE": "custcol_fp_di_fabricante",
      "LINHA_DI_DESCONTO": "custcol_fp_di_desconto"
    },
  
    "item": {
      "ITEM_NCM": "custitem_fp_ncm",
      "ITEM_CEST": "custitem_fp_cest",
      "ITEM_ORIGEM": "custitem_fp_origem",
      "ITEM_SERVICO_LC116": "custitem_fp_servico_lc116",
      "ITEM_TIPO": "custitem_fp_tipo_item",
      "ITEM_EX_TIPI": "custitem_fp_ex_tipi",
      "ITEM_UNID_TRIB": "custitem_fp_unid_trib",
      "ITEM_FATOR_CONV": "custitem_fp_fator_conv",
      "ITEM_NAT_RECEITA": "custitem_fp_nat_receita",
      "ITEM_SERVICO_MUNICIPAL": "custitem_fp_servico_municipal",
      "ITEM_DESDOBRAMENTO": "custitem_fp_desdobramento",
      "ITEM_NBS": "custitem_fp_nbs",
      "ITEM_NFCI": "custitem_fp_nfci",
      "ITEM_EAN_TRIB": "custitem_fp_ean_trib",
      "ITEM_CNAE": "custitem_fp_cnae",
      "_nota": [
        "NCM e CEST são CADASTRO, não régua: eles descrevem a mercadoria, não decidem tributo.",
        "O motor tem cadastro próprio de item (/api/v1/item); qual das duas pontas é a fonte é",
        "decisão de projeto ainda aberta — ver ARQUITETURA-COMPATIBILIDADE.md §7."
      ]
    },
  
    "cliente": {
      "_nota": [
        "Campos FP na ENTITY (customer e vendor). MEDIDO com o Rogerio: CNPJ/CPF, razao social,",
        "indicador de IE e regime do destinatario NAO existem nativos nesta conta -- o resto do",
        "destinatario (nome, email, fone, endereco) e standard e fica fora de perfil.",
        "",
        "IND_IE_DEST nao e detalhe de cadastro: o motor deriva dele o `destinatarioContribuinte`",
        "(1 e 2 -> true, 9 -> false), e e isso que decide DIFAL. Sem ele o motor nao sabe."
      ],
      "CNPJ_CPF": "custentity_fp_cnpj_cpf",
      "RAZAO_SOCIAL": "custentity_fp_razao_social",
      "IE": "custentity_fp_ie",
      "IND_IE_DEST": "custentity_fp_ind_ie_dest",
      "REGIME_TRIB": "custentity_fp_regime_trib",
      "QUALIFICACAO": "custentity_fp_qualificacao"
    },

    "pais": {
      "_nota": [
        "De-para ISO alpha-2 -> cPais do BACEN, em customrecord_fp_pais. Nao e regua fiscal: o",
        "BACEN publica os dois codigos e o bundle so traduz o que o NetSuite guarda no endereco",
        "para o que a NF-e leva na tag cPais. A plataforma NAO converte -- ela deriva 1058 quando",
        "a UF e brasileira e, para o exterior, o proprio mapa-divergencia.ts registra que exige",
        "a tabela do BACEN."
      ],
      "ISO": "custrecord_fp_pais_iso",
      "CPAIS": "custrecord_fp_pais_cpais"
    },

    "pagamento": {
      "_nota": [
        "Sublista customrecord_fp_pagamento (grupo YA, detPag repetivel). Cartao e dinheiro na",
        "MESMA nota sao duas linhas -- e por isso que nao cabe em campo de corpo.",
        "",
        "FORMA e VALOR sao obrigatorios no leiaute. DESCRICAO vira obrigatoria quando a forma e",
        "99 (Outros): sem ela a rejeicao e a 441. TPINTEGRA e obrigatorio quando a forma e cartao",
        "de credito (03) ou debito (04)."
      ],
      "SUBLIST": "recmachcustrecord_fp_pag_transacao",
      "TRANSACAO": "custrecord_fp_pag_transacao",
      "FORMA": "custrecord_fp_pag_forma",
      "VALOR": "custrecord_fp_pag_valor",
      "DESCRICAO": "custrecord_fp_pag_descricao",
      "IND_PAG": "custrecord_fp_pag_indpag",
      "TP_INTEGRA": "custrecord_fp_pag_tpintegra",
      "CNPJ_CREDENCIADORA": "custrecord_fp_pag_cnpj_cred",
      "TBAND": "custrecord_fp_pag_tband",
      "CAUT": "custrecord_fp_pag_caut"
    },

    "di": {
      "_nota": [
        "Declaracao de Importacao: registro MESTRE e avulso, nao sublista da transacao. A DI e",
        "documento da Receita e a mesma DI cobre varias notas -- e o desenho do",
        "customrecord_enl_importdeclaration da Avalara.",
        "",
        "⚠ QUEM APONTA E A LINHA, por LINHA_DI. Amarrar pelo numero do item quebra com DOIS ITENS",
        "IGUAIS na mesma nota (nada distingue um do outro) e quebra de novo quando alguem insere",
        "uma linha no meio e a numeracao anda.",
        "",
        "A ADICAO nao e registro: no leiaute cada item da nota corresponde a uma adicao, entao",
        "nAdicao, nSeqAdic, cFabricante e vDescDI sao COLUNAS DA LINHA."
      ],
      "REGISTRO": "customrecord_fp_di",
      "NDI": "custrecord_fp_di_ndi",
      "DDI": "custrecord_fp_di_ddi",
      "LOCAL_DESEMBARACO": "custrecord_fp_di_local",
      "UF_DESEMBARACO": "custrecord_fp_di_uf",
      "DATA_DESEMBARACO": "custrecord_fp_di_ddesemb",
      "VIA_TRANSPORTE": "custrecord_fp_di_via",
      "AFRMM": "custrecord_fp_di_afrmm",
      "TP_INTERMEDIO": "custrecord_fp_di_intermedio",
      "CNPJ_TERCEIRO": "custrecord_fp_di_cnpj_terceiro",
      "UF_TERCEIRO": "custrecord_fp_di_uf_terceiro",
      "EXPORTADOR": "custrecord_fp_di_exportador"
    },

    "reboque": {
      "_nota": "Sublista customrecord_fp_reboque, na subaba Transporte. Ate 5, omitidos em interestadual.",
      "SUBLIST": "recmachcustrecord_fp_reb_transacao",
      "TRANSACAO": "custrecord_fp_reb_transacao",
      "PLACA": "custrecord_fp_reb_placa",
      "UF": "custrecord_fp_reb_uf",
      "RNTC": "custrecord_fp_reb_rntc"
    },

    "volume": {
      "_nota": [
        "Sublista customrecord_fp_volume, na MESMA subaba dos reboques -- duas sublistas numa",
        "subaba viram ABAS dentro dela, que e como o bundle da Oracle organiza o transporte.",
        "LACRES e um campo com os lacres separados por virgula; o mapeador divide. No leiaute e",
        "lista repetivel, mas uma terceira sublista custaria mais do que o dado vale."
      ],
      "SUBLIST": "recmachcustrecord_fp_vol_transacao",
      "TRANSACAO": "custrecord_fp_vol_transacao",
      "QUANTIDADE": "custrecord_fp_vol_quantidade",
      "ESPECIE": "custrecord_fp_vol_especie",
      "MARCA": "custrecord_fp_vol_marca",
      "NUMERACAO": "custrecord_fp_vol_numeracao",
      "PESO_LIQUIDO": "custrecord_fp_vol_peso_liquido",
      "PESO_BRUTO": "custrecord_fp_vol_peso_bruto",
      "LACRES": "custrecord_fp_vol_lacres"
    },

    "endereco": {
      "_nota": "Campos no registro de ENDERECO (othercustomfield, rectype -289).",
      "END_NUMERO": "custrecord_fp_end_numero"
    },

    "impostos": {
      "_nota": [
        "Campos do sublist de impostos por linha, que e o REFLEXO do que o motor devolveu.",
        "O sublist aparece na transacao como recmach + o campo de vinculo, e por isso o",
        "SUBLIST tambem mora aqui: derivar o nome do sublist do nome do campo em codigo seria",
        "regra escondida."
      ],
      "SUBLIST": "recmachcustrecord_fp_transacao_imp",
      "TRANSACAO": "custrecord_fp_transacao_imp",
      "NUMERO_LINHA": "custrecord_fp_numerolinha_imp",
      "TAXCODIGO": "custrecord_fp_taxcodigo_imp",
      "CST": "custrecord_fp_cst_imp",
      "CCLASSTRIB": "custrecord_fp_cclasstrib_imp",
      "BASE_CALCULO": "custrecord_fp_base_calculo_imp",
      "REDUCAO_BASE": "custrecord_fp_reducaobase_imp",
      "ALIQUOTA": "custrecord_fp_aliquota_imp",
      "VALOR": "custrecord_fp_valor_imp",
      "NATUREZA_CONTABIL": "custrecord_fp_naturezacontabil_imp",
      "COMPOE_TOTAL": "custrecord_fp_compoetotalnf_imp",
      "PERNA": "custrecord_fp_perna_imp",
      "GERA_LANCAMENTO": "custrecord_fp_geralancamento_imp"
    },

    "classificador": {
      "_nota": "Chave e contas do classificador contabil, lidos pelo plug-in de GL.",
      "IMPOSTO": "custrecord_fp_imposto_cc",
      "NATUREZA": "custrecord_fp_natureza_cc",
      "PERNA": "custrecord_fp_perna_cc",
      "COMPOE_TOTAL": "custrecord_fp_compoe_total_cc",
      "CONTA_TRIBUTO": "custrecord_fp_conta_tributo_cc",
      "CONTRAPARTIDA_ORIGEM": "custrecord_fp_contrapartida_origem_cc",
      "CONTRAPARTIDA": "custrecord_fp_contrapartida_cc",
      "CODIGO_IMPOSTO": "custrecord_fp_codigo_impo"
    },

    "subsidiaria": {
      "_nota": "Campos FP na SUBSIDIARY (company do FiscalPlatform).",
      "API_BASEURL": "custrecord_fp_api_baseurl",
      "API_CLIENTID": "custrecord_fp_api_clientid",
      "API_SECRET": "custrecord_fp_api_secret",
      "CONTA_IMPOSTO_NATIVO": "custrecord_fp_conta_imposto_nativo",
      "CONTA_ESTORNO_CONTRA": "custrecord_fp_conta_estorno_contra"
    },

    "location": {
      "_nota": "Campos FP na LOCATION (branch do FiscalPlatform).",
      "CNPJ": "custrecord_fp_cnpj_filial",
      "SERIE": "custrecord_fp_serie_filial",
      "CNAE": "custrecord_fp_cnae"
    },

    "natureza_operacao": {
      "_nota": "Campos de customrecord_fp_natureza_operacao. O E/S daqui e a UNICA fonte de sentido do plug-in de GL.",
      "ENTRADA_SAIDA": "custrecord_fp_entrada_saida",
      "DESCRICAO": "custrecord_fp_descricao_no"
    },

    "registros": {
      "IMPOSTOS": "customrecord_fp_impostos",
      "IMPOSTO": "customrecord_fp_imposto",
      "CLASSIFICADOR": "customrecord_fp_classificador_contabil",
      "NATUREZA_OPERACAO": "customrecord_fp_natureza_operacao",
      "REBOQUE": "customrecord_fp_reboque",
      "VOLUME": "customrecord_fp_volume",
      "DI": "customrecord_fp_di",
      "PAGAMENTO": "customrecord_fp_pagamento",
      "PAIS": "customrecord_fp_pais",
      "_nota_listas": [
        "Listas das colunas SELECT da LINHA. No sublist `item` o getSublistValue devolve o ID do",
        "valor (\"1\"), e o getSublistText e evitado no mapeador (devolve undefined em parte dos",
        "contextos): o codigo sai do NOME, resolvido por SuiteQL nesta tabela. MEDIDO em 2026-09-30",
        "-- sem isto hipoteseStInterestadual e tpCredPresIbsZfm nunca chegavam ao payload."
      ],
      "LISTA_HIPOTESE_ST": "customlist_fp_hipotese_st",
      "LISTA_CRED_ZFM": "customlist_fp_cred_zfm",
      "_nota_listas_corpo": [
        "Listas dos campos SELECT de CORPO. MEDIDO em 2026-09-30: no beforeSubmit de registro criado",
        "por REST (e por script ou CSV), getText LANCA SSS_INVALID_API_USAGE -- 'You must use getValue",
        "to return the value set with setValue'. O nome sai por SuiteQL a partir do id do getValue."
      ],
      "LISTA_TIPODOC": "customlist_fp_tipodoc",
      "LISTA_IND_PRES": "customlist_fp_ind_pres",
      "LISTA_MOD_FRETE": "customlist_fp_mod_frete",
      "LISTA_CONT_VIA": "customlist_fp_cont_via",
      "LISTA_FORMA_PAGTO": "customlist_fp_forma_pagto",
      "LISTA_IND_PAG": "customlist_fp_ind_pag",
      "LISTA_TP_INTEGRA": "customlist_fp_tp_integra"
    },
  
    "valores": {
      "_nota": [
        "Quase todos os campos do perfil original sao Free-Form Text, e o valor canonico e gravado",
        "como esta. Perfil que aponta para List/Record de outro bundle TEM de preencher esta secao -",
        "campo certo com valor nosso num List/Record e falha silenciosa.",
        "",
        "EXCECAO NOSSA, e a mesma armadilha do lado de casa: TIPODOC e custbody_fp_tipodoc, que e",
        "SELECT para customlist_fp_tipodoc. Campo SELECT devolve o INTERNAL ID do valor no getValue,",
        "nao o texto. O mapeador busca o NOME pela lista (registros LISTA_*), numa consulta so -- NUNCA getText, que lanca no beforeSubmit de registro criado por REST -- para obter o codigo (NFE, NFCE, ...)",
        "que o EmitirNotaDto espera - ou fazer o de-para pelo abbreviation. Ler o internal id e",
        "manda-lo como tipoDocumento faria o motor receber algo como \"7\" e recusar."
      ]
    },
  
    "somenteLeitura": [],
  
    "naoMapeado": []
  };
});
