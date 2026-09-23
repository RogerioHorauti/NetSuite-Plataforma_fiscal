/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * MAPEADOR TRANSAÇÃO DO NETSUITE → `SimulacaoNotaInputDto`, e a volta.
 *
 * ── WHITELIST DOS DOIS LADOS, E ISSO NÃO É ESTILO ─────────────────────────────────────────────
 *
 * Campo que não for montado aqui NÃO CHEGA ao motor: vira `undefined`, não erro. E do outro lado
 * acontece o simétrico — o Nest roda `ValidationPipe` com `whitelist: true` e **sem**
 * `forbidNonWhitelisted` (`validation-pipe.config.ts:53-56`), então campo que o DTO não declara é
 * **descartado em silêncio**, sem aviso nenhum.
 *
 * ⚠ MEDIDO em `simulacao-nota-input.dto.ts:1564`: o DTO de simulação tem **dez** campos de topo —
 * `branchId`, `companyId`, `cnpjEmpresa`, `destinatario`, `naturezaOperacaoId`, `dataEmissao`,
 * `dataSaidaEntrada`, `competenciaOriginal`, `dataReajuste`, `linhas`. Só `linhas` é obrigatório.
 * `serie`, `tipoDocumento`, `indPres`, `indFinal`, `pagamento`, `transporte` e `infAdicContrib`
 * **não existem nele** — a versão anterior deste arquivo mandava os sete, e os sete eram jogados
 * fora sem que ninguém percebesse. `serie`, `tipoDocumento` e `idExterno` existem no
 * `EmitirNotaDto` (`emitir-nota.dto.ts:334-458`), que é outra chamada.
 *
 * ── A FILIAL É O CNPJ, NUNCA UUID ─────────────────────────────────────────────────────────────
 *
 * `cnpjEmpresa` com **14 dígitos limpos**. Medido no fonte da plataforma: o banco só aceita dígitos
 * (`chk_branches_cnpj_digitos`), o resolvedor normaliza os dois lados
 * (`resolver-filial-por-endereco.ts:127-132`), mas `tax-engine.resolveBranch:3497` exige
 * `length === 14` depois de limpar, e **nada completa zero à esquerda** — CNPJ com zero suprimido
 * não acha filial nenhuma.
 *
 * ── DE ONDE VEM CADA COISA, medido e não suposto ──────────────────────────────────────────────
 *
 * Records Browser (fonte autoritativa de scriptid) e `metadata-catalog` do REST, 2026-09-22/23:
 *
 *   payload              origem no NetSuite                    estado
 *   ───────────────────  ────────────────────────────────────  ─────────────────────────────────
 *   cnpjEmpresa          Location › custrecord_fp_cnpj_filial  criado por nós
 *   naturezaOperacaoId   custbody_fp_natureza (getText)        criado por nós
 *   dataEmissao          trandate                              NATIVO
 *   destinatario.cnpjCpf customer.vatregnumber "Tax Reg.Num."  NATIVO
 *   destinatario.nome    customer.companyname / entityid       NATIVO
 *   destinatario.uf/cep  subrecord de endereço da transação    NATIVO
 *   linhas[].*           sublist `item`                        NATIVO
 *   linhas[].cfopCodigo  custcol_fp_cfop                       ainda não existe na conta
 *   linhas[].ncm/cest    custitem_fp_ncm / _cest               ainda não existem na conta
 *
 * ⚠ O QUE ESTA CONTA NÃO TEM, e por isso não é enviado:
 *   · `inventoryItem` não tem campo customizado de NCM, CEST ou origem — só
 *     `custReturnVarianceAccount` e `customForm`. O perfil mapeia `ITEM_NCM` → `custitem_fp_ncm`,
 *     mas o campo não existe. A leitura é protegida e simplesmente omite.
 *   · `customer` não tem **nenhum** `custentity`.
 *   · O **número** do logradouro sai de `custrecord_fp_end_numero`, campo nosso no endereço
 *     (`rectype -289`): o NetSuite não o decompõe, ele vem grudado no `addr1`. **Bairro** sai do
 *     `addr3` (medido em `entityaddress`), e o **código IBGE não é
 *     enviado de propósito**: a plataforma o resolve a partir de município e UF, e duplicar essa
 *     régua aqui criaria uma segunda verdade.
 *
 * ── GOVERNANÇA ────────────────────────────────────────────────────────────────────────────────
 *
 * Isto roda no `beforeSubmit`, no caminho do save. Os itens são lidos em UMA busca para o conjunto
 * inteiro, não um `lookupFields` por linha: nota de 50 itens pagaria 50 idas ao banco por nada.
 */
