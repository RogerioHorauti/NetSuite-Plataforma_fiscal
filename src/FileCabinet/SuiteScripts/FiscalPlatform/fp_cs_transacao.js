/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 *
 * O BOTÃO DE EMISSÃO: confirma, chama o Suitelet e mostra o resultado sem sair da transação.
 *
 * ── POR QUE `https.post.promise`, E NÃO ABRIR OUTRA ABA ────────────────────────────────────────
 *
 * Emitir leva o tempo da SEFAZ. Abrindo uma aba, o usuário olha para uma página em branco sem
 * saber se está emitindo, se travou ou se ele clicou errado — e a reação natural a uma tela parada
 * é clicar de novo. Aqui a tela ANUNCIA o que está acontecendo e o botão some enquanto espera.
 *
 * `promise` e não a chamada síncrona: `https.post` síncrono em client script CONGELA o navegador
 * inteiro até a resposta, e são dezenas de segundos — a janela fica sem responder e o Chrome
 * oferece matar a aba. Com promise, o overlay desenha e a página continua viva.
 *
 * ── O `catch` É O PONTO DE ENTRADA AQUI ────────────────────────────────────────────────────────
 *
 * Auxiliar não engole erro neste bundle. Em código assíncrono, o `.catch` da promessa É o ponto de
 * entrada — é ele que transforma a falha em texto na tela, que é o que o usuário precisa ler.
 *
 * ── SEM REGISTRO DE SCRIPT ─────────────────────────────────────────────────────────────────────
 *
 * Anexado por `form.clientScriptModulePath` no `beforeLoad`. Um objeto SDF a menos, e um
 * deployment a menos para alguém reapontar por engano.
 */
