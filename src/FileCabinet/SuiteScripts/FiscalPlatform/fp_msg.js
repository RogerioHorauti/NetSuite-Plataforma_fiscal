/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * RESPOSTA SÍNCRONA AO USUÁRIO A PARTIR DO `beforeSubmit`.
 *
 * O problema: `beforeSubmit` é o único lugar em que se grava campo na transação sem um segundo
 * submit, mas ele NÃO tem tela — não existe `form` ali, então não há como pintar mensagem. E o
 * `beforeLoad` que tem tela roda ANTES, no load do formulário, não depois do save.
 *
 * O mecanismo (o mesmo do `AVLR_SuiteTax_UE` / `AVLR_SuiteTax_Functions.messageError`):
 *
 *   1. `beforeSubmit`, PRIMEIRA linha: gera um id de correlação e grava no PRÓPRIO registro
 *      (`custbody_fp_corrid`). Ele viaja com o save.
 *   2. `beforeSubmit`: chama a API, e põe o resultado na SESSÃO do usuário, na chave
 *      `<canal><corrid>`.
 *   3. o save termina e o NetSuite RE-RENDERIZA o registro → dispara `beforeLoad`, que agora tem
 *      `form`. Ele lê o corrid DO REGISTRO (é o mesmo do save que acabou), busca a sessão e pinta
 *      `form.addPageInitMessage()`.
 *   4. a chave é ZERADA depois de pintar: a mensagem aparece uma vez, e não cola no registro.
 *
 * DIVERGÊNCIAS DELIBERADAS do AVLR, cada uma com motivo:
 *
 *   · `garantirCorrId()` em vez de ler a variável local. No AVLR, o `catch` do `beforeSubmit` usa
 *     `_randomString`, que fica `undefined` se a exceção subiu antes do `setControlString` — a
 *     chave vira `errorresponseundefined`, o renderizador procura outra, e o ERRO É ENGOLIDO EM
 *     SILÊNCIO. É o caminho que mais precisa de mensagem. Aqui o corrid é recuperado do registro
 *     e, se não houver, criado na hora.
 *   · TTL de 120 s no envelope. Sem ele, uma chave que nunca foi pintada (usuário deu "voltar" no
 *     navegador) fica na sessão e aparece num load futuro como se fosse de agora.
 *   · `escaparHtml` no dado interpolado. A mensagem vai para HTML; nome de destinatário e texto de
 *     cadastro entram nela. O nosso markup fica, o dado é escapado.
 *
 * O QUE NÃO SE MEXE: o texto do motor. `cStat` + `xMotivo` vão INTEIROS para a tela, sem traduzir
 * nem resumir. Rejeição é quase sempre cadastro, e quem opera precisa do texto da SEFAZ, não da
 * nossa interpretação dele.
 */
