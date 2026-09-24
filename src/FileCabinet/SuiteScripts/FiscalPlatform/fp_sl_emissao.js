/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * EMISSÃO E CONSULTA DO DOCUMENTO FISCAL. Ato explícito, fora do save.
 *
 * ── POR QUE SUITELET, E NÃO USER EVENT ─────────────────────────────────────────────────────────
 *
 * Emissão **consome numeração** e é irreversível: o número é reservado de forma atômica, a nota é
 * assinada e transmitida na mesma chamada, e quando a resposta volta o número já foi gasto. Isso
 * não pode ser efeito colateral de um save — alguém corrigindo o endereço de uma nota queimaria
 * um número por clique. Por isso a emissão é um botão, e o botão passa por uma confirmação.
 *
 * O `/simular` é o contrário: roda no `beforeSubmit` porque é de graça e não consome nada.
 *
 * ── AS DUAS PASSADAS ───────────────────────────────────────────────────────────────────────────
 *
 * `GET` monta a tela de confirmação, e ela mostra o que vai ser emitido. `POST` emite. Não existe
 * caminho que emita em `GET`: link visitado de novo, botão "voltar" do navegador e pré-carregador
 * de navegador são todos `GET`, e qualquer um deles gastaria número.
 *
 * ── IDEMPOTÊNCIA, E POR QUE REENVIAR É SEGURO ──────────────────────────────────────────────────
 *
 * O `idExterno` é o **internal id da transação** — identidade estável, não tentativa nem
 * timestamp. Reenviar o mesmo devolve o documento anterior, inclusive se ele foi rejeitado, sem
 * gastar número novo. É por ele também que se endereça o documento nos endpoints de evento: o
 * UUID da plataforma não entra no NetSuite.
 *
 * ── SEM `try/catch` NAS AUXILIARES ─────────────────────────────────────────────────────────────
 *
 * Um `try` só, no `onRequest`, que é o ponto de entrada. O erro vira texto na própria tela — aqui
 * não há banner de transação para pintar, e a tela do Suitelet é o lugar onde o usuário está
 * olhando.
 */
