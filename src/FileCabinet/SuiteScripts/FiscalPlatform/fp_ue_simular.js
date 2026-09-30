/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 *
 * SIMULAÇÃO FISCAL SÍNCRONA NA TRANSAÇÃO.
 *
 * `beforeSubmit` chama `POST /api/v1/fiscal/simular-nota` e grava o resultado na transação que está
 * sendo salva — é o único gatilho em que isso é possível sem um segundo submit. `beforeLoad` pinta
 * na tela, no re-render pós-save, o que o `beforeSubmit` deixou na sessão (ver `fp_msg.js`).
 *
 * `/simular`, JAMAIS `/emitir`. Mesmo motor, devolve `linhas[].impostos[]` com o CST resolvido e
 * NÃO consome numeração — e é só por isso que ele pode morar num caminho que roda a cada save.
 * Emissão tem endereço próprio: o Suitelet, por ação explícita.
 *
 * ── AS GUARDAS, e nenhuma é opcional ────────────────────────────────────────────────────────────
 *
 * 1. O `catch` NUNCA derruba o save. Motor fora do ar, timeout, 500 → grava o motivo, avisa, e
 *    deixa gravar. Simulação é conveniência; impedir o usuário de salvar um pedido porque o motor
 *    caiu troca um problema por um pior.
 * 2. ⚠ NÃO EXISTE timeout configurável. MEDIDO: `N/https` não tem parâmetro de timeout — os
 *    limites são fixos da plataforma, **5 s para negociar a conexão e 45 s para a requisição**
 *    (`SSS_REQUEST_TIME_EXCEEDED`). O `options.timeout` da documentação é do `N/documentCapture`.
 *    Logo: motor INALCANÇÁVEL bloqueia o save por ~5 s, o que é tolerável; motor LENTO A RESPONDER
 *    pode bloquear até 45 s, e isso não tem como encurtar. É risco declarado, não mitigado — e é
 *    o que torna a guarda 4 (short-circuit) a mitigação que realmente sobra.
 * 3. Guarda de `executionContext`. Sem ela, uma carga de 5.000 pedidos por CSV faz 5.000 chamadas
 *    externas, e as gravações do próprio bundle (Suitelet e Map/Reduce) REENTRAM aqui.
 * 4. Short-circuit por mudança relevante. Save que não mexeu em item, valor, frete, desconto,
 *    destinatário, subsidiária ou natureza não paga chamada de rede.
 * 5. `/simular` e não `/emitir` (acima).
 *
 * ── DEPENDÊNCIAS AINDA NÃO ESCRITAS, e o motivo de não estarem ─────────────────────────────────
 *
 * `./fp_client.js`      transporte (token Bearer, N/cache, N/https, backoff, log). O trecho de
 *                       Secrets Management tem de ser escrito contra a documentação e passar por
 *                       `project:validate --server` — não de memória.
 * `./fp_md_map_simular.js` mapeador whitelist transação → `SimulacaoNotaInputDto`. Depende do
 *                       scriptid REAL dos campos da conta `tstdrv1647270` (medição §7 do
 *                       PLANEJAMENTO.md). Inventar scriptid aqui produziria um mapeador que
 *                       compila e nunca funciona.
 *
 * CONTRATO ESPERADO DE `fp_client.simularNota(payload, opcoes)`:
 *   devolve `{ ok: boolean, code: number, body: Object|string, durationMs: number }`
 *   NÃO lança para HTTP != 2xx (quem decide o que fazer é este script)
 *   LANÇA só para falha de transporte (DNS, TLS, timeout)
 */
