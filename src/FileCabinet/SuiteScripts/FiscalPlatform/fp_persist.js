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
 * O payload é gravado ANTES da rede, pelo `gravarEnvio`. Na volta, `aplicar` grava em duas
 * etapas, nesta ordem: campos da transação, depois o retorno. É a
 * invariante do projeto — *persistir cada avanço antes de prosseguir*. Quando a emissão volta, o
 * número JÁ FOI GASTO e a nota JÁ ESTÁ na SEFAZ; autorização não pode se perder porque a gravação
 * seguinte falhou.
 *
 * Etapa que falha interrompe a seguinte — é um `try` só, no Suitelet que chamou — mas o que já
 * gravou fica gravado. Por isso o que identifica o documento vem primeiro.
 *
 * ── NÃO HÁ REGISTRO DE HISTÓRICO ───────────────────────────────────────────────────────────────
 *
 * Havia um `customrecord_fp_doc` com quatorze campos, e eles repetiam o que a transação já mostra.
 * Foi removido: o desfecho atual está nos campos da transação, e a série inteira — o que se mandou
 * e o que voltou, em cada tentativa — está nos anexos, que é onde a prova é útil.
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
define(['N/record', 'N/file', 'N/url', 'N/log', './fp_fields'],
  function (record, file, url, log, fpFields) {

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

      // `doc` nulo é resposta que não descreve a nota — a inutilização. A transação não se toca,
      // mas o rastro vai: é a prova de que o número foi fechado.
      if (doc) gravarNaTransacao(tipo, id, doc);

      var retorno = opcoes.bruto !== undefined ? opcoes.bruto : doc;
      var arquivos = anexarRastro(tipo, id, retorno, opcoes);

      log.audit('fp_persist.aplicar', (opcoes.acao || 'emitir') + ' · documento ' +
        ((doc && doc.status) || '?') + ' · chave ' + ((doc && doc.chaveAcesso) || '(sem chave)') +
        ' · ' + arquivos.length + ' arquivo(s)');

      return { chave: texto(doc && doc.chaveAcesso), status: texto(doc && doc.status), arquivos: arquivos };
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
          'transação — confira o perfil ativo. O payload e o retorno ainda vão para o anexo.');
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
    // 2. rastro — payload e retorno
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * O PAYLOAD, GRAVADO E ANEXADO **ANTES** DA REDE. Sem o que foi mandado, "o motor errou" e "eu
     * mandei errado" são indistinguíveis — e a segunda é a hipótese mais frequente. Gravado depois
     * da resposta, recusa, timeout ou exceção no meio levavam a prova junto.
     *
     * Sem pasta, LANÇA, e a requisição não sai: emissão sem prova não se faz (2026-10-20, Rogerio).
     * Marca `opcoes.enviado`, que é o que autoriza o `anexarRastro` a gravar o retorno.
     */
    function gravarEnvio(tipo, id, payload, opcoes) {
      if (!opcoes.pasta) {
        throw new Error('o parâmetro "Pasta do Payload" não está preenchido nas Preferências da Empresa — a ' +
          'requisição NÃO foi enviada: sem o payload gravado, não há como auditar o que se mandou.');
      }
      opcoes.enviado = gravarJson(base(tipo, id, opcoes) + 'payload.json', payload, tipo, id, opcoes.pasta);
      log.audit('fp_persist.gravarEnvio', opcoes.enviado + ' — antes do envio');
      return opcoes.enviado;
    }

    /**
     * O RETORNO, ao lado do payload que o `gravarEnvio` já gravou — sucesso OU recusa: a recusa é a
     * metade da prova que mais se consulta. Nome fixo por transação: emitir de novo substitui em
     * vez de acumular, e o que interessa é o último par.
     */
    function anexarRastro(tipo, id, doc, opcoes) {
      if (!opcoes.enviado) {
        log.audit('fp_persist.anexarRastro', 'retorno NÃO anexado — nada foi enviado nesta ação.');
        return [];
      }
      return [opcoes.enviado, gravarJson(base(tipo, id, opcoes) + 'retorno.json', doc, tipo, id, opcoes.pasta)];
    }

    // UM PAR POR AÇÃO. Com o nome fixo `-emissao-`, cancelar sobrescrevia a prova da emissão.
    // Repetir a MESMA ação substitui o par dela; a CC-e, que é repetível, guarda a última.
    function base(tipo, id, opcoes) {
      return 'FP-' + tipo + '-' + id + '-' + (opcoes.acao && opcoes.acao !== 'emitir' ? opcoes.acao : 'emissao') + '-';
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

    /** Campo que o perfil não mapeia não entra no `submitFields` — mandar `undefined` limparia. */
    function por(valores, chave, valor) {
      var campo = fpFields.id(chave);
      if (campo && valor !== null && valor !== undefined && valor !== '') {
        valores[campo] = String(valor);
      }
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
      gravarEnvio: gravarEnvio,
      anexarRastro: anexarRastro
    };
  });
