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

      // ── O QUE SÓ EXISTE NA EMISSÃO ────────────────────────────────────────────────────────
      //
      // MEDIDO: `indPres`, `transporte`, `pagamento`, `infAdicFisco` e `infAdicContrib` NÃO
      // existem no `SimulacaoNotaInputDto`. Mandá-los no `/simular` é descarte silencioso — o
      // Nest roda `whitelist: true` sem `forbidNonWhitelisted`.
      //
      // `indFinal` NÃO é mandado, e é decisão, não omissão: o motor o deriva da natureza, e o
      // DTO diz que `null` deriva e valor explícito é OVERRIDE. Ele é eixo do DIFAL — mandar 0
      // por engano sobrepõe a derivação e o erro sai como recolhimento a menor.

      var indPres = codigoDaLista(valorTexto(newRecord, fpFields.id('IND_PRES')));
      if (indPres) payload.indPres = indPres;

      var transporte = montarTransporte(newRecord);
      if (transporte) payload.transporte = transporte;

      var fisco = valorTexto(newRecord, fpFields.id('INFADIC_FISCO'));
      if (fisco) payload.infAdicFisco = fisco;

      var contrib = valorTexto(newRecord, fpFields.id('INFADIC_CONTRIB'));
      if (contrib) payload.infAdicContrib = contrib;

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
      return newRecord.getText({ fieldId: campo }) || null;
    
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
      // MEDIDO: nesta conta não há nativo para CNPJ/CPF, razão social, indicador de IE nem
      // regime do destinatário. O resto do destinatário — nome, e-mail, fone, endereço — é
      // standard, e por isso não passa pelo perfil.
      var C = {
        cnpj: fpFields.idCliente('CNPJ_CPF'),
        razao: fpFields.idCliente('RAZAO_SOCIAL'),
        ie: fpFields.idCliente('IE'),
        ind: fpFields.idCliente('IND_IE_DEST'),
        regime: fpFields.idCliente('REGIME_TRIB')
      };

      var colunas = ['companyname', 'entityid', 'email', 'phone'];
      for (var k in C) {
        if (Object.prototype.hasOwnProperty.call(C, k) && C[k]) colunas.push(C[k]);
      }

      var cad = lookup('customer', entity, colunas);
      if (cad) {
        // Razão social primeiro: `companyname` costuma guardar o nome fantasia, e a tag `xNome`
        // do grupo E quer a razão social registrada.
        var nome = (C.razao && texto(cad[C.razao])) || texto(cad.companyname) || texto(cad.entityid);
        if (nome) dest.nome = nome;

        var doc = C.cnpj && digitos(cad[C.cnpj]);
        if (doc) dest.cnpjCpf = doc;

        if (cad.email) dest.email = texto(cad.email);
        if (cad.phone) dest.fone = texto(cad.phone);

        var ie = C.ie && digitos(cad[C.ie]);
        if (ie) dest.ie = ie;

        // `indIeDest` não é rótulo de cadastro: o motor deriva dele o `destinatarioContribuinte`
        // (1 e 2 → true, 9 → false), e é isso que decide o DIFAL.
        var ind = C.ind && codigoDaLista(cad[C.ind]);
        if (ind) dest.indIeDest = parseInt(ind, 10);

        // Regime em branco é SEGURO por desenho do motor: eixo não declarado não casa hipótese e
        // a linha sai com imposto cheio — o erro que não vira glosa. Não inventar default aqui.
        var regime = C.regime && codigoDaLista(cad[C.regime]);
        if (regime) dest.regimeTributario = regime;
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

        // `pais` é o cPais do BACEN, não o ISO. A plataforma deriva 1058 sozinha quando a UF é
        // brasileira, mas para o exterior ela não converte — o `mapa-divergencia.ts` dela registra
        // que exige a tabela do BACEN. Traduzir é trabalho do bundle.
        var cpais = codigoDoPais(end.country);
        if (cpais) dest.pais = cpais;
      }

      return Object.keys(dest).length ? dest : null;
    }

    /**
     * O GRUPO X — transporte. Só na emissão: ele não existe no DTO de simulação.
     *
     * `modFrete` é o ÚNICO obrigatório dentro dele, e sem ele o grupo não existe — o DTO recusaria
     * o objeto. Por isso ele é a porta: sem modalidade declarada, nada de transporte vai.
     *
     * A transportadora sai do CADASTRO do fornecedor, pelos mesmos campos FP que o destinatário
     * usa. Transportador se repete de nota em nota, e redigitar razão social a cada uma é como o
     * dado diverge.
     */
    function montarTransporte(newRecord) {
      var modFrete = codigoDaLista(valorTexto(newRecord, fpFields.id('FRETE_MODALIDADE')));
      if (!modFrete) return null;

      var t = { modFrete: modFrete };

      var transportadora = montarTransportadora(newRecord);
      if (transportadora) t.transportadora = transportadora;

      var retencao = montarRetencao(newRecord);
      if (retencao) t.retencaoIcms = retencao;

      var veiculo = montarVeiculo(newRecord, 'VEICULO_PLACA', 'VEICULO_UF', 'VEICULO_RNTC');
      if (veiculo) t.veiculo = veiculo;

      var reboques = montarReboques(newRecord);
      if (reboques.length) t.reboque = reboques;

      var vagao = valorTexto(newRecord, fpFields.id('VAGAO'));
      if (vagao) t.vagao = vagao;

      var balsa = valorTexto(newRecord, fpFields.id('BALSA'));
      if (balsa) t.balsa = balsa;

      var volumes = montarVolumes(newRecord);
      if (volumes.length) t.volumes = volumes;

      return t;
    }

    function montarTransportadora(newRecord) {
      var campo = fpFields.id('TRANSPORTADORA');
      var id = campo && newRecord.getValue({ fieldId: campo });
      if (!id) return null;

      var cnpj = fpFields.idCliente('CNPJ_CPF');
      var razao = fpFields.idCliente('RAZAO_SOCIAL');
      var ie = fpFields.idCliente('IE');

      var colunas = ['companyname', 'entityid'];
      if (cnpj) colunas.push(cnpj);
      if (razao) colunas.push(razao);
      if (ie) colunas.push(ie);

      var cad = lookup('vendor', id, colunas);
      if (!cad) return null;

      var t = {};
      var nome = (razao && texto(cad[razao])) || texto(cad.companyname) || texto(cad.entityid);
      if (nome) t.nome = nome;
      if (cnpj && digitos(cad[cnpj])) t.cnpjCpf = digitos(cad[cnpj]);
      if (ie && digitos(cad[ie])) t.ie = digitos(cad[ie]);

      // O ENDEREÇO TAMBÉM É DO CADASTRO. `xEnder`, `xMun` e `UF` são três campos do `transporta`,
      // e sem eles o grupo vai pela metade.
      var end = enderecoDoFornecedor(id);
      if (end) {
        if (end.endereco) t.endereco = end.endereco;
        if (end.municipio) t.municipio = end.municipio;
        if (end.uf) t.uf = end.uf;
      }

      return temAlgo(t) ? t : null;
    }

    /**
     * Endereço de cobrança padrão do fornecedor, por SuiteQL.
     *
     * `vendor.defaultbillingaddress` guarda o próprio `nkey` de `entityaddress` — medido na conta
     * em 24/09/2026 —, então uma consulta só resolve, sem passar pelo address book.
     *
     * `xEnder` é UM campo no leiaute, não três: logradouro, número e complemento vão juntos. Por
     * isso o que sai daqui é uma linha montada, e não o `addr1` cru.
     */
    function enderecoDoFornecedor(id) {
      var campoNumero = fpFields.idEndereco('END_NUMERO');
      var cols = 'a.addr1, a.addr2, a.city, a.state, a.dropdownstate';
      if (campoNumero) cols += ', a.' + campoNumero;

      var r = query.runSuiteQL({
        query: 'SELECT ' + cols + ' FROM entityaddress a ' +
               'JOIN vendor v ON a.nkey = v.defaultbillingaddress WHERE v.id = ?',
        params: [id]
      }).asMappedResults();

      if (!r.length) {
        log.audit('fp_md_map_simular.enderecoDoFornecedor',
          'transportador ' + id + ' sem endereco de cobranca padrao — o grupo transporta sai sem ' +
          'xEnder, xMun e UF.');
        return null;
      }

      var e = r[0];
      var partes = [texto(e.addr1)];
      if (campoNumero && texto(e[campoNumero])) partes.push(texto(e[campoNumero]));
      if (texto(e.addr2)) partes.push(texto(e.addr2));

      return {
        endereco: partes.filter(function (x) { return !!x; }).join(', '),
        municipio: texto(e.city),
        uf: (texto(e.dropdownstate) || texto(e.state)).toUpperCase().substring(0, 2)
      };
    }

    /**
     * `retTransp` é INDIVISÍVEL: os seis campos ou nenhum.
     *
     * Meio grupo é rejeição na SEFAZ, e a rejeição chega DEPOIS do número reservado. Recusar aqui,
     * dizendo o que falta, custa um log; recusar lá custa um número.
     */
    function montarRetencao(newRecord) {
      var r = {
        vServ: numero(valorDeCorpo(newRecord, 'RET_VSERV')),
        vBCRet: numero(valorDeCorpo(newRecord, 'RET_VBCRET')),
        pICMSRet: numero(valorDeCorpo(newRecord, 'RET_PICMSRET')),
        vICMSRet: numero(valorDeCorpo(newRecord, 'RET_VICMSRET')),
        cfop: valorTexto(newRecord, fpFields.id('RET_CFOP')),
        cMunFG: digitos(valorTexto(newRecord, fpFields.id('RET_CMUNFG')))
      };

      // Nenhum valor preenchido quer dizer frete sem retenção, que é o caso comum. Não é falta.
      if (!r.vServ && !r.vICMSRet) return null;

      var faltando = [];
      for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k) && !r[k]) faltando.push(k);
      }
      if (faltando.length) {
        log.audit('fp_md_map_simular.montarRetencao',
          'retTransp incompleto e por isso NAO foi enviado. Falta: ' + faltando.join(', ') +
          '. O grupo e indivisivel, e meio grupo e rejeicao depois do numero reservado.');
        return null;
      }
      return r;
    }

    function montarVeiculo(newRecord, kPlaca, kUf, kRntc) {
      var placa = valorTexto(newRecord, fpFields.id(kPlaca));
      if (!placa) return null;

      var v = { placa: normalizarPlaca(placa) };

      var uf = valorTexto(newRecord, fpFields.id(kUf));
      if (uf) v.uf = uf.toUpperCase().substring(0, 2);

      var rntc = valorTexto(newRecord, fpFields.id(kRntc));
      if (rntc) v.rntc = rntc;

      return v;
    }

    /**
     * Até 5, que é o teto do leiaute.
     *
     * Cortar aqui é melhor que deixar a SEFAZ recusar a nota inteira por causa do sexto reboque —
     * e o log diz que cortou, para ninguém procurar o que sumiu.
     */
    function montarReboques(newRecord) {
      var sublist = fpFields.idReboque('SUBLIST');
      var cPlaca = fpFields.idReboque('PLACA');
      if (!sublist || !cPlaca) return [];

      var out = [];
      var total = contarSublist(newRecord, sublist);

      for (var i = 0; i < total; i++) {
        var placa = texto(valorDeSublist(newRecord, sublist, cPlaca, i));
        if (!placa) continue;

        if (out.length === 5) {
          log.audit('fp_md_map_simular.montarReboques',
            'a transacao tem mais de 5 reboques; os excedentes NAO foram enviados. O leiaute da ' +
            'NF-e admite cinco.');
          break;
        }

        var r = { placa: normalizarPlaca(placa) };
        var uf = texto(valorDeSublist(newRecord, sublist, fpFields.idReboque('UF'), i));
        if (uf) r.uf = uf.toUpperCase().substring(0, 2);
        var rntc = texto(valorDeSublist(newRecord, sublist, fpFields.idReboque('RNTC'), i));
        if (rntc) r.rntc = rntc;

        out.push(r);
      }
      return out;
    }

    function montarVolumes(newRecord) {
      var sublist = fpFields.idVolume('SUBLIST');
      if (!sublist) return [];

      var out = [];
      var total = contarSublist(newRecord, sublist);

      for (var i = 0; i < total; i++) {
        var v = {};
        seTiver(v, 'quantidade', numero(valorDeSublist(newRecord, sublist, fpFields.idVolume('QUANTIDADE'), i)));
        seTiver(v, 'especie', texto(valorDeSublist(newRecord, sublist, fpFields.idVolume('ESPECIE'), i)));
        seTiver(v, 'marca', texto(valorDeSublist(newRecord, sublist, fpFields.idVolume('MARCA'), i)));
        seTiver(v, 'numeracao', texto(valorDeSublist(newRecord, sublist, fpFields.idVolume('NUMERACAO'), i)));
        seTiver(v, 'pesoLiquido', numero(valorDeSublist(newRecord, sublist, fpFields.idVolume('PESO_LIQUIDO'), i)));
        seTiver(v, 'pesoBruto', numero(valorDeSublist(newRecord, sublist, fpFields.idVolume('PESO_BRUTO'), i)));

        // Um campo com os lacres separados por vírgula vira a lista repetível do leiaute. Uma
        // terceira sublista dentro da sublista custaria mais para manter do que o dado vale.
        var lacres = separarPorVirgula(valorDeSublist(newRecord, sublist, fpFields.idVolume('LACRES'), i));
        if (lacres.length) v.lacres = lacres;

        if (temAlgo(v)) out.push(v);
      }
      return out;
    }

    function normalizarPlaca(v) {
      return texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function separarPorVirgula(v) {
      var partes = texto(v).split(',');
      var out = [];
      for (var i = 0; i < partes.length; i++) {
        var x = partes[i].replace(/^\s+|\s+$/g, '');
        if (x) out.push(x);
      }
      return out;
    }

    function seTiver(alvo, chave, valor) {
      if (valor !== null && valor !== undefined && valor !== '' && valor !== 0) alvo[chave] = valor;
    }

    function temAlgo(o) {
      for (var k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k)) return true;
      }
      return false;
    }

    function valorDeCorpo(newRecord, chave) {
      var campo = fpFields.id(chave);
      return campo ? newRecord.getValue({ fieldId: campo }) : null;
    }

    function valorDeSublist(newRecord, sublist, campo, linha) {
      if (!campo) return null;
      return newRecord.getSublistValue({ sublistId: sublist, fieldId: campo, line: linha });
    }

    function contarSublist(newRecord, sublist) {
      var n = newRecord.getLineCount({ sublistId: sublist });
      return n > 0 ? n : 0;
    }

    /**
     * Endereço do DESTINATÁRIO = endereço de FATURAMENTO.
     *
     * Não é o de entrega: o grupo `dest` da NF-e identifica a quem a operação é destinada — o
     * cadastro, o mesmo endereço do CNPJ/IE. Mercadoria indo para outro lugar é o grupo `entrega`,
     * que nem existe neste DTO.
     *
     * ── POR QUE DUAS FONTES, e não é indecisão ────────────────────────────────────────────────
     *
     * MEDIDO em 23/09/2026, invoice 2232: o subrecord `billingaddress` devolve `addr1`, `addr3` e
     * `zip` — e devolve VAZIO `city`, `state` e o campo custom do número. O payload saiu com
     * logradouro, bairro e CEP, sem município nem UF.
     *
     * A consulta sozinha também não resolve: no `beforeSubmit` de CRIAÇÃO a transação ainda não
     * está no banco, então `transactionbillingaddress` não tem linha. O que existe desde sempre é
     * a entrada do address book do cliente, em `entityaddress`, apontada por `billaddresslist` —
     * e é de lá que saem os três que o subrecord cala, inclusive o campo custom.
     *
     * Então: subrecord para o que ele entrega, SuiteQL para o que ele cala. Quando os dois calam
     * o município, o log diz o que cada um tinha — é a medição que decide o próximo passo, não
     * chute.
     */
    function endereco(newRecord) {
      var sub = null;
      sub = newRecord.getSubrecord({ fieldId: 'billingaddress' });

      var end = {
        addr1: ler(sub, 'addr1'),
        addr2: ler(sub, 'addr2'),
        addr3: ler(sub, 'addr3'),
        numero: ler(sub, fpFields.idEndereco('END_NUMERO')),
        city: ler(sub, 'city'),
        state: ler(sub, 'state'),
        zip: ler(sub, 'zip'),
        country: ler(sub, 'country')
      };
      log.debug('end', end)
      var idCadastro = newRecord.getValue({ fieldId: 'billaddresslist' });

      if (end.city && end.state) return end;

      log.audit('fp_md_map_simular.endereco',
        'destinatário sem município ou UF, e a SEFAZ vai recusar. ' +
        'subrecord: city="' + ler(sub, 'city') + '" state="' + ler(sub, 'state') +
        '" dropdownstate="' + ler(sub, 'dropdownstate') + '" · ' +
        'billaddresslist=' + idCadastro);

      // Incompleto ainda é melhor que nada: o motor recusa dizendo qual campo falta, e a recusa
      // dele é mais precisa que o silêncio daqui.
      return (end.addr1 || end.city) ? end : null;
    }

    /**
     * ISO alpha-2 do endereço → cPais de 4 dígitos, por `customrecord_fp_pais`.
     *
     * ⚠ O cPais NÃO se deriva do código Siscomex de 3 dígitos. A regra do dígito verificador
     * (mod 11, pesos 4-3-2) foi conferida contra a tabela publicada em 24/09/2026 e falha em 14
     * países — Aland, Antártica, Ilha de Man e Montenegro entre eles. Por isso é tabela carregada,
     * não conta feita em código.
     *
     * País não encontrado sai do payload e vai para o log com o valor cru: melhor o motor recusar
     * dizendo que falta o país do que a nota sair com o país errado.
     */
    function codigoDoPais(iso) {
      var sigla = texto(iso).trim().toUpperCase();
      if (!sigla) return '';

      var registro = fpFields.registro('PAIS');
      var colIso = fpFields.idPais('ISO');
      var colCpais = fpFields.idPais('CPAIS');
      if (!registro || !colIso || !colCpais) return '';

      var r = query.runSuiteQL({
        query: 'SELECT ' + colCpais + ' AS cpais FROM ' + registro + ' WHERE UPPER(' + colIso + ') = ?',
        params: [sigla]
      }).asMappedResults();

      if (!r.length) {
        log.audit('fp_md_map_simular.codigoDoPais',
          'país "' + sigla + '" não está em ' + registro + ' — o destinatário sai sem cPais. ' +
          'Carga em carga/customrecord_fp_pais.csv.');
        return '';
      }
      return texto(r[0].cpais);
    }

    /** Campo ausente no subrecord não pode derrubar a leitura dos outros. */
    function ler(sub, campo) {
      if (!sub) return '';
      var v = sub.getValue({ fieldId: campo });
      return v === null || v === undefined ? '' : String(v);
    
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
      newRecord.setSublistValue({
        sublistId: 'item', fieldId: campo, value: numero, line: linhaSublist
      });
    
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

      var colunas = ['itemid', 'displayname'];
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

      // Coluna mapeada no perfil e ausente na conta derruba a consulta, e o save PARA com a
      // mensagem do NetSuite na tela. Antes havia segunda tentativa só com as colunas nativas:
      // saía payload sem NCM, o motor recusava a linha por outro motivo, e o campo que faltava
      // de verdade nunca aparecia. Falhar apontando o campo é mais curto que investigar duas
      // recusas.
      return buscarItens(lista, colunas, mapa) || {};
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
     * Consulta que falha LANÇA, e o erro sobe até o `beforeSubmit`, que o mostra ao usuário. Não
     * se engole aqui: coluna inexistente é defeito de perfil ou de deploy, e mascarar isso com
     * payload incompleto adia o diagnóstico para a recusa da SEFAZ.
     */
    function buscarItens(ids, colunas, mapa) {
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
      newRecord.setSublistValue({ sublistId: sublist, fieldId: campo, value: valor, line: linha });
    
    }

    function removeImpostos(newRecord, sublist) {
      if (!sublist) return;
      var n = newRecord.getLineCount({ sublistId: sublist });
      for (var i = 0; i < n; i++) {
        newRecord.removeLine({ sublistId: sublist, line: 0 });
      }
    
    }

    // ─────────────────────────────────────────────────────────────────────────

    function contarLinhas(newRecord) {
      return newRecord.getLineCount({ sublistId: 'item' });
    
    }

    function valorLinha(newRecord, campo, linha) {
      return newRecord.getSublistValue({ sublistId: 'item', fieldId: campo, line: linha });
    
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
    
    }

    function valorTexto(newRecord, campo) {
      if (!campo) return null;
      return newRecord.getText({ fieldId: campo }) || newRecord.getValue({ fieldId: campo }) || null;
    
    }

    function lookup(tipo, id, colunas) {
      return search.lookupFields({ type: tipo, id: id, columns: colunas });
    
    }

    /** `YYYY-MM-DD`. O motor recebe a data como string; a hora do NetSuite não lhe interessa. */
    function dataIso(newRecord, campo) {
      var d = newRecord.getValue({ fieldId: campo });
      if (!d) return null;
      if (typeof d === 'string') d = format.parse({ value: d, type: format.Type.DATE });
      var mes = d.getMonth() + 1;
      var dia = d.getDate();
      return d.getFullYear() + '-' + (mes < 10 ? '0' : '') + mes + '-' + (dia < 10 ? '0' : '') + dia;
    
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
     * O CÓDIGO que abre o valor da lista — `1`, `SN`, `ISENTO`.
     *
     * As listas do bundle são todas "CÓDIGO - descrição": o código é o que o motor valida, e a
     * descrição existe para quem preenche o cadastro escolher certo. `lookupFields` devolve
     * List/Record como `[{value, text}]`, e é do texto que o código sai.
     */
    function codigoDaLista(v) {
      var t = Array.isArray(v) && v.length ? (v[0].text || v[0].value) : v;
      var m = /^\s*([A-Z0-9_]+)\s*-\s/.exec(texto(t));
      return m ? m[1] : '';
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
