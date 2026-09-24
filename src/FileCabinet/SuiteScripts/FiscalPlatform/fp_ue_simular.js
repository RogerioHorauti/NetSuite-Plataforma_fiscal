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
 * ── AS CINCO GUARDAS, e nenhuma é opcional ──────────────────────────────────────────────────────
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
  'N/record',
  'N/file',
  'N/runtime',
  'N/log',
  './fp_msg',
  './fp_fields',
  './fp_form',
  './fp_client',
  './fp_md_map_simular'
], function (record, file, runtime, log, fpMsg, fpFields, fpForm, fpClient, fpMapSimular) {
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

  function beforeLoad(scriptContext) {
    organizarFormulario(scriptContext);
  

    fpMsg.pintar(scriptContext);
  
  }

  /**
   * Campos de cabeçalho cuja mudança justifica simular de novo (guarda 4).
   *
   * NATIVOS por `fpFields.padrao` + o campo de natureza pela camada de compatibilidade. Montado
   * SOB DEMANDA e não no nível do módulo: `fp_fields` faz `file.load` e `search` para resolver o
   * perfil, e pagar isso no load de todo script — inclusive nos saves que a guarda 3 vai descartar
   * — seria custo de governança em troca de nada.
   */
  function camposRelevantes() {
    var l = [
      fpFields.padrao('ENTITY'),
      fpFields.padrao('SUBSIDIARY'),
      fpFields.padrao('LOCATION'),
      fpFields.padrao('TRANDATE'),
      'shippingcost',
      'handlingcost',
      'discounttotal'
    ];
    var natureza = fpFields.id('NATUREZA');
    if (natureza) l.push(natureza);
    return l;
  }

  /** Campos de linha cuja mudança justifica simular de novo (guarda 4). */
  function camposLinhaRelevantes() {
    var l = ['item', 'quantity', 'rate', 'amount', fpFields.padrao('LOCATION')];
    var natureza = fpFields.idLinha('LINHA_NATUREZA');
    if (natureza) l.push(natureza);
    return l;
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

      if (!resposta.ok) {
        // RECUSA DO MOTOR. O texto dele vai INTEIRO para a tela — sem traduzir, sem resumir.
        guardarRastro(corrId, { payload: payload, resposta: resposta.body });

        fpMsg.erro(corrId, fpMsg.ORIGEM.FISCALPLATFORM, resposta.code, mensagensDaRecusa(resposta.body));
        log.error('fp_ue_simular.recusa', { code: resposta.code, body: resposta.body });
        return;
      }

      // SUCESSO. Os valores do motor são REFLETIDOS, não conferidos: o NetSuite não recalcula para
      // checar. Divergência se investiga no payload gravado acima.
      fpMapSimular.aplicar(scriptContext.newRecord, resposta.body);

      guardarRastro(corrId, { payload: payload, resposta: resposta.body });

      // Sem resumo: o que foi apurado está no sublist, linha por linha. Contar linha na
      // mensagem é ruído que cresce junto com a nota.
      fpMsg.sucesso(corrId, '');

      // O `avisos[]` do motor é canal dele, e ausência é significativa: `undefined` quer dizer
      // "esta resposta não avaliou avisos", não "não há aviso". Só pinta quando veio com conteúdo.
      if (resposta.body && resposta.body.avisos && resposta.body.avisos.length) {
        fpMsg.aviso(corrId, resposta.body.avisos);
      }

      log.audit('fp_ue_simular', 'ok em ' + resposta.durationMs + 'ms · governança restante: ' +
        runtime.getCurrentScript().getRemainingUsage());
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
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function deveRodar(scriptContext) {
    if (TIPOS.indexOf(scriptContext.newRecord.type) === -1) return false;

    if (scriptContext.type !== scriptContext.UserEventType.CREATE &&
        scriptContext.type !== scriptContext.UserEventType.EDIT) return false;

    // GUARDA 3
    if (contextosBloqueados().indexOf(runtime.executionContext) > -1) {
      log.debug('fp_ue_simular', 'pulado em ' + runtime.executionContext);
      return false;
    }

    // GUARDA 4 — só no EDIT: no CREATE não há `oldRecord` com que comparar.
    // if (scriptContext.type === scriptContext.UserEventType.EDIT && !mudouAlgoRelevante(scriptContext)) {
    //   log.debug('fp_ue_simular', 'nada fiscalmente relevante mudou — sem chamada');
    //   return false;
    // }

    return true;
  }

  function mudouAlgoRelevante(scriptContext) {
    var antigo = scriptContext.oldRecord;
    var novo = scriptContext.newRecord;
    if (!antigo) return true;

    var campos = camposRelevantes();
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

    return false;
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

  function afterSubmit(scriptContext) {
    var id = scriptContext.newRecord.id;
    var campoIdExterno = fpFields.id('DOC_IDEXTERNO');
    log.debug('campoIdExterno', campoIdExterno)
    try {
      record.submitFields({
        type: scriptContext.newRecord.type,
        id: id,
        values: montarValores(campoIdExterno, id),
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });
    } catch (e) {
      log.error('fp_ue_simular.afterSubmit/idExterno', { name: e.name, message: e.message });
    }

    try {
      anexarRastro(scriptContext.newRecord, id);
    } catch (e) {
      // Anexo é PROVA, não parte do save. Falhar aqui não pode desfazer nada do que já gravou.
      log.error('fp_ue_simular.afterSubmit/rastro', { name: e.name, message: e.message });
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

  return {
    beforeLoad: beforeLoad,
    beforeSubmit: beforeSubmit,
    afterSubmit: afterSubmit
  };
});
