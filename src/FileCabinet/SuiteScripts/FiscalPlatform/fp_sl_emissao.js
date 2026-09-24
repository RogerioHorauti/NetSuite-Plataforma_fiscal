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
 * ── ENDPOINT, NÃO TELA ─────────────────────────────────────────────────────────────────────────
 *
 * Responde **JSON**, e só a `POST`. Quem desenha é o botão da transação, que chama por
 * `https.post.promise` e pinta o resultado sem sair do registro — página montada aqui voltaria
 * como um HTML inteiro de formulário do NetSuite dentro do `responseText`.
 *
 * `GET` não emite, e não é descuido: link revisitado, botão "voltar" do navegador e pré-carregador
 * são todos `GET`, e qualquer um deles gastaria número.
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
 * Um `try` só, no `onRequest`, que é o ponto de entrada. O erro volta como `{ok:false, mensagem}`
 * e o botão o pinta na transação — aqui não há banner para pintar, e quem está olhando é a tela
 * de onde o usuário clicou.
 */
define(['N/record', 'N/file', 'N/runtime', 'N/log',
  './fp_fields', './fp_client', './fp_md_map_simular', './fp_persist'],
  function (record, file, runtime, log, fpFields, fpClient, fpMap, fpPersist) {

    var ACOES = { EMITIR: 'emitir', CONSULTAR: 'consultar', RECONCILIAR: 'reconciliar', XML: 'xml' };

    function onRequest(contexto) {
      try {
        var p = contexto.request.parameters;

        // BAIXAR O XML É GET, e tem de ser: download é navegação do navegador, não XHR. Ele não
        // emite, não grava e não consome nada — só repassa o arquivo que está na plataforma.
        if (p.acao === ACOES.XML) {
          return baixarXml(contexto, p.tipo, p.id);
        }

        // O RESTO É SÓ POST. Emitir por GET não existe de propósito: link revisitado, botão
        // "voltar" do navegador e pré-carregador são todos GET, e qualquer um deles gastaria
        // número.
        if (contexto.request.method !== 'POST') {
          return json(contexto, {
            ok: false,
            titulo: 'Use o botão da transação',
            mensagem: 'Esta tela só responde a POST.'
          });
        }

        if (!p.tipo || !p.id) {
          return json(contexto, {
            ok: false,
            titulo: 'Faltou parâmetro',
            mensagem: 'A chamada precisa de "tipo" e "id" da transação.'
          });
        }

        return json(contexto, executar(p.tipo, p.id, p.acao || ACOES.EMITIR));
      } catch (e) {
        log.error('fp_sl_emissao', { name: e.name, message: e.message, stack: e.stack });
        return json(contexto, {
          ok: false,
          titulo: e.name || 'Erro',
          mensagem: (e.message || String(e)) +
            ' · Nada foi emitido. O erro inteiro está no log de execução do script.'
        });
      }
    }

    /**
     * O XML AUTORIZADO, DIRETO PARA A MÁQUINA DE QUEM PEDIU.
     *
     * Ele mora na plataforma. O Suitelet busca por HTTPS e repassa como download — não grava no
     * File Cabinet, e por isso não precisa de pasta, não deixa cópia e não some quando alguém
     * reorganiza o cabinet.
     *
     * `file.create` SEM `save()`: o objeto existe só em memória para o `writeFile`. Salvar criaria
     * o arquivo no cabinet, que é exatamente o que este caminho evita.
     */
    function baixarXml(contexto, tipo, id) {
      var rec = record.load({ type: tipo, id: id });
      var chave = valor(rec, fpFields.id('DOC_CHAVE'));

      if (!chave) {
        return json(contexto, {
          ok: false,
          titulo: 'Sem documento',
          mensagem: 'Esta transação não tem chave de acesso — não há XML para baixar.'
        });
      }

      var subsidiaria = rec.getValue({ fieldId: fpFields.padrao('SUBSIDIARY') });
      var r = fpClient.baixar('/fiscal/nfe/' + chave + '/xml', { subsidiaria: subsidiaria });

      if (!r.ok || !r.corpo) {
        log.error('fp_sl_emissao.baixarXml', 'chave ' + chave + ' devolveu ' + r.code);
        return json(contexto, {
          ok: false,
          titulo: 'XML não veio (HTTP ' + r.code + ')',
          mensagem: 'A plataforma não devolveu o XML da chave ' + chave + '.'
        });
      }

      contexto.response.writeFile({
        file: file.create({
          name: 'NFe-' + chave + '.xml',
          fileType: file.Type.XMLDOC,
          contents: r.corpo
        }),
        isInline: false
      });
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

      // O payload viaja em `opcoes` para chegar à persistência: ele é gravado JUNTO do retorno,
      // e é o que se confere quando o motor recusa.
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

      opcoes.payload = payload;

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
    function json(contexto, dado) {
      contexto.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      contexto.response.write({ output: JSON.stringify(dado) });
    }
    function valor(rec, campo) {
      return campo ? (rec.getValue({ fieldId: campo }) || '') : '';
    }

    return { onRequest: onRequest };
  });