define(['N/ui/serverWidget', 'N/record', 'N/redirect', 'N/runtime', 'N/log',
  './fp_fields', './fp_client', './fp_md_map_simular', './fp_persist'],
  function (serverWidget, record, redirect, runtime, log, fpFields, fpClient, fpMap, fpPersist) {

    var ACOES = { EMITIR: 'emitir', CONSULTAR: 'consultar', RECONCILIAR: 'reconciliar' };

    function onRequest(contexto) {
      try {
        var p = contexto.request.parameters;
        var tipo = p.tipo;
        var id = p.id;
        var acao = p.acao || ACOES.EMITIR;

        if (!tipo || !id) {
          return escrever(contexto, pagina('Faltou parâmetro',
            'A tela precisa de <b>tipo</b> e <b>id</b> da transação. Abra pelo botão da transação.'));
        }

        if (contexto.request.method === 'GET') {
          return contexto.response.writePage(telaDeConfirmacao(tipo, id, acao));
        }

        return json(contexto, executar(tipo, id, acao));
      } catch (e) {
        log.error('fp_sl_emissao', { name: e.name, message: e.message, stack: e.stack });

        if (contexto.request.method === 'GET') {
          return escrever(contexto, pagina('Não deu',
            '<b>' + escapar(e.name || 'Erro') + '</b><br>' + escapar(e.message || String(e))));
        }
        return json(contexto, {
          ok: false,
          titulo: e.name || 'Erro',
          mensagem: (e.message || String(e)) +
            ' · Nada foi emitido. O erro inteiro está no log de execução do script.'
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET — confirmação
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * A tela mostra o que o motor vai receber, não um resumo bonito.
     *
     * Quem confirma precisa ver o CNPJ da filial, a série e o destinatário — é aí que erro de
     * cadastro aparece ANTES de gastar número, que é o único momento em que sai barato.
     */
    function telaDeConfirmacao(tipo, id, acao) {
      var form = serverWidget.createForm({ title: titulo(acao) });

      var rec = record.load({ type: tipo, id: id });
      var chave = valor(rec, fpFields.id('DOC_CHAVE'));

      esconder(form, [
        { id: 'custpage_tipo', valor: tipo },
        { id: 'custpage_id', valor: String(id) },
        { id: 'custpage_acao', valor: acao }
      ]);

      if (acao === ACOES.EMITIR) {
        var payload = fpMap.montarEmissao(rec);

        if (!payload) {
          html(form, 'custpage_aviso',
            '<b>Esta transação ainda não pode ser emitida.</b><p>Falta série na Location, tipo de ' +
            'documento na transação, ou dado de identidade do destinatário. O motivo exato está no ' +
            'log de execução do <i>fp_md_map_simular</i>.</p>');
          return form;
        }

        if (chave) {
          html(form, 'custpage_jaemitida',
            '<b>Esta transação já tem chave de acesso.</b><p><code>' + escapar(chave) + '</code></p>' +
            '<p>Emitir de novo NÃO gera número novo: o <code>idExterno</code> é o id desta ' +
            'transação, e a plataforma devolve o documento que já existe. Use <i>Consultar</i> se ' +
            'o que você quer é o desfecho atualizado.</p>');
        }

        html(form, 'custpage_resumo', resumo(payload));
        form.addSubmitButton({ label: chave ? 'Reenviar mesmo assim' : 'Emitir agora' });
      } else {
        html(form, 'custpage_resumo',
          '<b>' + escapar(titulo(acao)) + '</b><p>Documento: <code>' +
          escapar(chave || ('idExterno ' + id)) + '</code></p>' +
          '<p>Esta ação <b>não</b> consome numeração.</p>');
        form.addSubmitButton({ label: 'Confirmar' });
      }

      form.addButton({ id: 'custpage_voltar', label: 'Voltar', functionName: 'history.back()' });
      return form;
    }

    /**
     * O resumo é derivado do PAYLOAD, não relido da transação.
     *
     * Ler a transação de novo para a tela mostraria uma coisa e mandaria outra quando o mapeador
     * descartasse um campo — e é justamente o descarte silencioso que a tela existe para expor.
     */
    function resumo(payload) {
      var d = payload.destinatario || {};
      var linhas = payload.linhas || [];
      var total = 0;
      for (var i = 0; i < linhas.length; i++) total += Number(linhas[i].valorTotal || 0);

      return '<table style="border-spacing:0 4px">' +
        tr('Filial (CNPJ)', payload.cnpjEmpresa) +
        tr('Série', payload.serie) +
        tr('Tipo de documento', payload.tipoDocumento) +
        tr('idExterno', payload.idExterno) +
        tr('Natureza declarada', payload.naturezaOperacaoId || '(o motor resolve pelo CFOP)') +
        tr('Destinatário', d.nome) +
        tr('CNPJ/CPF', d.cnpjCpf) +
        tr('IE / indIeDest', (d.ie || '—') + ' / ' + (d.indIeDest || '—')) +
        tr('Município / UF', (d.municipio || '—') + ' / ' + (d.uf || '—')) +
        tr('Linhas', String(linhas.length)) +
        tr('Total dos produtos', total.toFixed(2)) +
        '</table>' +
        '<p style="margin-top:12px"><b>Emitir reserva o número, assina e transmite à SEFAZ na ' +
        'mesma chamada.</b> Quando a resposta voltar, o número já foi gasto.</p>';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST — executa
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Devolve DADO, não página.
     *
     * Quem chama é o botão da transação, por `https.post.promise` — ele quer `{ok, status, ...}`
     * para pintar o resultado sem sair da tela. Página montada aqui voltaria como um HTML inteiro
     * de formulário do NetSuite dentro do `responseText`, que não se lê nem se aproveita.
     */
    function executar(tipo, id, acao) {
      var rec = record.load({ type: tipo, id: id });
      var subsidiaria = rec.getValue({ fieldId: fpFields.padrao('SUBSIDIARY') });
      var opcoes = { subsidiaria: subsidiaria, transacao: id, pasta: pastaDoAnexo() };

      var resposta = acao === ACOES.EMITIR
        ? emitir(rec, id, opcoes)
        : consultarOuReconciliar(rec, id, acao, opcoes);

      if (!resposta.ok) {
        // O TEXTO DO MOTOR VAI INTEIRO. Traduzir ou resumir rejeição da SEFAZ é o jeito mais
        // rápido de esconder o cStat, que é a única coisa que quem opera consegue pesquisar.
        log.error('fp_sl_emissao.recusa', { acao: acao, code: resposta.code, body: resposta.body });
        return {
          ok: false,
          titulo: 'Recusado (HTTP ' + resposta.code + ')',
          mensagem: typeof resposta.body === 'string'
            ? resposta.body
            : JSON.stringify(resposta.body, null, 2)
        };
      }

      var doc = resposta.body;
      var gravado = fpPersist.aplicar(tipo, id, doc, opcoes);

      return {
        ok: true,
        titulo: titulo(acao) + ': ' + (doc.status || 'sem status'),
        status: doc.status || '',
        cStat: doc.cStat || '',
        xMotivo: doc.xMotivo || '',
        chaveAcesso: doc.chaveAcesso || '',
        numero: doc.numero || '',
        serie: doc.serie || '',
        protocolo: doc.nProt || '',
        ambiente: doc.ambiente || '',
        arquivos: (gravado && gravado.arquivos) || []
      };
    }

    /**
     * ⚠ SEM RETRY, e não é esquecimento.
     *
     * Repetir uma emissão cega é o jeito clássico de gastar dois números para uma nota. Timeout
     * sem resposta se resolve por `reconciliar` pela chave, ou por reenviar o MESMO `idExterno`,
     * que a plataforma responde com o documento que já existe.
     */
    function emitir(rec, id, opcoes) {
      var payload = fpMap.montarEmissao(rec);
      if (!payload) {
        return { ok: false, code: 0, body: { erro: 'payload não montou — ver o log do mapeador' } };
      }

      // O idExterno é a identidade estável da transação. Se o mapeador não achou, é aqui que ele
      // nasce — nunca de tentativa, nunca de timestamp, ou a idempotência deixa de existir.
      if (!payload.idExterno) payload.idExterno = String(id);

      log.audit('fp_sl_emissao.emitir',
        'EMITINDO idExterno=' + payload.idExterno + ' série=' + payload.serie +
        ' tipo=' + payload.tipoDocumento + ' — consome numeração');

      return fpClient.emitir(payload, opcoes);
    }

    /** Endereçado pelo `idExterno`, que é o id da transação — o ERP nunca viu o UUID. */
    function consultarOuReconciliar(rec, id, acao, opcoes) {
      if (acao === ACOES.RECONCILIAR) {
        var chave = valor(rec, fpFields.id('DOC_CHAVE'));
        if (!chave) {
          return { ok: false, code: 0, body: { erro: 'sem chave de acesso: nada a reconciliar' } };
        }
        return fpClient.postar('/fiscal/nfe/' + chave + '/reconciliar', null, opcoes);
      }
      return fpClient.postar('/fiscal/emitir/' + id + '/consultar', null, opcoes);
    }

    // ─────────────────────────────────────────────────────────────────────────

    /** Mesma pasta do rastro de payload — parâmetro de empresa, não de deployment. */
    function pastaDoAnexo() {
      return runtime.getCurrentScript().getParameter({ name: 'custscript_fp_pasta_doc' });
    }

    function titulo(acao) {
      if (acao === ACOES.CONSULTAR) return 'Consultar desfecho na SEFAZ';
      if (acao === ACOES.RECONCILIAR) return 'Reconciliar pela chave';
      return 'Emitir documento fiscal';
    }

    function pagina(titulo, corpo) {
      var form = serverWidget.createForm({ title: titulo });
      html(form, 'custpage_corpo', corpo);
      return form;
    }

    function escrever(contexto, form) {
      contexto.response.writePage(form);
    }

    function json(contexto, dado) {
      contexto.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      contexto.response.write({ output: JSON.stringify(dado) });
    }

    function html(form, id, conteudo) {
      form.addField({ id: id, type: serverWidget.FieldType.INLINEHTML, label: ' ' })
        .defaultValue = conteudo;
    }

    function esconder(form, campos) {
      for (var i = 0; i < campos.length; i++) {
        var c = form.addField({
          id: campos[i].id, type: serverWidget.FieldType.TEXT, label: campos[i].id
        });
        c.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        c.defaultValue = campos[i].valor;
      }
    }

    function valor(rec, campo) {
      return campo ? (rec.getValue({ fieldId: campo }) || '') : '';
    }

    function tr(rotulo, v) {
      return '<tr><td style="padding-right:16px;color:#666">' + escapar(rotulo) +
        '</td><td><b>' + escapar(v === null || v === undefined || v === '' ? '—' : String(v)) +
        '</b></td></tr>';
    }

    function escapar(s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { onRequest: onRequest };
  });