define([
  'N/ui/serverWidget',
  'N/record',
  'N/file',
  'N/runtime',
  'N/log',
  './fp_msg',
  './fp_fields',
  './fp_form',
  './fp_client',
  './fp_md_map_simular',
  './fp_entrada',
  './fp_governanca',
  'N/query',
  './fp_chave'
], function (serverWidget, record, file, runtime, log, fpMsg, fpFields, fpForm, fpClient, fpMapSimular, fpEntrada,
  fpGovernanca, query, fpChave) {
  /** Tipos de transação em que a simulação roda. Fora desta lista, o script não faz nada. */
  var TIPOS = [
    'invoice',
    'salesorder',
    'creditmemo',
    'returnauthorization',
    'purchaseorder',
    'vendorbill',
    'vendorcredit',
    'transferorder'
  ];

  /**
   * Contextos em que a simulação NÃO roda (guarda 3).
   *
   * `CSVIMPORT` e `WEBSERVICES` porque carga em massa não é save de usuário — não tem tela para
   * receber a mensagem e multiplicaria a chamada externa por milhares.
   * `MAP_REDUCE`, `SCHEDULED` e `SUITELET` porque são o PRÓPRIO bundle gravando: o Suitelet de
   * emissão e o Map/Reduce de entrada salvam a transação, e sem esta guarda o save deles reentra
   * aqui e simula de novo o que já foi emitido.
   */
  /**
   * ⚠ FUNÇÃO, não constante de módulo.
   *
   * MEDIDO no deploy de 2026-09-23: ler `runtime.ContextType.*` no corpo do `define` derruba o
   * script inteiro com `SUITESCRIPT_API_UNAVAILABLE_IN_DEFINE — All SuiteScript API Modules are
   * unavailable while executing your define callback`. O módulo é injetado, mas **tocá-lo antes
   * de o callback terminar é proibido**, mesmo para ler um enum. Vale para qualquer `N/*` no
   * bundle: nada de API no escopo do módulo.
   */
  function contextosBloqueados() {
    return [
      runtime.ContextType.CSV_IMPORT,
      runtime.ContextType.WEBSERVICES,
      runtime.ContextType.RESTWEBSERVICES,
      runtime.ContextType.MAP_REDUCE,
      runtime.ContextType.SCHEDULED,
      runtime.ContextType.SUITELET,
      runtime.ContextType.WORKFLOW,
      runtime.ContextType.BUNDLE_INSTALLATION,
      runtime.ContextType.USEREVENT
    ];
  }

  /**
   * Organiza o formulário e pinta o que o save deixou na sessão.
   *
   * ORDEM DAS DUAS COISAS não importa entre si, mas cada uma tem o seu `try` próprio: falha ao
   * ORGANIZAR não pode engolir a MENSAGEM (o usuário perderia a rejeição da SEFAZ por causa de um
   * campo fora de lugar), e nenhuma das duas pode impedir o registro de abrir.
   */
  /**
   * Chave da sessão onde o `beforeSubmit` deixa o rastro para o `afterSubmit` anexar.
   *
   * SESSÃO e não variável de módulo, e a diferença importa: no `beforeSubmit` de uma transação
   * NOVA ainda não existe id, então o anexo só pode acontecer no `afterSubmit` — e o que
   * atravessa as duas funções com garantia é a sessão, não o escopo do módulo. O `corrId` entra
   * na chave porque é o que identifica ESTA passagem: dois saves em abas diferentes não podem
   * ler o rastro um do outro.
   */
  function chaveRastro(corrId) {
    return 'fp_rastro_' + corrId;
  }

  /**
   * PINTAR A MENSAGEM VEM PRIMEIRO, e a ordem é a defesa: é o `beforeLoad` que mostra o que o
   * `beforeSubmit` deixou na sessão. Se `organizarFormulario` estourasse antes, o save anterior
   * teria falhado e o usuário abriria o formulário sem enxergar o motivo.
   *
   * Erro aqui não pode impedir abrir a transação: montar subaba e ordenar campo é conveniência,
   * e trocá-la por "não abre" é o pior negócio do bundle. Vai para o log inteiro.
   */
  function beforeLoad(scriptContext) {
    try {
      fpMsg.pintar(scriptContext);
      limparNaCopia(scriptContext);
      organizarFormulario(scriptContext);
    } catch (e) {
      log.error('fp_ue_simular.beforeLoad', { name: e.name, message: e.message, stack: e.stack });
    }
  }

  /**
   * Campos de cabeçalho cuja mudança justifica simular de novo (guarda 4).
   *
   * NATIVOS por `fpFields.padrao` + o campo de natureza pela camada de compatibilidade. Montado
   * SOB DEMANDA e não no nível do módulo: `fp_fields` faz `file.load` e `search` para resolver o
   * perfil, e pagar isso no load de todo script — inclusive nos saves que a guarda 3 vai descartar
   * — seria custo de governança em troca de nada.
   */
  /**
   * O QUE IMPORTA PARA A SIMULAÇÃO = O QUE O MAPEADOR MANDA.
   *
   * ⚠ Estas listas já foram escritas à mão, com sete nomes, e envelheceram na primeira leva de
   * campos novos: habilitar a guarda daquele jeito faria a simulação PULAR depois de alguém trocar
   * o CFOP ou a modalidade do frete — a tela mostraria o imposto de antes, sem erro nenhum.
   *
   * Agora saem do perfil, pela mesma convenção da limpeza da cópia: tudo em `transacao` que NÃO é
   * `DOC_*` (resultado do motor) nem `CORRID` (infraestrutura) é declaração, e declaração muda
   * imposto. Campo novo entra na comparação sozinho.
   */
  function camposRelevantes(tipo) {
    var l = [
      fpFields.padrao('ENTITY'),
      fpFields.padrao('SUBSIDIARY'),
      fpFields.padrao('LOCATION'),
      fpFields.padrao('TRANDATE'),
      'shippingcost',
      'handlingcost',
      'discounttotal'
    ];

    var chaves = fpFields.chaves('transacao');
    for (var i = 0; i < chaves.length; i++) {
      if (chaves[i].indexOf('DOC_') === 0 || chaves[i] === 'CORRID') continue;
      var id = fpFields.id(chaves[i]);
      if (id) l.push(id);
    }

    // Na COMPRA a chave é DECLARAÇÃO de quem lança (a nota do fornecedor), não retorno do motor:
    // trocá-la muda o que vai ao `reclassificar`, então ela conta como mudança.
    if (fpMapSimular.ehCompra(tipo) && fpFields.id('DOC_CHAVE')) l.push(fpFields.id('DOC_CHAVE'));
    return l;
  }

  function camposLinhaRelevantes() {
    var l = ['item', 'quantity', 'rate', 'amount', 'units', fpFields.padrao('LOCATION')];

    var chaves = fpFields.chaves('linha');
    for (var i = 0; i < chaves.length; i++) {
      var id = fpFields.idLinha(chaves[i]);
      if (id) l.push(id);
    }
    return l;
  }

  /**
   * As sublistas que o payload lê: DI, pagamento, volume e reboque.
   *
   * Comparar só a CONTAGEM deixaria passar a edição de uma linha existente — trocar o número da DI
   * sem acrescentar linha. Por isso a comparação é por VALOR, montando uma assinatura de tudo que
   * o mapeador leria. É tudo em memória, sem ida ao banco.
   */
  function assinaturaDasSublistas(registro) {
    var GRUPOS = [
      { secao: 'di', acessor: fpFields.idDi },
      { secao: 'pagamento', acessor: fpFields.idPagamento },
      { secao: 'volume', acessor: fpFields.idVolume },
      { secao: 'reboque', acessor: fpFields.idReboque }
    ];

    var partes = [];
    for (var g = 0; g < GRUPOS.length; g++) {
      var acessor = GRUPOS[g].acessor;
      var sublist = acessor('SUBLIST');
      if (!sublist) continue;

      var total = registro.getLineCount({ sublistId: sublist });
      if (total <= 0) { partes.push(sublist + ':0'); continue; }

      var chaves = fpFields.chaves(GRUPOS[g].secao);
      for (var i = 0; i < total; i++) {
        for (var k = 0; k < chaves.length; k++) {
          if (chaves[k] === 'SUBLIST') continue;
          var campo = acessor(chaves[k]);
          if (!campo) continue;
          partes.push(registro.getSublistValue({ sublistId: sublist, fieldId: campo, line: i }));
        }
      }
    }
    return partes.join('|');
  }

  function beforeSubmit(scriptContext) {
    // PRIMEIRA LINHA, e a ordem importa: o id de correlação tem de existir antes de qualquer
    // coisa que possa lançar. É a correção do defeito do AVLR — ver o docblock de `fp_msg.js`.
    var corrId;

    try {
      corrId = fpMsg.garantirCorrId(scriptContext.newRecord);

      if (!deveRodar(scriptContext)) return;

      var payload = fpMapSimular.montar(scriptContext.newRecord);

      // O mapeador devolve null quando falta dado de identidade (sem entity, sem linha, sem
      // subsidiária mapeada para filial). Não é erro: é transação que ainda não tem o que simular.
      if (!payload) return;

      var resposta = fpClient.simularNota(payload, {
        subsidiaria: scriptContext.newRecord.getValue({ fieldId: fpFields.padrao('SUBSIDIARY') }),
        transacao: scriptContext.newRecord.id,
        corrId: corrId
      });
      log.debug('resposta', resposta)
      // GUARDAR O PAYLOAD ENVIADO, sempre, e ANTES de olhar o resultado. Sem ele, "o motor errou"
      // e "eu mandei errado" são indistinguíveis — e a segunda é a hipótese mais frequente.
      //
      // Vai para ARQUIVO, não para campo: nota de centenas de linhas produz um payload de dezenas
      // de milhares de caracteres, e campo texto trunca em silêncio — o pior jeito de perder
      // justamente a prova do que foi enviado. O anexo acontece no `afterSubmit`, porque na
      // CRIAÇÃO a transação ainda não tem id e `record.attach` não teria a que anexar.
      guardarRastro(corrId, { payload: payload, resposta: null });

      // ENTRADA — compra com chave de acesso declarada. Roda antes de olhar a simulação: a
      // recusa da simulação não impede declarar a natureza da nota que existe.
      var opcoesRede = {
        subsidiaria: scriptContext.newRecord.getValue({ fieldId: fpFields.padrao('SUBSIDIARY') }),
        transacao: scriptContext.newRecord.id,
        corrId: corrId
      };
      var entrada = rodarEntrada(scriptContext.newRecord, payload, resposta, opcoesRede);
      if (entrada && entrada.aplicada) {
        guardarRastro(corrId, { payload: payload, resposta: resposta.body, entrada: entrada.rastro });
        fpMsg.sucesso(corrId, '');
        if (entrada.avisos.length) fpMsg.aviso(corrId, entrada.avisos);
        log.audit('fp_ue_simular.entrada', 'natureza declarada · ' + entrada.diferentes + ' diferença(s) documento × simulação');
        return;
      }
      if (entrada) {
        guardarRastro(corrId, { payload: payload, resposta: resposta.body, entrada: entrada.rastro });
        if (entrada.erro) fpMsg.erro(corrId, fpMsg.ORIGEM.FISCALPLATFORM, entrada.erro.code, entrada.erro.mensagens);
        if (entrada.avisos.length) fpMsg.aviso(corrId, entrada.avisos);
      }

      if (!resposta.ok) {
        // RECUSA DO MOTOR. O texto dele vai INTEIRO para a tela — sem traduzir, sem resumir.
        guardarRastro(corrId, { payload: payload, resposta: resposta.body, entrada: entrada && entrada.rastro });

        fpMsg.erro(corrId, fpMsg.ORIGEM.FISCALPLATFORM, resposta.code, mensagensDaRecusa(resposta.body));
        log.error('fp_ue_simular.recusa', { code: resposta.code, body: resposta.body });
        return;
      }

      // SUCESSO. Os valores do motor são REFLETIDOS, não conferidos: o NetSuite não recalcula para
      // checar. Divergência se investiga no payload gravado acima.
      fpMapSimular.aplicar(scriptContext.newRecord, resposta.body);

      guardarRastro(corrId, { payload: payload, resposta: resposta.body, entrada: entrada && entrada.rastro });

      // Sem resumo: o que foi apurado está no sublist, linha por linha. Contar linha na
      // mensagem é ruído que cresce junto com a nota.
      fpMsg.sucesso(corrId, '');

      // O `avisos[]` do motor é canal dele, e ausência é significativa: `undefined` quer dizer
      // "esta resposta não avaliou avisos", não "não há aviso". Só pinta quando veio com conteúdo.
      if (resposta.body && resposta.body.avisos && resposta.body.avisos.length) {
        fpMsg.aviso(corrId, resposta.body.avisos);
      }

      // A governança da execução sai no fim, pelo `fp_governanca`.
      log.audit('fp_ue_simular', 'ok em ' + resposta.durationMs + 'ms');
    } catch (e) {
      // GUARDA 1 — o save NÃO cai. Nem falha de rede, nem defeito do mapeador, nem governança.
      log.error('fp_ue_simular.beforeSubmit', { name: e.name, message: e.message, stack: e.stack });

      // O corrId pode não existir se a exceção subiu dentro do próprio `garantirCorrId`.
      // Recupera (ou cria) antes de gravar a mensagem, senão ela vai para uma chave que o
      // `beforeLoad` não lê e o usuário não vê erro nenhum.
      if (!corrId) {
        try {
          corrId = fpMsg.garantirCorrId(scriptContext.newRecord);
        } catch (e2) {
          log.error('fp_ue_simular.beforeSubmit', 'sem corrId: mensagem não será pintada');
        }
      }

      if (corrId) fpMsg.excecao(corrId, e);

    }
  }

  /**
   * A NATUREZA DA COMPRA VAI À PLATAFORMA — quando a compra declarou a chave da nota do fornecedor.
   *
   *   sem chave               → `null`: é a compra comum, e a simulação segue sozinha
   *   chave ainda não chegou  → a simulação vira PRÉVIA na sublista, e um aviso diz para salvar de
   *                             novo quando o DF-e trouxer a nota
   *   chave capturada         → `reclassificar`; a SUBLISTA recebe o DOCUMENTO (o que o fornecedor
   *                             destacou, reprocessado), e a simulação fica só para a comparação
   *   reclassificar recusado  → o texto da plataforma inteiro, e a simulação como prévia
   *
   * A comparação não tem veredito (ver `fp_entrada`): mostra os dois valores onde diferem.
   */
  function rodarEntrada(newRecord, payloadSim, respostaSim, opcoes) {
    var reclass = fpMapSimular.montarReclassificar(newRecord);
    if (!reclass) return null;

    var r = { aplicada: false, avisos: [], erro: null, diferentes: 0, rastro: { payload: reclass } };

    // A CHAVE ANTES DA REDE (`fp_chave`, o mesmo validador da tela). Aqui não se bloqueia o save —
    // guarda 1 —, mas chave inválida ou duplicada NÃO vai à plataforma. Sem tipo de documento de
    // TERCEIRO com modelo, não é nota de fornecedor, e a entrada não roda.
    var v = fpChave.validar(newRecord);
    r.rastro.validacao = v;
    if (!v.aplica) {
      r.avisos.push('Chave de acesso informada, mas o tipo de documento não é de terceiro com modelo (NF-e ou CT-e de ' +
        'terceiro). A natureza NÃO foi declarada à plataforma.');
      return r;
    }
    if (!v.podeSalvar) {
      r.avisos = r.avisos.concat(v.erros).concat(v.avisos);
      r.avisos.push('A natureza NÃO foi declarada: a chave não passou na validação.');
      return r;
    }
    r.avisos = r.avisos.concat(v.avisos);
    // Série e número saem da chave — também na criação por REST, que não tem tela.
    if (fpFields.id('DOC_SERIE')) newRecord.setValue({ fieldId: fpFields.id('DOC_SERIE'), value: String(v.serie) });
    if (fpFields.id('DOC_NUMERO')) newRecord.setValue({ fieldId: fpFields.id('DOC_NUMERO'), value: v.numero });

    var existe = fpClient.existePorChave(reclass.chaveAcesso, payloadSim.cnpjEmpresa, opcoes);
    r.rastro.existe = existe.body;
    if (!existe.ok) {
      r.erro = { code: existe.code, mensagens: mensagensDaRecusa(existe.body) };
      return r;
    }
    if (!existe.body || !existe.body.existe) {
      r.avisos.push('A nota ' + reclass.chaveAcesso + ' ainda não foi capturada pela plataforma (DF-e). ' +
        'A natureza NÃO foi declarada; o que está na sublista é a simulação. Salve de novo quando a nota chegar.');
      return r;
    }

    var resposta = fpClient.reclassificar(reclass, opcoes);
    r.rastro.resposta = resposta.body;
    if (!resposta.ok) {
      r.erro = { code: resposta.code, mensagens: mensagensDaRecusa(resposta.body) };
      return r;
    }

    fpMapSimular.aplicar(newRecord, resposta.body);
    r.aplicada = true;

    if (respostaSim && respostaSim.ok) {
      var cmp = fpEntrada.comparar(resposta.body, respostaSim.body);
      r.rastro.comparacao = cmp.quadro;
      r.diferentes = cmp.diferentes.length;
      if (cmp.diferentes.length) {
        r.avisos.push(cmp.diferentes.length + ' tributo(s) com valor diferente entre a nota do fornecedor e a ' +
          'simulação desta compra — os dois lados, sem veredito:');
        r.avisos = r.avisos.concat(fpEntrada.descrever(cmp.diferentes, 10));
      }
    } else {
      r.avisos.push('A simulação desta compra não voltou, então não há comparação com a nota do fornecedor.');
    }
    return r;
  }

  /**
   * Tipo de documento e natureza da operação **logo depois do campo `memo`**, nessa ordem.
   *
   * Por que esses dois e não os outros: são o que o usuário DECLARA — o dado que só o ERP tem.
   * Ficam na aba principal, ao lado dos campos que ele já preenche, sem troca de aba. Todo o
   * RETORNO (chave, número, série, status, cStat, xMotivo, protocolo, XML, DANFE, simulação)
   * mora no subtab `custtab_fp_fiscal` por atribuição declarativa no XML — é consulta, não
   * digitação, e não disputa espaço com o cabeçalho da nota.
   *
   * A cadeia de âncoras existe porque `memo` não está em todo formulário customizado; caindo para
   * `entity`/`trandate`, os dois campos ainda ficam num lugar previsível em vez de irem para o fim.
   */
  /**
   * CÓPIA NÃO HERDA DOCUMENTO FISCAL.
   *
   * "Make Copy" duplica todo campo de corpo, inclusive chave de acesso, protocolo e status — e
   * duas transações passariam a exibir a MESMA nota. Uma delas seria mentira, e nada no NetSuite
   * acusaria: os campos são texto.
   *
   * ⚠ E há um efeito pior que a exibição errada: com `DOC_STATUS` copiado como `AUTORIZADA`, a
   * guarda 6 do `beforeSubmit` recusaria simular a cópia — ela nasceria sem imposto nenhum, sem
   * erro, e o usuário só descobriria na hora de emitir.
   *
   * O `corrId` também sai: ele endereça a mensagem de tela da transação ORIGINAL.
   *
   * Roda no `beforeLoad`, antes de o formulário ser desenhado, que é o único momento em que se
   * limpa um registro não gravado sem um segundo submit.
   */
  function limparNaCopia(scriptContext) {
    if (scriptContext.type !== scriptContext.UserEventType.COPY) return;
    if (TIPOS.indexOf(scriptContext.newRecord.type) === -1) return;

    // ⚠ A LISTA NÃO É CHUMBADA, e a diferença importa: campo novo de resultado nasce no perfil
    // com o prefixo `DOC_` e passa a ser limpo SEM que ninguém lembre de vir aqui. Lista escrita
    // à mão envelheceria no primeiro campo que a Reforma trouxer, e o sintoma seria a cópia
    // exibindo o documento da original — em silêncio.
    //
    // A convenção é o contrato: **todo campo que o MOTOR devolve chama-se `DOC_*` no perfil**.
    // O que o ERP DECLARA — natureza, tipo de documento, frete — não leva o prefixo, e fica: é
    // decisão de quem abriu a transação, não resultado do documento.
    var chaves = fpFields.chaves('transacao');

    var limpos = 0;
    for (var i = 0; i < chaves.length; i++) {
      if (chaves[i].indexOf('DOC_') !== 0 && chaves[i] !== 'CORRID') continue;

      var campo = fpFields.id(chaves[i]);
      if (!campo) continue;
      scriptContext.newRecord.setValue({ fieldId: campo, value: '' });
      limpos++;
    }

    var anexos = removerAnexosDoBundle(scriptContext.newRecord);

    log.audit('fp_ue_simular.limparNaCopia',
      'cópia de ' + scriptContext.newRecord.type + ': ' + limpos + ' campo(s) fiscal(is) e ' +
      anexos + ' anexo(s) do bundle removidos. A cópia é um documento novo.');
  }

  /**
   * NOSSO ARQUIVO, e a FORMA inteira do nome — não só o prefixo.
   *
   * ⚠ `FP-` sozinho é critério perigoso: é curto, é sigla comum, e um anexo do usuário chamado
   * `FP-relatorio.pdf` ou `FP-2026.xlsx` seria apagado na cópia sem nada acusar. Apagar arquivo
   * de terceiro é o tipo de erro que só aparece quando alguém procura o documento e ele não está
   * mais lá.
   *
   * O bundle gera exatamente `FP-<tipo>-<id>-<o que é>.json`, e é essa forma que o padrão exige:
   * tipo em letras, id em dígitos, extensão `.json`. `FP-relatorio.pdf` não casa; nem
   * `FP-invoice-nota.json`, que não tem id.
   *
   * O id no nome é o da transação ORIGINAL — a cópia ainda não tem id no `beforeLoad` —, então o
   * padrão não pode amarrar no id desta, e não amarra.
   */
  var NOSSO_ANEXO = /^FP-[a-z]+-\d+-[a-z-]+\.json$/;

  function removerAnexosDoBundle(novoRegistro) {
    var total = novoRegistro.getLineCount({ sublistId: 'mediaitem' });
    if (total <= 0) return 0;

    // Os ids de TODOS os anexos, os nomes numa consulta, e só então a remoção — sem
    // `getSublistText`, que lança em registro criado por REST (MEDICOES §18).
    var ids = [];
    for (var j = 0; j < total; j++) {
      var idArq = novoRegistro.getSublistValue({ sublistId: 'mediaitem', fieldId: 'mediaitem', line: j });
      if (idArq) ids.push(String(idArq));
    }
    if (!ids.length) return 0;
    var nomes = {};
    var r = query.runSuiteQL({
      query: 'SELECT id, name FROM file WHERE id IN (' + ids.map(function () { return '?'; }).join(',') + ')',
      params: ids
    }).asMappedResults();
    for (var k = 0; k < r.length; k++) nomes[String(r[k].id)] = String(r[k].name || '');

    var removidos = 0;
    for (var i = total - 1; i >= 0; i--) {
      var nome = nomes[String(novoRegistro.getSublistValue({ sublistId: 'mediaitem', fieldId: 'mediaitem', line: i }))] || '';

      if (NOSSO_ANEXO.test(nome)) {
        novoRegistro.removeLine({ sublistId: 'mediaitem', line: i });
        removidos++;
      }
    }
    return removidos;
  }

  function organizarFormulario(scriptContext) {
    if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
    if (TIPOS.indexOf(scriptContext.newRecord.type) === -1) return;

    var declarados = [];
    var tipodoc = fpFields.id('TIPODOC');
    var natureza = fpFields.id('NATUREZA');
    if (tipodoc) declarados.push(tipodoc);
    if (natureza) declarados.push(natureza);
    if (!declarados.length) return;

    var ancoras = [
      fpFields.padrao('MEMO'),
      fpFields.padrao('ENTITY'),
      fpFields.padrao('TRANDATE')
    ];

    var usada = fpForm.posicionarDepoisDaPrimeiraAncora(scriptContext.form, ancoras, declarados);
    log.debug('fp_ue_simular.organizarFormulario',
      'ancora=' + usada + ' campos=[' + declarados.join(', ') + ']');

    // ⚠ ORGANIZAR A SUBABA EM RUNTIME NÃO É POSSÍVEL, e agora está medido em vez de suposto.
    //
    // Três tentativas, três telas brancas: campo `FieldType.URL` com endereço relativo, campo
    // `INLINEHTML` com `container`, e `addFieldGroup` + `insertField` para criar seções. Nenhuma
    // caiu no `try/catch` — o formulário só é desenhado DEPOIS que o `beforeLoad` retorna, então o
    // sintoma é "An unexpected error has occurred" sem uma linha no log.
    //
    // A causa é documentada: **`insertField` só move campo criado pelo PRÓPRIO `beforeLoad`**, e
    // **mover campo entre abas não é suportado**. Grupo de campos é outro container, então levar
    // um `custbody_fp_*` — que nasce do objeto SDF — para dentro dele é exatamente a operação
    // proibida. O `posicionarDepoisDaPrimeiraAncora` acima funciona porque reordena DENTRO da
    // mesma aba, sem trocar de container.
    //
    // A organização vem do OBJETO: subabas ANINHADAS (`<parent>` no XML do subtab) e o `<subtab>`
    // de cada campo. Quem monta é o NetSuite, e não quebra.

    var chavedoc = fpFields.id('DOC_CHAVE');
    var numerodoc = fpFields.id('DOC_NUMERO');
    var seriedoc = fpFields.id('DOC_SERIE');
    var statusdoc = fpFields.id('DOC_STATUS');
    var cstatdoc = fpFields.id('DOC_CSTAT');
    var motivodoc = fpFields.id('DOC_XMOTIVO');
    var protocolodoc = fpFields.id('DOC_PROTOCOLO');
    var idexternodoc = fpFields.id('DOC_IDEXTERNO');
    var xmldoc = fpFields.id('DOC_XML');
    var danfedoc = fpFields.id('DOC_DANFE');
    

    // A CHAVE ABRE NA ENTRADA: na compra quem lança digita a chave da nota do fornecedor. No resto
    // ela é retorno da emissão, e fica travada.
    if (!fpMapSimular.ehCompra(scriptContext.newRecord.type)) {
      scriptContext.form.getField(chavedoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    } else {
      // Na compra, o validador da chave na tela (fp_cs_entrada, portado do AVLR_AccessKeyValidation_CS).
      var T = scriptContext.UserEventType;
      if (scriptContext.type === T.CREATE || scriptContext.type === T.EDIT || scriptContext.type === T.COPY) {
        scriptContext.form.clientScriptModulePath = './fp_cs_entrada.js';
      }
    }
    scriptContext.form.getField(numerodoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(seriedoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(statusdoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(cstatdoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(motivodoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(protocolodoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(idexternodoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(xmldoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    scriptContext.form.getField(danfedoc).updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
    
  }

  // ─────────────────────────────────────────────────────────────────────────────

  /** `AUTORIZADA`, `CANCELADA`, `DENEGADA` — os três em que o documento existe na SEFAZ. */
  function jaTransmitido(novoRegistro) {
    var campo = fpFields.id('DOC_STATUS');
    if (!campo) return false;

    var status = String(novoRegistro.getValue({ fieldId: campo }) || '').toUpperCase();
    if (!status) return false;

    if (['AUTORIZADA', 'CANCELADA', 'DENEGADA'].indexOf(status) === -1) return false;

    log.audit('fp_ue_simular',
      'documento ' + status + ' — simulação não roda. Os tributos da transação são os que foram ' +
      'transmitidos; recalcular faria o sublist divergir do XML que está na SEFAZ.');
    return true;
  }

  function deveRodar(scriptContext) {
    if (TIPOS.indexOf(scriptContext.newRecord.type) === -1) return false;

    if (scriptContext.type !== scriptContext.UserEventType.CREATE &&
        scriptContext.type !== scriptContext.UserEventType.EDIT) return false;

    // GUARDA 3
    if (contextosBloqueados().indexOf(runtime.executionContext) > -1) {
      log.debug('fp_ue_simular', 'pulado em ' + runtime.executionContext);
      return false;
    }

    // GUARDA 6 — DOCUMENTO JÁ TRANSMITIDO NÃO SIMULA MAIS.
    //
    // Os tributos de uma nota autorizada são os que FORAM TRANSMITIDOS: eles estão no XML
    // assinado que a SEFAZ guarda. Recalcular depois disso sobrescreveria o sublist com um
    // resultado que a régua de hoje produz — e régua muda, convênio muda, cadastro muda. O
    // NetSuite passaria a mostrar um imposto que a nota não tem, sem erro nenhum, e a
    // divergência só apareceria na conciliação ou na fiscalização.
    //
    // REJEITADA não entra na lista, e é de propósito: ela não existe na SEFAZ, o número dela
    // não foi consumido e o caminho normal é corrigir o cadastro e emitir de novo — o que exige
    // simular de novo.
    if (jaTransmitido(scriptContext.newRecord)) return false;

    // GUARDA 4 — SÓ NO EDIT: no CREATE não há `oldRecord` com que comparar.
    //
    // É a economia que mais rende: save que não mexeu em nada fiscal não chama o motor, não gasta
    // governança e não espera a rede. É o mesmo princípio do `notCalculate` do AvaTax, que lê o
    // JSON anterior em vez de recalcular — mas comparando os CAMPOS, e não um sinalizador de
    // cache sobre a tela.
    //
    // O que torna isso seguro é a lista vir do perfil: tudo que o mapeador manda é comparado,
    // inclusive as quatro sublistas. Lista escrita à mão aqui faria a simulação pular uma mudança
    // de verdade, e o usuário veria o imposto de antes sem erro nenhum.
    if (scriptContext.type === scriptContext.UserEventType.EDIT &&
        !mudouAlgoRelevante(scriptContext)) {
      log.audit('fp_ue_simular', 'nada fiscalmente relevante mudou — sem chamada ao motor.');
      return false;
    }

    return true;
  }

  function mudouAlgoRelevante(scriptContext) {
    var antigo = scriptContext.oldRecord;
    var novo = scriptContext.newRecord;
    if (!antigo) return true;

    var campos = camposRelevantes(novo.type);
    var camposLinha = camposLinhaRelevantes();

    var i;
    for (i = 0; i < campos.length; i++) {
      if (!iguais(valor(antigo, campos[i]), valor(novo, campos[i]))) return true;
    }

    var linhasAntes = contarLinhas(antigo);
    var linhasDepois = contarLinhas(novo);
    if (linhasAntes !== linhasDepois) return true;

    for (i = 0; i < linhasDepois; i++) {
      for (var j = 0; j < camposLinha.length; j++) {
        var campo = camposLinha[j];
        if (!iguais(valorLinha(antigo, campo, i), valorLinha(novo, campo, i))) return true;
      }
    }

    return assinaturaDasSublistas(antigo) !== assinaturaDasSublistas(novo);
  }

  /**
   * Comparação por texto, deliberadamente.
   *
   * Quantidade e valor voltam do NetSuite ora como número, ora como string, dependendo de o
   * registro ser dinâmico ou não. Comparar com `!==` daria "mudou" em todo save, e a guarda 4
   * viraria decoração.
   */
  function iguais(a, b) {
    var na = a === null || a === undefined ? '' : String(a);
    var nb = b === null || b === undefined ? '' : String(b);
    return na === nb;
  }

  function valor(registro, campo) {
    return registro.getValue({ fieldId: campo });
  
  }

  function valorLinha(registro, campo, linha) {
    return registro.getSublistValue({ sublistId: 'item', fieldId: campo, line: linha });
  
  }

  function contarLinhas(registro) {
    return registro.getLineCount({ sublistId: 'item' });
  
  }

  /**
   * Extrai as mensagens da recusa do motor SEM interpretá-las.
   *
   * O NestJS devolve `message` como string ou como array (erro de validação do class-validator).
   * Formato desconhecido cai no `JSON.stringify` do corpo inteiro: mostrar o corpo bruto é pior
   * para os olhos e melhor para o diagnóstico do que esconder o que não soubemos ler.
   */
  function mensagensDaRecusa(corpo) {
    if (!corpo) return ['Sem corpo na resposta.'];
    if (typeof corpo === 'string') return [corpo];

    if (Array.isArray(corpo.message)) return corpo.message;
    if (corpo.message) return [String(corpo.message)];
    if (corpo.error) return [String(corpo.error)];

    return [JSON.stringify(corpo)];
  }

  /**
   * UM `try` só, e ele termina no BANNER, não num diálogo do NetSuite.
   *
   * A transação já está gravada quando isto roda: o que der errado aqui não desfaz nada, e o
   * usuário precisa LER o motivo, não receber a tela vermelha de erro de script.
   *
   * O rastro é anexado ANTES do idExterno de propósito. São independentes, e com um `catch` só o
   * primeiro que falhar interrompe o outro — então vem primeiro o que é PROVA: sem o payload
   * gravado, "o motor errou" e "eu mandei errado" ficam indistinguíveis.
   */
  function afterSubmit(scriptContext) {
    var corrId;

    try {
      // Primeiro o corrId, porque sem ele a mensagem vai para uma chave que o `beforeLoad` não lê
      // e o usuário não vê erro nenhum. Só LEITURA: o registro já foi gravado, e o valor que vale
      // é o que o `beforeSubmit` escreveu.
      corrId = scriptContext.newRecord.getValue({ fieldId: fpFields.id('CORRID') });

      var id = scriptContext.newRecord.id;
      anexarRastro(scriptContext.newRecord, id);

      record.submitFields({
        type: scriptContext.newRecord.type,
        id: id,
        values: montarValores(fpFields.id('DOC_IDEXTERNO'), id),
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });
    } catch (e) {
      log.error('fp_ue_simular.afterSubmit', { name: e.name, message: e.message, stack: e.stack });
      if (corrId) fpMsg.excecao(corrId, e);
    }
  }

  /** Guarda na sessão. Serializa aqui para o `afterSubmit` só precisar ler e gravar. */
  function guardarRastro(corrId, dados) {
    if (!corrId) return;
    runtime.getCurrentSession().set({
      name: chaveRastro(corrId),
      value: JSON.stringify(dados)
    });
  
  }

  /**
   * Grava payload e retorno como ARQUIVO e anexa à transação.
   *
   * Por que arquivo e não campo: nota de 999 linhas produz um payload de dezenas de milhares de
   * caracteres. Campo texto do NetSuite trunca em silêncio, e o que se perderia é exatamente a
   * prova de que a divergência foi do envio e não do motor — a hipótese mais frequente.
   *
   * A PASTA vem do parâmetro `custscript_fp_pasta_payload` — INTEGER com o internal id da pasta,
   * preferência de empresa. **Em branco não anexa**, e o log diz por quê: espalhar arquivo numa
   * pasta que ninguém escolheu é pior que não anexar.
   */
  function anexarRastro(newRecord, id) {
    if (!id) return;

    var corrId = newRecord.getValue({ fieldId: fpFields.id('CORRID') });
    log.debug('corrId', corrId)
    if (!corrId) return;

    var sessao = runtime.getCurrentSession();
    var bruto = sessao.get({ name: chaveRastro(corrId) });
    log.debug('bruto', bruto)
    if (!bruto) return;

    // Limpa ANTES de anexar: falha no anexo não pode deixar o rastro preso na sessão para o
    // próximo save da mesma aba encontrar e anexar de novo, agora na transação errada.
    sessao.set({ name: chaveRastro(corrId), value: '' });

    // INTEGER, não select: `file.create` quer o internal id da pasta, e o id da pasta não vive no
    // mesmo espaço de numeração do tipo de registro. `getParameter` de INTEGER devolve número.
    var pasta = runtime.getCurrentScript().getParameter({ name: 'custscript_fp_pasta_payload' });
    if (!pasta) {
      log.audit('fp_ue_simular.anexarRastro',
        'parâmetro "Pasta do Payload" não definido nas Preferências da Empresa — payload e ' +
        'retorno NÃO foram anexados. Sem eles, "o motor errou" e "eu mandei errado" ficam ' +
        'indistinguíveis.');
      return;
    }

    var rastro = JSON.parse(bruto);
    log.debug("json", rastro)
    var tipo = newRecord.type;

    // NOME SÓ COM O ID DA TRANSAÇÃO, sem carimbo de hora: mesmo nome na mesma pasta faz o File
    // Cabinet SUBSTITUIR o arquivo. Com carimbo, cada save deixava um par novo — dezesseis
    // arquivos numa tarde de teste. O que interessa é o último payload, não o histórico deles.
    anexar(pasta, tipo, id, 'FP-' + tipo + '-' + id + '-payload.json', rastro.payload);
    if (rastro.resposta) {
      anexar(pasta, tipo, id, 'FP-' + tipo + '-' + id + '-retorno.json', rastro.resposta);
    }

    // ENTRADA: o corpo do reclassificar, o que voltou e o quadro documento × simulação.
    var e = rastro.entrada;
    if (e) {
      var base = 'FP-' + tipo + '-' + id + '-reclassificar-';
      anexar(pasta, tipo, id, base + 'payload.json', e.payload);
      anexar(pasta, tipo, id, base + 'retorno.json', { existe: e.existe || null, resposta: e.resposta || null });
      if (e.comparacao) anexar(pasta, tipo, id, 'FP-' + tipo + '-' + id + '-comparacao.json', e.comparacao);
    }
  }

  function anexar(pasta, tipo, id, nome, conteudo) {
    var arquivo = file.create({
      name: nome,
      fileType: file.Type.JSON,
      contents: JSON.stringify(conteudo, null, 1),
      folder: pasta,
      isOnline: false
    });

    var idArquivo = arquivo.save();

    // Substituindo o arquivo, o id é o mesmo e ele já está anexado. Reanexar não pode derrubar
    // o afterSubmit de um save que já deu certo.
    record.attach({
      record: { type: 'file', id: idArquivo },
      to: { type: tipo, id: id }
    });
  

    log.audit('fp_ue_simular.anexar', nome + ' (file ' + idArquivo + ')');
  }

  /** `{ campo: valor }` sem chave dinâmica no literal, que o SuiteScript 1.0 não aceitava. */
  function montarValores(campo, valor) {
    var v = {};
    if (campo) v[campo] = valor;
    return v;
  }

  // A GOVERNANÇA É MEDIDA NO FIM DE TODA EXECUÇÃO — `fp_governanca` no Execution Log.
  return {
    beforeLoad: function (c) { return fpGovernanca.medir('fp_ue_simular.beforeLoad ' + c.type, function () { return beforeLoad(c); }); },
    beforeSubmit: function (c) { return fpGovernanca.medir('fp_ue_simular.beforeSubmit ' + c.type, function () { return beforeSubmit(c); }); },
    afterSubmit: function (c) { return fpGovernanca.medir('fp_ue_simular.afterSubmit ' + c.type, function () { return afterSubmit(c); }); }
  };
});