define(['N/runtime', 'N/ui/message', 'N/log', './fp_fields'], function (runtime, message, log, fpFields) {
  /**
   * Resolvido pela camada de compatibilidade, não literal — nenhum módulo do bundle escreve
   * scriptid direto (ver `fp_fields.js`).
   *
   * `CORRID` é a única chave que NUNCA será mapeada em perfil de terceiro: é mecanismo nosso, não
   * tem equivalente em bundle nenhum, e não deveria ter. Por isso resolve sempre para o id do
   * perfil `original` — mas resolve PELA camada, para que este arquivo continue sem literal.
   */
  function campoCorrId() {
    return fpFields.id('CORRID');
  }

  /** Canais na sessão. Um por severidade — a precedência de pintura está em `pintar`. */
  var CANAL = {
    ERRO: 'fp_erro_',
    AVISO: 'fp_aviso_',
    SUCESSO: 'fp_sucesso_'
  };

  /**
   * ORIGEM DA FALHA, e é o campo mais útil da mensagem inteira.
   *
   * `FISCALPLATFORM` = o motor recusou o documento (HTTP != 2xx com corpo dele). Quase sempre
   * cadastro: destinatário sem IE, NCM ausente, filial sem certificado.
   * `NETSUITE` = o nosso código quebrou antes de o motor opinar. Mapeador, campo inexistente,
   * governança.
   *
   * Sem esta distinção na tela, "deu erro no fiscal" manda o usuário abrir chamado para o lado
   * errado — e a hipótese mais frequente é a segunda.
   */
  var ORIGEM = {
    FISCALPLATFORM: 'FISCALPLATFORM',
    NETSUITE: 'NETSUITE'
  };

  var TTL_MS = 120000;

  var TITULO = {
    pt_BR: 'FiscalPlatform',
    en: 'FiscalPlatform'
  };

  function rotuloOrigem(origem, lang) {
    if (origem === ORIGEM.FISCALPLATFORM) {
      return lang === 'pt_BR' ? 'MENSAGEM DO FISCALPLATFORM' : 'FISCALPLATFORM MESSAGE';
    }
    return lang === 'pt_BR' ? 'MENSAGEM DO NETSUITE' : 'NETSUITE MESSAGE';
  }

  function idAleatorio(tamanho) {
    var mascara = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var r = '';
    for (var i = 0; i < tamanho; i++) r += mascara.charAt(Math.floor(Math.random() * mascara.length));
    return r;
  }

  function escaparHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Garante que o registro carrega um id de correlação, e devolve ele.
   *
   * Chamada na PRIMEIRA linha do `beforeSubmit` (cria) e de novo dentro do `catch` (recupera). É a
   * correção do defeito do AVLR: no caminho de exceção o id tem de existir, senão a mensagem de
   * erro é gravada numa chave que ninguém lê.
   *
   * @param {Record} novoRegistro scriptContext.newRecord
   * @returns {string}
   */
  function garantirCorrId(novoRegistro) {
    var campo = campoCorrId();
    if (!campo) {
      log.error('fp_msg.garantirCorrId', 'CORRID não resolve em perfil nenhum — mensagem não será pintada');
      return idAleatorio(32);
    }

    var atual;
    atual = novoRegistro.getValue({ fieldId: campo });
  
    if (atual) return atual;

    var novo = idAleatorio(32);
    novoRegistro.setValue({ fieldId: campo, value: novo });
    return novo;
  }

  function guardar(canal, corrId, conteudo) {
    if (!corrId) return;
    var sessao = runtime.getCurrentSession();
    sessao.set({
      name: canal + corrId,
      value: JSON.stringify({ t: new Date().getTime(), html: conteudo })
    });
  }

  function ler(canal, corrId) {
    if (!corrId) return null;
    var bruto = runtime.getCurrentSession().get({ name: canal + corrId });
    if (!bruto) return null;

    var env;
    env = JSON.parse(bruto);
  
    // TTL: chave que nunca foi pintada não reaparece num load futuro como se fosse de agora.
    if (!env || !env.t || new Date().getTime() - env.t > TTL_MS) return null;
    return env.html || null;
  }

  function limpar(canal, corrId) {
    if (!corrId) return;
    runtime.getCurrentSession().set({ name: canal + corrId, value: '' });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // API de escrita — chamada do `beforeSubmit` / do Suitelet
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Sucesso, com um resumo curto. O detalhe do tributo vai para os campos do registro, não para
   * a mensagem: o usuário lê o valor na linha, não num popup.
   *
   * @param {string} corrId
   * @param {string} resumo texto simples (será escapado)
   */
  function sucesso(corrId, resumo) {
    var lang = idioma();
    var cabecalho = lang === 'pt_BR' ? 'Impostos simulados com sucesso.' : 'Taxes simulated successfully.';
    var html = '<b>' + cabecalho + '</b>';
    if (resumo) html += '<br>' + escaparHtml(resumo);
    guardar(CANAL.SUCESSO, corrId, html);
  }

  /**
   * Recusa do motor. `linhas` são as mensagens tal como vieram — uma por item quando o motor
   * detalha por linha.
   *
   * @param {string} corrId
   * @param {string} origem ORIGEM.FISCALPLATFORM | ORIGEM.NETSUITE
   * @param {number|string} httpStatus
   * @param {string[]|string} mensagens texto do motor, INTEIRO
   */
  function erro(corrId, origem, httpStatus, mensagens) {
    var lang = idioma();
    var lista = Array.isArray(mensagens) ? mensagens : [mensagens];

    var html = '<b>' + rotuloOrigem(origem, lang) + '</b>';
    if (httpStatus) html += ' (HTTP ' + escaparHtml(httpStatus) + ')';
    html += '<br>';

    if (lista.length === 1) {
      html += escaparHtml(lista[0]);
    } else {
      html += '<ul>';
      for (var i = 0; i < lista.length; i++) html += '<li>' + escaparHtml(lista[i]) + '</li>';
      html += '</ul>';
    }
    guardar(CANAL.ERRO, corrId, html);
  }

  /**
   * Exceção do nosso próprio código. Sobe `name` e `message`; o `stack` fica no log, não na tela —
   * stack em popup não ajuda quem opera e esconde a frase que ajuda.
   *
   * @param {string} corrId
   * @param {Error} e
   */
  function excecao(corrId, e) {
    var lang = idioma();
    var texto = (e && (e.message || e.name)) || String(e);
    var complemento =
      lang === 'pt_BR'
        ? 'A transação foi salva. A simulação de imposto não foi aplicada.'
        : 'The transaction was saved. Tax simulation was not applied.';
    erro(corrId, ORIGEM.NETSUITE, null, [texto, complemento]);
  }

  /**
   * Aviso: o motor respondeu, mas com ressalva — o `avisos[]` do retorno, ou a indisponibilidade
   * que não impediu o save.
   */
  function aviso(corrId, mensagens) {
    var lista = Array.isArray(mensagens) ? mensagens : [mensagens];
    var html = '<ul>';
    for (var i = 0; i < lista.length; i++) html += '<li>' + escaparHtml(lista[i]) + '</li>';
    html += '</ul>';
    guardar(CANAL.AVISO, corrId, html);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // API de leitura — chamada do `beforeLoad`
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Pinta na tela o que o save anterior deixou na sessão, e zera o que pintou.
   *
   * PRECEDÊNCIA: erro vence tudo (e leva os avisos junto, porque quem errou quer ver o resto);
   * depois aviso; por último sucesso. Nunca dois `addPageInitMessage` — o segundo cobre o
   * primeiro, e o usuário lê o menos importante.
   *
   * SÓ EM `USERINTERFACE`. Em CSVIMPORT/WEBSERVICES/MAPREDUCE não há tela e não há sessão de
   * usuário para ler.
   *
   * @param {Object} scriptContext contexto do beforeLoad (precisa de `form` e `newRecord`)
   */
  function pintar(scriptContext) {
    if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;

    var form = scriptContext.form;
    if (!form) return;

    var campo = campoCorrId();
    if (!campo) return;

    var corrId;
    corrId = scriptContext.newRecord.getValue({ fieldId: campo });
  
    if (!corrId) return;

    var lang = idioma();
    var titulo = TITULO[lang] || TITULO.en;

    var htmlErro = ler(CANAL.ERRO, corrId);
    var htmlAviso = ler(CANAL.AVISO, corrId);
    var htmlSucesso = ler(CANAL.SUCESSO, corrId);

    if (htmlErro) {
      form.addPageInitMessage({
        type: message.Type.ERROR,
        title: titulo,
        message: htmlErro + (htmlAviso || '')
      });
      limpar(CANAL.ERRO, corrId);
      limpar(CANAL.AVISO, corrId);
      limpar(CANAL.SUCESSO, corrId);
      return;
    }

    if (htmlAviso) {
      form.addPageInitMessage({
        type: message.Type.WARNING,
        title: titulo,
        message: (htmlSucesso ? htmlSucesso + '<br>' : '') + htmlAviso
      });
      limpar(CANAL.AVISO, corrId);
      limpar(CANAL.SUCESSO, corrId);
      return;
    }

    if (htmlSucesso) {
      form.addPageInitMessage({
        type: message.Type.CONFIRMATION,
        title: titulo,
        message: htmlSucesso
      });
      limpar(CANAL.SUCESSO, corrId);
    }
  }

  function idioma() {
    return runtime.getCurrentUser().getPreference({ name: 'LANGUAGE' });
  
  }

  return {
    campoCorrId: campoCorrId,
    ORIGEM: ORIGEM,
    garantirCorrId: garantirCorrId,
    sucesso: sucesso,
    aviso: aviso,
    erro: erro,
    excecao: excecao,
    pintar: pintar
  };
});
