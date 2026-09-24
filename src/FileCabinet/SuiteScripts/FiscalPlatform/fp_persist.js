/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * GRAVA O RETORNO DA EMISSÃO. Nada mais.
 *
 * Não chama o motor, não decide nada fiscal, não formata mensagem. Recebe o corpo que a plataforma
 * devolveu e o reflete no NetSuite — é a outra ponta do `fp_md_map_simular`, que traduz na ida.
 *
 * ── A ORDEM É A REGRA, e ela não é estética ────────────────────────────────────────────────────
 *
 * `aplicar` grava em três etapas, nesta sequência: campos da transação, linha do
 * `customrecord_fp_doc`, payload e retorno. É a invariante do projeto — *persistir cada
 * avanço antes de prosseguir*. Quando a emissão volta, o número JÁ FOI GASTO e a nota JÁ ESTÁ na
 * SEFAZ; autorização não pode se perder porque a gravação seguinte falhou.
 *
 * Etapa que falha interrompe as seguintes — é um `try` só, no Suitelet que chamou — mas o que já
 * gravou fica gravado. Logo a ordem é por DEPENDÊNCIA: o que não depende de nada vem primeiro, e
 * o que depende da rede vem por último.
 *
 * ⚠ NADA AQUI CHAMA A REDE, e é de propósito. O XML mora na plataforma e é baixado sob demanda,
 * pelo botão, direto para a máquina de quem pediu — não passa pelo File Cabinet. Enquanto o
 * download morava aqui, plataforma fora do ar derrubava `aplicar` inteiro e o payload, que já
 * estava em memória, nunca era gravado: perdia-se a prova por causa do passo mais frágil.
 *
 * ── SEM `try/catch` AQUI ───────────────────────────────────────────────────────────────────────
 *
 * Auxiliar não engole erro neste bundle. Quem chama é ponto de entrada e é lá que a mensagem vira
 * banner para o usuário.
 *
 * ── O QUE NÃO SE GUARDA ────────────────────────────────────────────────────────────────────────
 *
 * O **UUID** do documento na plataforma. O ERP endereça evento pelo `idExterno`, que é o internal
 * id da transação — o próprio controller do `/fiscal/emitir` diz que é por ele que se endereça o
 * documento nos outros endpoints. Guardar o UUID seria carregar um id que o ERP não gerou, não
 * valida e não sabe reconstruir.
 */