define(['N/search', 'N/query', 'N/format', 'N/log', './fp_fields', './fp_client'],
  function (search, query, format, log, fpFields, fpClient) {

    // ─────────────────────────────────────────────────────────────────────────
    // montagem do payload
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Devolve o `SimulacaoNotaInputDto`, ou `null` quando falta identidade.
     *
     * `null` NÃO é erro: é transação que ainda não tem o que simular — sem linha de item, sem
     * location, ou com location sem CNPJ. Quem chama trata como "não simula agora" e deixa salvar.
     */
    function montar(newRecord) {
      var cnpj = cnpjDaFilial(newRecord);
      if (!cnpj) {
        log.debug('fp_md_map_simular',
          'sem CNPJ na location da transação — o motor não tem como achar a filial');
        return null;
      }

      // 14 DÍGITOS, NÃO MENOS. `tax-engine.resolveBranch:3497` exige exatamente 14 depois de
      // limpar, e nada do lado de lá completa zero à esquerda: CNPJ curto não acha filial e o
      // erro volta como "filial não encontrada", que aponta para o lugar errado.
      if (cnpj.length !== 14) {
        log.error('fp_md_map_simular',
          'CNPJ da filial com ' + cnpj.length + ' dígitos ("' + cnpj + '"), e o motor exige 14. ' +
          'Confira o campo CNPJ da Filial na Location — máscara truncada é a causa comum.');
        return null;
      }

      // Exatamente os campos do DTO, e nada além. Acrescentar aqui sem acrescentar lá
      // produz um campo que o Nest descarta calado.
      var payload = { cnpjEmpresa: cnpj };

      var natureza = naturezaDeclarada(newRecord);
      if (natureza) payload.naturezaOperacaoId = natureza;

      var data = dataIso(newRecord, fpFields.padrao('TRANDATE'));
      if (data) payload.dataEmissao = data;

      var dest = montarDestinatario(newRecord);
      if (dest) payload.destinatario = dest;

      // Atribuído aqui, e não no literal acima: `var` é hoisted, e lido antes desta linha o
      // campo sairia `undefined` — sem linha nenhuma, que é o único obrigatório do DTO.
      // Não há guarda de lista vazia: o NetSuite não salva transação sem linha.
      payload.linhas = montarLinhas(newRecord);

      return payload;
    }

    /**
     * Acrescenta ao payload o que só a EMISSÃO exige.
     *
     * Separado de propósito: `/simular` e `/emitir` compartilham o corpo, e a diferença é pequena e
     * obrigatória — `serie` e `tipoDocumento` são required no `EmitirNotaDto`.
     */
    function montarEmissao(newRecord) {
      var payload = montar(newRecord);
      if (!payload) return null;

      var serie = serieDaFilial(newRecord);
      var tipoDoc = valorTexto(newRecord, fpFields.id('TIPODOC'));

      if (!serie || !tipoDoc) {
        log.error('fp_md_map_simular.montarEmissao',
          'emissão exige série (na location) e tipo de documento (na transação). serie=' +
          (serie || '(vazia)') + ' tipoDocumento=' + (tipoDoc || '(vazio)'));
        return null;
      }

      payload.serie = serie;
      payload.tipoDocumento = tipoDoc;

      var idExterno = valorTexto(newRecord, fpFields.id('DOC_IDEXTERNO'));
      if (idExterno) payload.idExterno = idExterno;

      return payload;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // cabeçalho
    // ─────────────────────────────────────────────────────────────────────────

    /** CNPJ da location, 14 dígitos limpos. Cabeçalho primeiro; sem ele, a location da linha 1. */
    function cnpjDaFilial(newRecord) {
      var filial = filialDaTransacao(newRecord);
      return filial ? filial.cnpj : null;
    }

    function serieDaFilial(newRecord) {
      var filial = filialDaTransacao(newRecord);
      return filial && filial.serie ? String(filial.serie) : null;
    }

    function filialDaTransacao(newRecord) {
      var campoLoc = fpFields.padrao('LOCATION');
      var loc = newRecord.getValue({ fieldId: campoLoc });

      if (!loc) loc = valorLinha(newRecord, campoLoc, 0);
      if (!loc) return null;

      return fpClient.cnpjDaFilial(loc);
    }

    /**
     * O CÓDIGO da natureza, não o internal id.
     *
     * `custbody_fp_natureza` é List/Record para `customrecord_fp_natureza_operacao`, e `getValue`
     * devolve o internal id. O motor espera o código (`VENDA`, `REMESSA_COMODATO`), e `getText` dá
     * o nome do registro, que é onde o código foi carregado.
     */
    function naturezaDeclarada(newRecord) {
      var campo = fpFields.id('NATUREZA');
      if (!campo) return null;
      try {
        return newRecord.getText({ fieldId: campo }) || null;
      } catch (e) {
        return null;
      }
    }

    /**
     * Destinatário pelo que a transação e o cliente realmente têm.
     *
     * O endereço vem DA TRANSAÇÃO, não do cadastro: a nota sai para onde a transação diz, e uma
     * nota pode sobrescrever o endereço do cliente.
     */
    function montarDestinatario(newRecord) {
      var entity = newRecord.getValue({ fieldId: fpFields.padrao('ENTITY') });
      if (!entity) return null;

      var dest = {};

      // `vatregnumber` é o "Tax Reg. Number" do Records Browser — o único campo nativo que
      // carrega CNPJ nesta conta, que não tem custentity nenhum.
      var campoIe = fpFields.idCliente('IE');
      var campoInd = fpFields.idCliente('IND_IE_DEST');

      var colunas = ['companyname', 'entityid', 'vatregnumber', 'email', 'phone'];
      if (campoIe) colunas.push(campoIe);
      if (campoInd) colunas.push(campoInd);

      var cad = lookup('customer', entity, colunas);
      if (cad) {
        var nome = texto(cad.companyname) || texto(cad.entityid);
        if (nome) dest.nome = nome;
        var doc = digitos(cad.vatregnumber);
        if (doc) dest.cnpjCpf = doc;
        if (cad.email) dest.email = texto(cad.email);
        if (cad.phone) dest.fone = texto(cad.phone);

        if (campoIe) {
          var ie = digitos(cad[campoIe]);
          if (ie) dest.ie = ie;
        }

        // `indIeDest` vale mais que rótulo de cadastro: o motor deriva dele o
        // `destinatarioContribuinte` (1 e 2 → true, 9 → false), e é isso que decide o DIFAL.
        // `lookupFields` devolve List/Record como `[{value, text}]`; o código está no texto,
        // pelo mesmo desenho da origem da mercadoria.
        if (campoInd) {
          var ind = codigoDoIndIeDest(cad[campoInd]);
          if (ind) dest.indIeDest = ind;
        }
      }

      var end = endereco(newRecord);
      if (end) {
        if (end.addr1) dest.logradouro = texto(end.addr1);
        if (end.addr2) dest.complemento = texto(end.addr2);
        if (end.addr3) dest.bairro = texto(end.addr3);
        if (end.numero) dest.numero = texto(end.numero);
        if (end.city) dest.municipio = texto(end.city);
        if (end.state) dest.uf = texto(end.state).toUpperCase().substring(0, 2);
        if (end.zip) dest.cep = digitos(end.zip);
      }

      return Object.keys(dest).length ? dest : null;
    }

    /**
     * Endereço do DESTINATÁRIO = endereço de FATURAMENTO.
     *
     * Não é o de entrega, e a distinção é do layout, não de preferência: o grupo `dest` da NF-e
     * identifica a quem a operação é destinada — o cadastro, o mesmo endereço do CNPJ/IE. Quando
     * a mercadoria vai para outro lugar, isso é o grupo `entrega` (Local de Entrega), informado
     * SÓ quando difere do destinatário, e que não existe neste DTO. Mandar o endereço de entrega
     * como `dest` troca o destinatário da nota.
     *
     * SUBRECORD, não consulta: no `beforeSubmit` de CRIAÇÃO a transação ainda não está no
     * banco, e a linha do endereço não existe para ser lida. Medido em 23/09/2026 na invoice
     * 2232: `shipaddresslist` volta vazio no `beforeSubmit` — `billaddresslist` não foi medido,
     * e por isso ele entra no log de falha abaixo em vez de virar a fonte.
     */
    function endereco(newRecord) {
      var sub = null;
      try {
        sub = newRecord.getSubrecord({ fieldId: 'billingaddress' });
      } catch (e) {
        log.error('fp_md_map_simular.endereco', 'getSubrecord billingaddress: ' + (e.message || e));
      }

      var campoNumero = fpFields.idEndereco('END_NUMERO');
      var end = sub ? {
        addr1: ler(sub, 'addr1'),
        addr2: ler(sub, 'addr2'),
        addr3: ler(sub, 'addr3'),
        numero: campoNumero ? ler(sub, campoNumero) : '',
        city: ler(sub, 'city'),
        state: ler(sub, 'state'),
        zip: ler(sub, 'zip')
      } : null;

      if (end && (end.addr1 || end.city)) return end;

      // NÃO ACHOU. O que cada fonte tinha vai para o log — é a medição que diz qual usar, e sem
      // ela a próxima tentativa seria chute. Sai daqui assim que o caso estiver fechado.
      log.audit('fp_md_map_simular.endereco',
        'destinatário sem endereço, e a SEFAZ vai recusar. subrecord=' + (sub ? 'sim' : 'não') +
        ' addr1="' + (end ? end.addr1 : '') + '" city="' + (end ? end.city : '') +
        '" billaddresslist=' + newRecord.getValue({ fieldId: 'billaddresslist' }) +
        ' billaddress="' + newRecord.getValue({ fieldId: 'billaddress' }) + '"');
      return null;
    }

    /** Campo ausente no subrecord não pode derrubar a leitura dos outros. */
    function ler(sub, campo) {
      try {
        var v = sub.getValue({ fieldId: campo });
        return v === null || v === undefined ? '' : String(v);
      } catch (e) {
        log.debug('fp_md_map_simular.ler', campo + ': ' + (e.message || e));
        return '';
      }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // linhas
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Uma linha do DTO por linha do sublist `item`, na ordem em que estão.
     *
     * `numeroItem` é sequencial a partir de 1 e é a amarração com o retorno: é por ele que
     * `linhas[].impostos[]` reencontra a linha da transação.
     */
    function montarLinhas(newRecord) {
      var total = contarLinhas(newRecord);
      if (!total) return [];

      var i;
      var itens = [];
      for (i = 0; i < total; i++) {
        var it = valorLinha(newRecord, 'item', i);
        if (it) itens.push(it);
      }
      var cadastro = carregarItens(itens);

      // `getSublistText` fica de fora deste módulo: em parte dos contextos ele devolve
      // `undefined` sem erro, e aí a unidade sairia vazia no payload sem nada acusar. Resolver por
      // SuiteQL é uma consulta a mais e um comportamento a menos para adivinhar.
      var unidades = resolverTextos(
        colunaDaLinha(newRecord, total, 'units'),
        'SELECT internalid AS id, abbreviation AS txt FROM unitstypeuom', 'internalid');

      var campoNat = fpFields.idLinha('LINHA_NATUREZA');
      var naturezas = campoNat
        ? resolverTextos(colunaDaLinha(newRecord, total, campoNat),
            'SELECT id AS id, name AS txt FROM ' + fpFields.registro('NATUREZA_OPERACAO'), 'id')
        : {};

      var linhas = [];
      for (i = 0; i < total; i++) {
        var item = valorLinha(newRecord, 'item', i);
        var quantidade = numero(valorLinha(newRecord, 'quantity', i));
        var unitario = numero(valorLinha(newRecord, 'rate', i));
        var montante = numero(valorLinha(newRecord, 'amount', i));

        // Linha sem valor nenhum não é linha fiscal — é descrição, subtotal ou grupo.
        if (!unitario && !montante) continue;

        var numeroItem = linhas.length + 1;
        var linha = { numeroItem: numeroItem, valorProduto: unitario || montante };

        // GRAVA O NÚMERO NA PRÓPRIA LINHA. É a amarração do retorno: `linhas[].impostos[]` volta
        // com `numeroItem`, e sem ele guardado aqui a correspondência com a linha da transação
        // dependeria da ordem do sublist — que muda quando alguém insere ou apaga uma linha.
        // O campo é HIDDEN porque ninguém digita isso; quem preenche é este mapeador.
        marcarNumeroItem(newRecord, i, numeroItem);

        if (quantidade) linha.quantidade = quantidade;
        if (montante) { linha.valorTotal = montante; linha.valorBruto = montante; }

        var desc = textoLinha(newRecord, 'description', i);
        if (desc) linha.descricao = desc;

        // `units` é List/Record: o sublist devolve o internal id ("2"), e o motor espera a
        // sigla ("CX"). A sigla mora em `unitstypeuom.abbreviation`.
        var unidade = unidades[String(valorLinha(newRecord, 'units', i))];
        if (unidade) linha.unidade = unidade;

        // CFOP é texto de 4 dígitos. Quem valida é o motor, que tem a tabela; aqui só se garante
        // a forma, porque mandar "61022" ou "abc" faz a recusa apontar para o lugar errado.
        var campoCfop = fpFields.idLinha('LINHA_CFOP');
        var cfop = campoCfop && codigoDoCfop(valorLinha(newRecord, campoCfop, i));
        if (cfop) linha.cfopCodigo = cfop;

        var natLinha = campoNat && naturezas[String(valorLinha(newRecord, campoNat, i))];
        if (natLinha) linha.naturezaOperacaoId = natLinha;

        var cad = item && cadastro[String(item)];
        if (cad) {
          if (cad.codigo) linha.codigoProduto = cad.codigo;
          if (cad.ncm) linha.ncm = cad.ncm;
          if (cad.cest) linha.cest = cad.cest;
          if (cad.origem) linha.origemProduto = cad.origem;
          if (cad.servicoLc116) linha.codigoServicoLc116 = cad.servicoLc116;
          if (!linha.descricao && cad.descricao) linha.descricao = cad.descricao;
        }

        linhas.push(linha);
      }
      return linhas;
    }

    /**
     * Escreve o `numeroItem` na linha do sublist.
     *
     * Silencioso de propósito quando a chave não resolve no perfil ativo ou o campo não existe na
     * conta: o payload sai igual, e o que se perde é só a correspondência de volta. Derrubar o
     * save por causa de um campo de rastreio seria trocar um problema pequeno por um grande.
     */
    function marcarNumeroItem(newRecord, linhaSublist, numero) {
      var campo = fpFields.idLinha('LINHA_NUMERO_ITEM');
      if (!campo) return;
      try {
        newRecord.setSublistValue({
          sublistId: 'item', fieldId: campo, value: numero, line: linhaSublist
        });
      } catch (e) {
        log.debug('fp_md_map_simular.marcarNumeroItem', campo + ': ' + (e.message || e));
      }
    }

    /**
     * UMA busca para todos os itens da nota.
     *
     * NCM, CEST e origem passam pela camada de compatibilidade e só entram nas colunas se o perfil
     * ativo os mapear. Se a coluna não existir na conta, a busca inteira lança — daí a segunda
     * tentativa só com o que é nativo, para ao menos o código do produto chegar.
     */
    function carregarItens(ids) {
      var unicos = {};
      var lista = [];
      for (var i = 0; i < ids.length; i++) {
        var k = String(ids[i]);
        if (!unicos[k]) { unicos[k] = true; lista.push(ids[i]); }
      }
      if (!lista.length) return {};

      var nativas = ['itemid', 'displayname'];
      var colunas = nativas.slice();
      // Mercadoria leva NCM; serviço leva o subitem da LC 116. O motor recusa a linha que não
      // traga um dos dois, e os campos são excludentes por construção: os de mercadoria não
      // aplicam em item de serviço, e o de serviço não aplica em mercadoria.
      var logicas = { ncm: 'ITEM_NCM', cest: 'ITEM_CEST', origem: 'ITEM_ORIGEM',
                      servicoLc116: 'ITEM_SERVICO_LC116' };
      var mapa = {};

      // `origem` é List/Record; as outras são texto. O prefixo diz ao SuiteQL qual precisa de
      // `BUILTIN.DF`, e o `mapa` guarda o nome prefixado para reencontrar a coluna na resposta.
      for (var chave in logicas) {
        if (!Object.prototype.hasOwnProperty.call(logicas, chave)) continue;
        var id = fpFields.idItem(logicas[chave]);
        if (!id) continue;
        var col = chave === 'origem' ? 'DF:' + id : id;
        mapa[chave] = col;
        colunas.push(col);
      }

var out = buscarItens(lista, colunas, mapa);

      // ⚠ COLUNA INVÁLIDA SÓ ESTOURA NO `.each()`, não no `create()`.
      // O `search.create()` é preguiçoso: ele aceita qualquer nome de coluna e só valida quando a
      // busca roda. Por isso o try/catch precisa envolver a EXECUÇÃO — envolver só a criação fazia
      // o SSS_INVALID_SRCH_COL subir até o beforeSubmit e derrubar o save (medido em produção:
      // `custitem_fp_servico_lc116` ainda não deployado).
      if (out === null) {
        log.audit('fp_md_map_simular.carregarItens',
          'busca com as colunas fiscais falhou; repetindo só com as nativas. Campo de item ' +
          'mapeado no perfil e ausente na conta é a causa provável — NCM e serviço não vão no ' +
          'payload, e o motor vai recusar a linha dizendo isso.');
        out = buscarItens(lista, nativas, {});
      }
      return out || {};
    }

/**
     * SuiteQL, não saved search — e a diferença é medida, não preferência.
     *
     * ⚠ `search.create({type:'item'})` REJEITA como coluna inválida um campo que só aplica a um
     * subtipo de item: `custitem_fp_servico_lc116` aplica só a Service, e a busca estourava com
     * `SSS_INVALID_SRCH_COL` mesmo com o campo deployado e existindo na conta. Medido em
     * 2026-09-23 contra a `tstdrv1647270`: `SELECT custitem_fp_servico_lc116 FROM item` devolve
     * 200 no SuiteQL, e a mesma coluna derruba o saved search. São dois motores diferentes.
     *
     * Devolve `null` quando a consulta falha e `{}` quando roda e não acha nada. São coisas
     * diferentes: a primeira pede a segunda tentativa sem as colunas fiscais, a segunda não.
     */
    function buscarItens(ids, colunas, mapa) {
      try {
        // Coluna prefixada com `DF:` é List/Record e precisa de `BUILTIN.DF` — sem isso o
        // SuiteQL devolve o internal id do valor da lista, e o código ficaria perdido.
        var sel = [];
        for (var c = 0; c < colunas.length; c++) {
          var nome = colunas[c];
          sel.push(nome.indexOf('DF:') === 0
            ? 'BUILTIN.DF(i.' + nome.substring(3) + ') AS c' + c
            : 'i.' + nome + ' AS c' + c);
        }

        var linhas = query.runSuiteQL({
          query: 'SELECT i.id AS id, ' + sel.join(', ') + ' FROM item i WHERE i.id IN (' +
                 ids.map(function () { return '?'; }).join(',') + ')',
          params: ids
        }).asMappedResults();

        var idx = {};
        for (var k = 0; k < colunas.length; k++) idx[colunas[k]] = 'c' + k;

        var out = {};
        for (var n = 0; n < linhas.length; n++) {
          var r = linhas[n];
          var reg = {
            codigo: texto(r[idx.itemid]),
            descricao: texto(r[idx.displayname])
          };
          for (var m in mapa) {
            if (!Object.prototype.hasOwnProperty.call(mapa, m)) continue;
            var v = r[idx[mapa[m]]];
            if (v !== null && v !== undefined && v !== '') reg[m] = String(v);
          }
          if (reg.ncm) reg.ncm = digitos(reg.ncm);
          if (reg.cest) reg.cest = digitos(reg.cest);
          if (reg.origem) reg.origem = codigoDaOrigem(reg.origem);
          if (reg.servicoLc116) reg.servicoLc116 = texto(reg.servicoLc116).trim().replace(',', '.');
          out[String(r.id)] = reg;
        }
        return out;
      } catch (e) {
        log.debug('fp_md_map_simular.buscarItens', (colunas || []).join(',') + ' → ' + (e.message || e));
        return null;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // resultado do motor → sublist de impostos
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Tudo pela camada de compatibilidade, nada chumbado.
     *
     * Montado SOB DEMANDA e não no nível do módulo: resolver o perfil custa, e pagar isso no load
     * de todo script — inclusive nos saves que nem simulam — seria custo em troca de nada.
     */
    function camposImposto() {
      return {
        SUBLIST: fpFields.idImposto('SUBLIST'),
        LINHA: fpFields.idImposto('NUMERO_LINHA'),
        TAXCODIGO: fpFields.idImposto('TAXCODIGO'),
        CST: fpFields.idImposto('CST'),
        CCLASSTRIB: fpFields.idImposto('CCLASSTRIB'),
        BASE: fpFields.idImposto('BASE_CALCULO'),
        REDUCAO: fpFields.idImposto('REDUCAO_BASE'),
        ALIQUOTA: fpFields.idImposto('ALIQUOTA'),
        VALOR: fpFields.idImposto('VALOR'),
        NATUREZA: fpFields.idImposto('NATUREZA_CONTABIL'),
        COMPOE: fpFields.idImposto('COMPOE_TOTAL'),
        PERNA: fpFields.idImposto('PERNA'),
        GERA: fpFields.idImposto('GERA_LANCAMENTO')
      };
    }

    /**
     * Reflete `linhas[].impostos[]` no sublist. Reflexo, nunca recálculo.
     *
     * O índice do sublist é CORRIDO, e não o do imposto dentro da linha: o sublist é plano e recebe
     * os impostos de todas as linhas numa lista só. Usar o índice de dentro fazia a linha 2 gravar
     * por cima da linha 1 — sem erro, sem log, e com o total certo na tela.
     */
    function aplicar(newRecord, json) {
      var CAMPO = camposImposto();
      var SUBLIST = CAMPO.SUBLIST;
      removeImpostos(newRecord, SUBLIST);
      if (!json || !json.linhas) return;

      var linha = 0;

      json.linhas.forEach(function (l, i) {
        var num = l.numeroItem || (i + 1);
        (l.impostos || []).forEach(function (t) {
          gravar(newRecord, SUBLIST, linha, CAMPO.LINHA, num);
          gravar(newRecord, SUBLIST, linha, CAMPO.TAXCODIGO, t.taxCodigo);
          gravar(newRecord, SUBLIST, linha, CAMPO.CST, t.cst);
          gravar(newRecord, SUBLIST, linha, CAMPO.CCLASSTRIB, t.cclasstrib);
          gravar(newRecord, SUBLIST, linha, CAMPO.BASE, t.baseCalculo);
          gravar(newRecord, SUBLIST, linha, CAMPO.REDUCAO, t.reducaoBase);
          gravar(newRecord, SUBLIST, linha, CAMPO.ALIQUOTA, t.aliquota);
          gravar(newRecord, SUBLIST, linha, CAMPO.VALOR, t.valor);
          gravar(newRecord, SUBLIST, linha, CAMPO.NATUREZA, t.naturezaContabil);
          gravar(newRecord, SUBLIST, linha, CAMPO.COMPOE, t.compoeTotalNf === true);

          // O contrato da perna: a plataforma decide, o ERP reflete. `perna` vazia não é dado
          // faltando — é a plataforma dizendo que NÃO decide o caso. A `razaoDaPerna`, que
          // explica o porquê, não vira campo: ela está no retorno.json anexado à transação.
          gravar(newRecord, SUBLIST, linha, CAMPO.PERNA, t.sentidoDaPernaFixa || '');
          gravar(newRecord, SUBLIST, linha, CAMPO.GERA, t.geraLancamento === true);

          linha++;
        });
      });

    }

    function gravar(newRecord, sublist, linha, campo, valor) {
      if (valor === null || valor === undefined || !campo) return;
      try {
        newRecord.setSublistValue({ sublistId: sublist, fieldId: campo, value: valor, line: linha });
      } catch (e) {
        log.error('fp_md_map_simular.gravar', campo + ' linha ' + linha + ': ' + (e.message || e));
      }
    }

    function removeImpostos(newRecord, sublist) {
      if (!sublist) return;
      try {
        var n = newRecord.getLineCount({ sublistId: sublist });
        for (var i = 0; i < n; i++) {
          newRecord.removeLine({ sublistId: sublist, line: 0 });
        }
      } catch (e) {
        log.error('fp_md_map_simular.removeImpostos', e.message || e);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────

    function contarLinhas(newRecord) {
      try {
        return newRecord.getLineCount({ sublistId: 'item' });
      } catch (e) {
        return 0;
      }
    }

    function valorLinha(newRecord, campo, linha) {
      try {
        return newRecord.getSublistValue({ sublistId: 'item', fieldId: campo, line: linha });
      } catch (e) {
        return null;
      }
    }

    function textoLinha(newRecord, campo, linha) {
      var v = valorLinha(newRecord, campo, linha);
      return v ? String(v) : null;
    }

    /** Todos os valores distintos de uma coluna do sublist, sem vazio e sem repetido. */
    function colunaDaLinha(newRecord, total, campo) {
      var vistos = {};
      var ids = [];
      for (var i = 0; i < total; i++) {
        var v = valorLinha(newRecord, campo, i);
        if (!v) continue;
        var k = String(v);
        if (!vistos[k]) { vistos[k] = true; ids.push(k); }
      }
      return ids;
    }

    /**
     * `{ id: texto }` numa consulta só, para o conjunto inteiro.
     *
     * Existe no lugar de `getSublistText` — que em parte dos contextos devolve `undefined` sem
     * erro, e o campo sairia vazio do payload sem nada acusar. Falha devolve `{}`: o payload sai
     * sem aquele campo, e o motor recusa dizendo o que falta, que é melhor que adivinhar.
     */
    function resolverTextos(ids, sql, colunaId) {
      if (!ids.length) return {};
      try {
        // MEDIDO: o SuiteQL NÃO aceita alias no `WHERE`. `unitstypeuom` se filtra por
        // `internalid`, e `... AS id ... WHERE id IN (2)` devolve 400. A coluna de filtro vem
        // separada do SELECT por isso.
        var r = query.runSuiteQL({
          query: sql + ' WHERE ' + colunaId + ' IN (' +
                 ids.map(function () { return '?'; }).join(',') + ')',
          params: ids
        }).asMappedResults();

        var out = {};
        for (var i = 0; i < r.length; i++) out[String(r[i].id)] = texto(r[i].txt);
        return out;
      } catch (e) {
        log.debug('fp_md_map_simular.resolverTextos', sql + ' → ' + (e.message || e));
        return {};
      }
    }

    function valorTexto(newRecord, campo) {
      if (!campo) return null;
      try {
        return newRecord.getText({ fieldId: campo }) || newRecord.getValue({ fieldId: campo }) || null;
      } catch (e) {
        return null;
      }
    }

    function lookup(tipo, id, colunas) {
      try {
        return search.lookupFields({ type: tipo, id: id, columns: colunas });
      } catch (e) {
        log.debug('fp_md_map_simular.lookup', tipo + ' ' + id + ': ' + (e.message || e));
        return null;
      }
    }

    /** `YYYY-MM-DD`. O motor recebe a data como string; a hora do NetSuite não lhe interessa. */
    function dataIso(newRecord, campo) {
      try {
        var d = newRecord.getValue({ fieldId: campo });
        if (!d) return null;
        if (typeof d === 'string') d = format.parse({ value: d, type: format.Type.DATE });
        var mes = d.getMonth() + 1;
        var dia = d.getDate();
        return d.getFullYear() + '-' + (mes < 10 ? '0' : '') + mes + '-' + (dia < 10 ? '0' : '') + dia;
      } catch (e) {
        return null;
      }
    }

    function texto(v) {
      return v === null || v === undefined ? '' : String(v);
    }

    /**
     * `"0 - Nacional, exceto..."` → `"0"`.
     *
     * O valor da lista abre com o código porque quem preenche o cadastro do item precisa ler a
     * descrição para escolher certo — customlist do NetSuite não tem código separado do rótulo.
     * O payload leva só o dígito, que é o que `ORIGENS_TABELA_A` valida no DTO. Fora de 0-8
     * devolve vazio: mandar origem inventada faria o motor recusar a nota inteira.
     */
    /**
     * Exatamente 4 dígitos, ou vazio.
     *
     * Aceita o que o usuário digitou com ponto ou espaço (`5.102`, ` 6102 `) e recusa o resto.
     * Vazio é melhor que errado: sem CFOP o motor resolve sozinho, e com CFOP malformado ele
     * recusa a nota apontando para um problema que é de digitação.
     */
    function codigoDoCfop(v) {
      var d = digitos(v);
      return d.length === 4 ? d : '';
    }

    /**
     * `1`, `2` ou `9` a partir do valor da lista. Número, não string: o DTO tipa `indIeDest` como
     * `number`, e mandar `"1"` faria o Nest descartar o campo sem dizer nada.
     */
    function codigoDoIndIeDest(v) {
      var t = Array.isArray(v) && v.length ? (v[0].text || v[0].value) : v;
      var m = /^\s*([129])(?:\s|-|$)/.exec(texto(t));
      return m ? parseInt(m[1], 10) : 0;
    }

    function codigoDaOrigem(v) {
      var m = /^\s*([0-8])(?:\s|-|$)/.exec(texto(v));
      return m ? m[1] : '';
    }

    function digitos(v) {
      return texto(v).replace(/\D/g, '');
    }

    function numero(v) {
      var n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    }

    return {
      montar: montar,
      montarEmissao: montarEmissao,
      aplicar: aplicar
    };
  });
