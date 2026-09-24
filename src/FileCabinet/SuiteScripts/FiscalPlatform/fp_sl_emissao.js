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

    var ACOES = {
      EMITIR: 'emitir',
      CONSULTAR: 'consultar',
      RECONCILIAR: 'reconciliar',
      CANCELAR: 'cancelar',
      CARTA: 'carta',
      INUTILIZAR: 'inutilizar',
      XML: 'xml',
      DANFE: 'danfe'
    };

    /**
     * O que cada ação faz depois da emissão — caminho, corpo e rótulo.
     *
     * ⚠ TODAS ENDEREÇAM PELA **CHAVE DE ACESSO**, não pelo `idExterno`. Medido no
     * `endereco-do-documento.pipe`: `UQ_transaction_branch_id_externo :: UNIQUE (branch_id,
     * id_externo)` — o `idExterno` é único POR FILIAL, e como endereço de caminho seria ambíguo
     * entre filiais. A chave não tem esse problema, porque o CNPJ do emitente está dentro dela.
     * O `idExterno` é a chave de IDEMPOTÊNCIA do `POST /emitir`: endereça a INTENÇÃO, não o
     * documento emitido.
     *
     * `campo` é o nome que o DTO espera para o texto que o usuário digitou. Nenhuma delas consome
     * numeração — a inutilização FECHA um número já perdido, não gasta outro.
     */
    var EVENTOS = {
      consultar: { caminho: '/fiscal/emitir/{chave}/consultar', rotulo: 'Consultar desfecho na SEFAZ' },
      reconciliar: { caminho: '/fiscal/nfe/{chave}/reconciliar', rotulo: 'Reconciliar pela chave' },
      cancelar: { caminho: '/fiscal/emitir/{chave}/cancelar', campo: 'justificativa', rotulo: 'Cancelamento' },
      carta: { caminho: '/fiscal/emitir/{chave}/carta-correcao', campo: 'correcao', rotulo: 'Carta de correção' },
      inutilizar: { caminho: '/fiscal/emitir/{chave}/inutilizar', campo: 'justificativa', rotulo: 'Inutilização do número' }
    };

    function onRequest(contexto) {
      try {
        var p = contexto.request.parameters;

        // BAIXAR O XML É GET, e tem de ser: download é navegação do navegador, não XHR. Ele não
        // emite, não grava e não consome nada — só repassa o arquivo que está na plataforma.
        if (p.acao === ACOES.XML || p.acao === ACOES.DANFE) {
          return baixarArquivo(contexto, p.tipo, p.id, p.acao);
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

        return json(contexto, executar(p.tipo, p.id, p.acao || ACOES.EMITIR, textoDoCorpo(contexto)));
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
     * O DOCUMENTO, DIRETO PARA A MÁQUINA DE QUEM PEDIU.
     *
     * Ele mora na plataforma. O Suitelet busca por HTTPS e repassa como download — não grava no
     * File Cabinet, e por isso não precisa de pasta, não deixa cópia e não some quando alguém
     * reorganiza o cabinet.
     *
     * `file.create` SEM `save()`: o objeto existe só em memória para o `writeFile`. Salvar criaria
     * o arquivo no cabinet, que é exatamente o que este caminho evita.
     *
     * ⚠ O PDF DO DANFE NÃO FOI MEDIDO. `https.get` devolve o corpo como STRING, e PDF é binário:
     * pode chegar íntegro ou corrompido, e isso só se sabe com a plataforma no ar. O XML é texto e
     * não tem esse risco. Quando der para medir, ou confirma, ou o caminho do PDF passa a usar
     * base64 — o que não se faz agora é chutar e gravar arquivo que só falha ao abrir.
     */
    function baixarArquivo(contexto, tipo, id, acao) {
      var rec = record.load({ type: tipo, id: id });
      var chave = valor(rec, fpFields.id('DOC_CHAVE'));

      if (!chave) {
        return json(contexto, {
          ok: false,
          titulo: 'Sem documento',
          mensagem: 'Esta transação não tem chave de acesso — não há arquivo para baixar.'
        });
      }

      var pdf = acao === ACOES.DANFE;
      var subsidiaria = rec.getValue({ fieldId: fpFields.padrao('SUBSIDIARY') });
      var r = fpClient.baixar('/fiscal/nfe/' + chave + '/' + (pdf ? 'danfe' : 'xml'),
        { subsidiaria: subsidiaria });

      if (!r.ok || !r.corpo) {
        log.error('fp_sl_emissao.baixarArquivo', acao + ' chave ' + chave + ' devolveu ' + r.code);
        return json(contexto, {
          ok: false,
          titulo: 'Arquivo não veio (HTTP ' + r.code + ')',
          mensagem: 'A plataforma não devolveu o ' + acao + ' da chave ' + chave + '.'
        });
      }

      contexto.response.writeFile({
        file: file.create({
          name: (pdf ? 'DANFE-' : 'NFe-') + chave + (pdf ? '.pdf' : '.xml'),
          fileType: pdf ? file.Type.PDF : file.Type.XMLDOC,
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
    function executar(tipo, id, acao, texto) {
      var rec = record.load({ type: tipo, id: id });
      var subsidiaria = rec.getValue({ fieldId: fpFields.padrao('SUBSIDIARY') });
      var opcoes = { subsidiaria: subsidiaria, transacao: id, pasta: pastaDoAnexo() };

      // O payload viaja em `opcoes` para chegar à persistência: ele é gravado JUNTO do retorno,
      // e é o que se confere quando o motor recusa.
      var resposta = acao === ACOES.EMITIR
        ? emitir(rec, id, opcoes)
        : evento(rec, acao, texto, opcoes);

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

    /**
     * Todo evento do documento emitido: consultar, reconciliar, cancelar, carta de correção,
     * inutilizar. Um só caminho porque a diferença entre eles é o endereço e o campo de texto.
     *
     * Sem chave não há documento emitido, e sem documento não há evento. Recusar aqui é melhor
     * que mandar um caminho com "undefined" e receber 404 da plataforma.
     */
    function evento(rec, acao, texto, opcoes) {
      var cfg = EVENTOS[acao];
      if (!cfg) {
        return { ok: false, code: 0, body: { erro: 'ação desconhecida: ' + acao } };
      }

      var chave = valor(rec, fpFields.id('DOC_CHAVE'));
      if (!chave) {
        return { ok: false, code: 0, body: { erro: 'transação sem chave de acesso: não há documento para ' + acao } };
      }

      var corpo = null;
      if (cfg.campo) {
        if (!texto) {
          return { ok: false, code: 0, body: { erro: cfg.rotulo + ' exige o texto, e ele não veio.' } };
        }
        corpo = montarCorpo(cfg.campo, texto);
      }

      log.audit('fp_sl_emissao.evento', acao + ' · chave ' + chave);
      return fpClient.postar(cfg.caminho.replace('{chave}', chave), corpo, opcoes);
    }

    /** `{ campo: valor }` sem chave dinâmica no literal. */
    function montarCorpo(campo, valor) {
      var c = {};
      c[campo] = valor;
      return c;
    }

    /**
     * O texto que o usuário digitou — justificativa do cancelamento, correção da CC-e.
     *
     * NÃO se valida tamanho aqui. O leiaute exige 15 a 255 (1000 na CC-e), e essa é régua do
     * motor: duplicá-la no ERP cria dois lugares para divergir na próxima NT. Texto curto volta
     * recusado com a mensagem dele, que é mais precisa que qualquer aviso que eu escrevesse.
     */
    function textoDoCorpo(contexto) {
      var corpo = contexto.request.body;
      if (!corpo) return '';
      return String(JSON.parse(corpo).texto || '');
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * A pasta do rastro, igual ao `fp_ue_simular`: parâmetro INTEGER de empresa.
     *
     * ⚠ São DOIS parâmetros para a mesma pasta, e não é descuido: id de parâmetro de script é
     * global no NetSuite, então o Suitelet não pode reusar o `custscript_fp_pasta_payload` do
     * User Event. Os dois precisam ser preenchidos em Preferências da Empresa, com o mesmo id de
     * pasta. Em branco, o rastro NÃO é anexado e o log diz isso.
     */
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