define(['N/record', 'N/search', 'N/file', 'N/url', 'N/log', './fp_fields'],
  function (record, search, file, url, log, fpFields) {

    /**
     * Reflete o documento emitido na transação.
     *
     * @param {string} tipo     tipo da transação do NetSuite (`invoice`, ...)
     * @param {number|string} id  internal id da transação — e o `idExterno` do documento
     * @param {Object} doc      corpo devolvido por `POST /fiscal/emitir`
     * @param {Object} [opcoes] `{ pasta: <internal id da pasta do File Cabinet>, subsidiaria }`
     * @returns {{chave: string, status: string, arquivos: string[]}}
     */
    function aplicar(tipo, id, doc, opcoes) {
      opcoes = opcoes || {};
      if (!doc) return null;

      gravarNaTransacao(tipo, id, doc);
      var linha = gravarDoc(tipo, id, doc);

      var arquivos = anexarRastro(tipo, id, doc, opcoes);

      log.audit('fp_persist.aplicar',
        'documento ' + (doc.status || '?') + ' · chave ' + (doc.chaveAcesso || '(sem chave)') +
        ' · doc ' + linha + ' · ' + arquivos.length + ' arquivo(s)');

      return { chave: texto(doc.chaveAcesso), status: texto(doc.status), arquivos: arquivos };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. transação — o que identifica o documento, e é o que não pode se perder
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * UM `submitFields`, não um `load`/`save`.
     *
     * `submitFields` não dispara User Event de novo, e disparar aqui reentraria no simulador do
     * `beforeSubmit` logo depois de a nota ter sido autorizada — uma chamada ao motor por emissão,
     * de graça, e o risco de o simulador sobrescrever o que a emissão acabou de gravar.
     */
    function gravarNaTransacao(tipo, id, doc) {
      var valores = {};
      por(valores, 'DOC_CHAVE', doc.chaveAcesso);
      por(valores, 'DOC_NUMERO', doc.numero);
      por(valores, 'DOC_SERIE', doc.serie);
      por(valores, 'DOC_STATUS', doc.status);
      por(valores, 'DOC_CSTAT', doc.cStat);
      por(valores, 'DOC_XMOTIVO', doc.xMotivo);
      por(valores, 'DOC_PROTOCOLO', doc.nProt);

      // OS LINKS, não os arquivos. Os campos eram DOCUMENT — que espera o internal id de um
      // arquivo do File Cabinet — e agora são URL. Apontam para o Suitelet, que busca na
      // plataforma por HTTPS e entrega ao navegador: nada fica no File Cabinet.
      //
      // O link é montado com a CHAVE, que é como todo endpoint de documento emitido endereça.
      if (doc.chaveAcesso) {
        por(valores, 'DOC_XML', linkDeDocumento(tipo, id, 'xml'));
        por(valores, 'DOC_DANFE', linkDeDocumento(tipo, id, 'danfe'));
      }

      if (!temChave(valores)) {
        log.audit('fp_persist.gravarNaTransacao',
          'nenhum campo de documento resolve no perfil ativo — o retorno não foi refletido na ' +
          'transação. A linha do customrecord_fp_doc ainda guarda tudo.');
        return;
      }

      record.submitFields({
        type: tipo,
        id: id,
        values: valores,
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });
    }

    /**
     * URL ABSOLUTA, e não a relativa do `resolveScript`.
     *
     * Campo URL guarda o que for gravado e o NetSuite o serve como link. Com endereço relativo o
     * comportamento depende de onde a página é aberta — e-mail, portal, aba externa — então o
     * domínio da conta entra explícito.
     */
    function linkDeDocumento(tipo, id, acao) {
      return 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }) +
        url.resolveScript({
          scriptId: 'customscript_fp_sl_emissao',
          deploymentId: 'customdeploy_fp_sl_emissao',
          params: { tipo: tipo, id: id, acao: acao }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. customrecord_fp_doc — o histórico
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * UMA LINHA POR DOCUMENTO, não por tentativa de clique.
     *
     * A transação mostra o desfecho ATUAL; aqui fica a série inteira — a nota rejeitada, a
     * inutilização do número preso nela, a nota que a substituiu. Por isso o reenvio do mesmo
     * `idExterno`, que a plataforma responde com o documento anterior, ATUALIZA a linha em vez de
     * criar outra: seria a mesma nota duas vezes.
     *
     * A busca é pela CHAVE quando ela existe, e pelo `idExterno` enquanto não existe — nota
     * rejeitada não tem chave, e é justamente ela que a próxima tentativa precisa reencontrar.
     */
    function gravarDoc(tipo, idTransacao, doc) {
      var C = camposDoc();
      var registro = fpFields.registro('DOC');
      if (!registro || !C.IDEXTERNO) {
        log.audit('fp_persist.gravarDoc',
          'customrecord_fp_doc não resolve no perfil ativo — o histórico do documento não foi ' +
          'gravado. Os campos da transação já têm o desfecho.');
        return null;
      }

      var idExterno = String(idTransacao);
      var existente = acharDoc(registro, C, idExterno, texto(doc.chaveAcesso));

      var rec = existente
        ? record.load({ type: registro, id: existente })
        : record.create({ type: registro });

      def(rec, C.TRANSACAO, idTransacao);
      def(rec, C.IDEXTERNO, idExterno);
      def(rec, C.TIPO, doc.tipoDocumento || doc.modelo);
      def(rec, C.SERIE, doc.serie);
      def(rec, C.NUMERO, doc.numero);
      def(rec, C.CHAVE, doc.chaveAcesso);
      def(rec, C.STATUS, doc.status);
      def(rec, C.CSTAT, doc.cStat);
      def(rec, C.XMOTIVO, doc.xMotivo);
      def(rec, C.PROTOCOLO, doc.nProt);

      // ⚠ XML e DANFE são campos DOCUMENT e ficam VAZIOS: eles esperam o internal id de um
      // arquivo do File Cabinet, e gravar a URL neles devolve INVALID_FLD_VALUE (medido). O XML
      // mora na plataforma e é baixado sob demanda, direto para a máquina de quem pediu.

      if (!existente) def(rec, C.TENTATIVA, 1);

      return rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
    }

    function acharDoc(registro, C, idExterno, chave) {
      var filtro = chave && C.CHAVE
        ? [[C.CHAVE, 'is', chave]]
        : [[C.IDEXTERNO, 'is', idExterno]];

      var achado = null;
      search.create({ type: registro, filters: filtro, columns: ['internalid'] })
        .run()
        .each(function (linha) {
          achado = linha.id;
          return false;
        });
      return achado;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. rastro — payload e retorno
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * O PAYLOAD ENVIADO, junto do retorno. É a invariante do projeto, e o motivo é prático: sem o
     * que foi mandado, "o motor errou" e "eu mandei errado" são indistinguíveis — e a segunda é a
     * hipótese mais frequente. Guardar só a resposta deixa metade da prova.
     *
     * Nome fixo por transação, como o rastro da simulação: emitir de novo substitui em vez de
     * acumular, e o que interessa é o último par.
     */
    function anexarRastro(tipo, id, doc, opcoes) {
      if (!opcoes.pasta || !opcoes.payload) {
        log.audit('fp_persist.anexarRastro',
          'payload e retorno NÃO foram anexados — ' +
          (!opcoes.pasta
            ? 'o parâmetro "Pasta do XML" não está preenchido nas Preferências da Empresa.'
            : 'quem chamou não passou o payload em opcoes.payload.'));
        return [];
      }

      var base = 'FP-' + tipo + '-' + id + '-emissao-';
      return [
        gravarJson(base + 'payload.json', opcoes.payload, tipo, id, opcoes.pasta),
        gravarJson(base + 'retorno.json', doc, tipo, id, opcoes.pasta)
      ];
    }

    function gravarJson(nome, conteudo, tipo, id, pasta) {
      var idArquivo = file.create({
        name: nome,
        fileType: file.Type.JSON,
        contents: JSON.stringify(conteudo, null, 1),
        folder: pasta,
        isOnline: false
      }).save();

      anexar(idArquivo, tipo, id);
      return nome;
    }

    function anexar(idArquivo, tipo, id) {
      record.attach({
        record: { type: 'file', id: idArquivo },
        to: { type: tipo, id: id }
      });
    }

    // ─────────────────────────────────────────────────────────────────────────

    function camposDoc() {
      return {
        TRANSACAO: fpFields.idDoc('TRANSACAO'),
        IDEXTERNO: fpFields.idDoc('IDEXTERNO'),
        TIPO: fpFields.idDoc('TIPO'),
        SERIE: fpFields.idDoc('SERIE'),
        NUMERO: fpFields.idDoc('NUMERO'),
        CHAVE: fpFields.idDoc('CHAVE'),
        STATUS: fpFields.idDoc('STATUS'),
        CSTAT: fpFields.idDoc('CSTAT'),
        XMOTIVO: fpFields.idDoc('XMOTIVO'),
        PROTOCOLO: fpFields.idDoc('PROTOCOLO'),
        TENTATIVA: fpFields.idDoc('TENTATIVA')
      };
    }

    /** Campo que o perfil não mapeia não entra no `submitFields` — mandar `undefined` limparia. */
    function por(valores, chave, valor) {
      var campo = fpFields.id(chave);
      if (campo && valor !== null && valor !== undefined && valor !== '') {
        valores[campo] = String(valor);
      }
    }

    function def(rec, campo, valor) {
      if (!campo || valor === null || valor === undefined || valor === '') return;
      rec.setValue({ fieldId: campo, value: valor });
    }

    function temChave(valores) {
      for (var k in valores) {
        if (Object.prototype.hasOwnProperty.call(valores, k)) return true;
      }
      return false;
    }

    function texto(v) {
      return v === null || v === undefined ? '' : String(v);
    }

    return {
      aplicar: aplicar,
      gravarNaTransacao: gravarNaTransacao,
      gravarDoc: gravarDoc,
      anexarRastro: anexarRastro
    };
  });