define(['N/https'], function (https) {

  var CAIXA = 'fp_caixa_emissao';

  /**
   * @param {string} url    o Suitelet já com `tipo`, `id` e `acao`
   * @param {string} rotulo o que dizer enquanto espera
   * @param {boolean} consome se a ação gasta numeração — só aí se pergunta
   */
  function acionar(url, rotulo, consome) {
    // if (consome && !window.confirm(
    //   'Emitir reserva o número, assina e transmite à SEFAZ na mesma chamada.\n\n' +
    //   'Quando a resposta voltar, o número já foi gasto. Continuar?')) {
    //   return;
    // }

    abrir(rotulo + '…', girando());

    https.post.promise({
      url: url,
      body: '{}',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(function (resposta) {
        // 200 com corpo que não é JSON quer dizer que a sessão caiu e o NetSuite devolveu a tela
        // de login no lugar da resposta. Dizer "erro inesperado" aqui mandaria o usuário procurar
        // defeito no lugar errado.
        var dado;
        try {
          dado = JSON.parse(resposta.body);
        } catch (e) {
          return pintarErro('Resposta ilegível (HTTP ' + resposta.code + ')',
            'O Suitelet não devolveu JSON. A causa comum é sessão expirada: abra a transação de ' +
            'novo e repita. Nada foi emitido por esta tela.');
        }

        if (!dado.ok) return pintarErro(dado.titulo || 'Recusado', dado.mensagem || '');
        return pintarOk(dado);
      })
      .catch(function (e) {
        pintarErro('A chamada falhou', (e && (e.message || e.name)) || String(e));
      });
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function pintarOk(d) {
    var linhas =
      linha('Status', d.status) +
      linha('cStat / xMotivo', (d.cStat || '—') + ' — ' + (d.xMotivo || '—')) +
      linha('Chave de acesso', d.chaveAcesso) +
      linha('Número / Série', (d.numero || '—') + ' / ' + (d.serie || '—')) +
      linha('Protocolo', d.protocolo) +
      linha('Ambiente', d.ambiente) +
      linha('Arquivos', (d.arquivos && d.arquivos.length) ? d.arquivos.join(', ') : 'nenhum');

    // RECARREGAR NÃO É AUTOMÁTICO: a chave e o protocolo já estão gravados, e recarregar sozinho
    // apagaria da tela o cStat e o xMotivo antes de o usuário ler — que é justamente o que
    // interessa quando a SEFAZ recusa por motivo de cadastro.
    corpo(d.titulo || 'Pronto',
      '<table style="border-spacing:0 6px">' + linhas + '</table>' +
      '<p style="margin-top:14px">' + botao('Fechar e recarregar', 'location.reload()') +
      ' ' + botao('Fechar', 'document.getElementById(\'' + CAIXA + '\').remove()') + '</p>');
  }

  function pintarErro(titulo, mensagem) {
    corpo(titulo,
      '<pre style="white-space:pre-wrap;max-height:40vh;overflow:auto;background:#f6f6f6;' +
      'padding:10px;border-radius:4px">' + escapar(mensagem) + '</pre>' +
      '<p>' + botao('Fechar', 'document.getElementById(\'' + CAIXA + '\').remove()') + '</p>');
  }

  /**
   * O círculo girando, em CSS puro.
   *
   * Nada de GIF nem de imagem do File Cabinet: arquivo some, pasta muda de id, e uma imagem
   * quebrada no meio da emissão é pior que espera nenhuma. `@keyframes` precisa de um `<style>`
   * de verdade — `animation` em atributo `style` inline não roda —, e por isso ele é injetado uma
   * vez e fica.
   */
  function girando() {
    if (!document.getElementById(CAIXA + '_css')) {
      var css = document.createElement('style');
      css.id = CAIXA + '_css';
      css.textContent =
        '@keyframes ' + CAIXA + '_giro{to{transform:rotate(360deg)}}' +
        '#' + CAIXA + ' .fp_giro{width:38px;height:38px;margin:14px auto;border-radius:50%;' +
        'border:4px solid #e0e0e0;border-top-color:#607d8b;' +
        'animation:' + CAIXA + '_giro .8s linear infinite}';
      document.head.appendChild(css);
    }
    return '<div class="fp_giro"></div>';
  }

  function abrir(titulo, html) {
    var velha = document.getElementById(CAIXA);
    if (velha) velha.remove();

    var div = document.createElement('div');
    div.id = CAIXA;
    div.setAttribute('style',
      'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);' +
      'display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif');
    div.innerHTML =
      '<div style="background:#fff;border-radius:6px;padding:22px 26px;min-width:380px;' +
      'max-width:720px;box-shadow:0 8px 30px rgba(0,0,0,.35)">' +
      '<div id="' + CAIXA + '_t" style="font-size:15px;font-weight:bold;margin-bottom:10px"></div>' +
      '<div id="' + CAIXA + '_c" style="font-size:13px;color:#333"></div></div>';
    document.body.appendChild(div);
    corpo(titulo, html);
  }

  function corpo(titulo, html) {
    var t = document.getElementById(CAIXA + '_t');
    var c = document.getElementById(CAIXA + '_c');
    if (!t || !c) return;
    t.textContent = titulo;
    c.innerHTML = html;
  }

  function linha(rotulo, v) {
    return '<tr><td style="padding-right:18px;color:#666">' + escapar(rotulo) +
      '</td><td><b>' + escapar(v === null || v === undefined || v === '' ? '—' : String(v)) +
      '</b></td></tr>';
  }

  function botao(rotulo, acao) {
    return '<button type="button" onclick="' + acao + '" ' +
      'style="padding:6px 14px;cursor:pointer">' + escapar(rotulo) + '</button>';
  }

  function escapar(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Download é NAVEGAÇÃO, não XHR: `https.post.promise` traria o XML para dentro do JavaScript e
   * o arquivo nunca chegaria ao disco. `window.open` deixa o navegador receber o
   * `Content-Disposition` e salvar.
   */
  function baixar(url) {
    window.open(url, '_blank');
  }

  return {
    pageInit: function () {},
    acionar: acionar,
    baixar: baixar
  };
});
