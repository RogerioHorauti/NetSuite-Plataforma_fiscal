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
      "_grupo_documento": "identidade do documento fiscal devolvida pelo motor",
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
  
      "_grupo_transporte": "",
      "FRETE_MODALIDADE": "custbody_fp_frete_modalidade"
  
    },
  
    "linha": {
      "LINHA_NATUREZA": "custcol_fp_natureza",
      "LINHA_CFOP": "custcol_fp_cfop",
      "LINHA_NUMERO_ITEM": "custcol_fp_numero_item"
    },
  
    "item": {
      "ITEM_NCM": "custitem_fp_ncm",
      "ITEM_CEST": "custitem_fp_cest",
      "ITEM_ORIGEM": "custitem_fp_origem",
      "ITEM_SERVICO_LC116": "custitem_fp_servico_lc116",
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
      "REGIME_TRIB": "custentity_fp_regime_trib"
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
      "PERFIL_COMPAT": "custrecord_fp_perfil_compat",
      "CONTA_IMPOSTO_NATIVO": "custrecord_fp_conta_imposto_nativo",
      "CONTA_ESTORNO_CONTRA": "custrecord_fp_conta_estorno_contra"
    },

    "location": {
      "_nota": "Campos FP na LOCATION (branch do FiscalPlatform).",
      "CNPJ": "custrecord_fp_cnpj_filial",
      "SERIE": "custrecord_fp_serie_filial"
    },

    "log": {
      "_nota": "Campos de customrecord_fp_log, a trilha de chamada do transporte.",
      "ENDPOINT": "custrecord_fp_log_endpoint",
      "METODO": "custrecord_fp_log_metodo",
      "DURACAO": "custrecord_fp_log_duracao",
      "HTTP": "custrecord_fp_log_http",
      "PAYLOAD": "custrecord_fp_log_payload",
      "RESPOSTA": "custrecord_fp_log_resposta",
      "CORRID": "custrecord_fp_log_corrid",
      "TRANSACAO": "custrecord_fp_log_transaction"
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
      "PAIS": "customrecord_fp_pais",
      "DOC": "customrecord_fp_doc",
      "LOG": "customrecord_fp_log"
    },
  
    "valores": {
      "_nota": [
        "Quase todos os campos do perfil original sao Free-Form Text, e o valor canonico e gravado",
        "como esta. Perfil que aponta para List/Record de outro bundle TEM de preencher esta secao -",
        "campo certo com valor nosso num List/Record e falha silenciosa.",
        "",
        "EXCECAO NOSSA, e a mesma armadilha do lado de casa: TIPODOC e custbody_fp_tipodoc, que e",
        "SELECT para customlist_fp_tipodoc. Campo SELECT devolve o INTERNAL ID do valor no getValue,",
        "nao o texto. O mapeador tem de usar getText({fieldId}) para obter o codigo (NFE, NFCE, ...)",
        "que o EmitirNotaDto espera - ou fazer o de-para pelo abbreviation. Ler o internal id e",
        "manda-lo como tipoDocumento faria o motor receber algo como \"7\" e recusar."
      ]
    },
  
    "somenteLeitura": [],
  
    "naoMapeado": []
  };
});
