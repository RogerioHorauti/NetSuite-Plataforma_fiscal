/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * O MANIFESTO MDF-e — do `customrecord_fp_mdfe` para o `POST /fiscal/emitir` e os eventos dele.
 *
 * O MDF-e NÃO é transação: não tem valor de operação, não tem tributo e não move estoque (o estoque
 * saiu no fulfillment de cada NF-e). Por isso não passa pelo `/simular` nem pelo `fp_ue_simular`:
 * o payload é montado direto do registro, na hora de emitir.
 *
 *   filial            Location do manifesto → `cnpjEmpresa` e `serie` (os da filial, como na NF-e)
 *   carregamento      o município do endereço da filial
 *   descarregamento   o endereço de ENTREGA de cada documento da sublista, com as chaves agrupadas
 *                     por município. Nome + UF: o IBGE a plataforma resolve (`municipio-por-nome`)
 *   veículo/condutor  placa e CPF, ou nada — a plataforma usa o único ativo e recusa se houver mais
 *
 * O que o ERP NÃO manda (o DTO diz): série do MDF-e por modelo, autorizador, `cMDF`, chave. E as
 * regras do leiaute (reboque do cavalo mecânico, 24 h do cancelamento) quem confere é a plataforma.
 *
 * ⚠ AINDA NÃO MEDIDO (MEDICOES §24): os joins `transactionShippingAddress` e `locationMainAddress`.
 */
define(['N/record', 'N/query', 'N/log', './fp_fields', './fp_client'],
  function (record, query, log, fpFields, fpClient) {

    /** Os eventos do manifesto. Todos endereçam pela CHAVE — como os da NF-e. */
    var EVENTOS = {
      encerrar: { caminho: '/fiscal/mdfe/{chave}/encerrar', rotulo: 'Encerramento', status: 'ENCERRADO' },
      cancelar: { caminho: '/fiscal/mdfe/{chave}/cancelar', rotulo: 'Cancelamento', status: 'CANCELADO' },
      reconciliar: { caminho: '/fiscal/mdfe/{chave}/reconciliar', rotulo: 'Consulta na SEFAZ' }
    };

    function tipo() {
      return fpFields.registro('MDFE');
    }

    function valor(rec, chave) {
      var c = fpFields.idMdfe(chave);
      var v = c && rec.getValue({ fieldId: c });
      return v === null || v === undefined ? '' : String(v);
    }

    /**
     * O payload do `POST /fiscal/emitir`. `idExterno` = `mdfe-<id>`: identidade estável do registro,
     * com o tipo no nome, porque o id de custom record pode coincidir com o de uma transação da mesma
     * filial — e o `idExterno` é único por filial.
     */
    function montar(rec) {
      var filial = fpClient.cnpjDaFilial(valor(rec, 'LOCATION'));
      if (!filial || !filial.serie) {
        throw new Error('O manifesto precisa de uma Filial com CNPJ e série cadastrados na Location.');
      }

      var docs = documentos(rec.id);
      if (!docs.length) throw new Error('O manifesto não tem documentos: inclua as notas que viajam nele.');

      var listas = nomesDasListas(rec);
      var m = {
        tpEmit: codigo(listas.TP_EMIT),
        municipiosCarrega: [municipioDaFilial(valor(rec, 'LOCATION'))],
        municipiosDescarga: agruparPorMunicipio(docs),
        vCarga: Number(valor(rec, 'VCARGA')) || 0,
        qCarga: Number(valor(rec, 'QCARGA')) || 0
      };
      var ufFim = valor(rec, 'UF_FIM').toUpperCase();
      if (ufFim) m.ufFim = ufFim;
      var placa = valor(rec, 'PLACA').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (placa) m.placaTracao = placa;
      var reboques = valor(rec, 'REBOQUES').split(/[,;\s]+/).map(function (p) {
        return p.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      }).filter(Boolean);
      if (reboques.length) m.placasReboque = reboques;
      var cpf = valor(rec, 'CPF_CONDUTOR').replace(/\D/g, '');
      if (cpf) m.cpfCondutor = cpf;
      var cunid = codigo(listas.CUNID);
      if (cunid) m.cUnid = cunid;

      return {
        cnpjEmpresa: filial.cnpj,
        serie: String(filial.serie),
        tipoDocumento: 'MDFE',
        idExterno: 'mdfe-' + rec.id,
        manifesto: m
      };
    }

    /** `{ chave, municipio, uf }` de cada documento — UMA consulta, com o endereço de entrega. */
    function documentos(idMdfe) {
      var cChave = fpFields.id('DOC_CHAVE');
      var r = query.runSuiteQL({
        query: 'SELECT t.tranid, t.' + cChave + ' AS chave, s.city, s.state, s.dropdownstate ' +
               'FROM ' + fpFields.registro('MDFE_DOC') + ' d ' +
               'JOIN transaction t ON t.id = d.' + fpFields.idMdfe('DOC_TRANSACAO') + ' ' +
               'LEFT JOIN transactionShippingAddress s ON s.nkey = t.shippingaddress ' +
               'WHERE d.' + fpFields.idMdfe('DOC_MDFE') + ' = ? AND d.isinactive = \'F\'',
        params: [idMdfe]
      }).asMappedResults();

      return r.map(function (x) {
        var chave = String(x.chave || '').replace(/\D/g, '');
        if (chave.length !== 44) {
          throw new Error('O documento ' + x.tranid + ' não tem chave de acesso de 44 dígitos: emita-o antes de manifestá-lo.');
        }
        var uf = String(x.dropdownstate || x.state || '').toUpperCase().substring(0, 2);
        if (!x.city || !uf) {
          throw new Error('O documento ' + x.tranid + ' não tem município e UF no endereço de entrega — é o município de descarga.');
        }
        return { chave: chave, municipio: String(x.city), uf: uf };
      });
    }

    function agruparPorMunicipio(docs) {
      var porMun = {}, ordem = [];
      docs.forEach(function (d) {
        var k = d.uf + '|' + d.municipio.toUpperCase();
        if (!porMun[k]) { porMun[k] = { nome: d.municipio, uf: d.uf, chavesNFe: [] }; ordem.push(k); }
        porMun[k].chavesNFe.push(d.chave);
      });
      return ordem.map(function (k) { return porMun[k]; });
    }

    function municipioDaFilial(location) {
      var r = query.runSuiteQL({
        query: 'SELECT a.city, a.state, a.dropdownstate FROM location l ' +
               'LEFT JOIN locationMainAddress a ON a.nkey = l.mainaddress WHERE l.id = ?',
        params: [location]
      }).asMappedResults();
      var uf = r.length ? String(r[0].dropdownstate || r[0].state || '').toUpperCase().substring(0, 2) : '';
      if (!r.length || !r[0].city || !uf) {
        throw new Error('A Filial do manifesto não tem município e UF no endereço — é o município de carregamento.');
      }
      return { nome: String(r[0].city), uf: uf };
    }

    /** Nomes das duas listas do manifesto, numa consulta. */
    function nomesDasListas(rec) {
      var pedidos = [['TP_EMIT', 'LISTA_MDFE_TP_EMIT'], ['CUNID', 'LISTA_MDFE_CUNID']];
      var partes = [], params = [];
      pedidos.forEach(function (p) {
        var id = valor(rec, p[0]);
        if (!id) return;
        partes.push("SELECT '" + p[0] + "' AS g, name FROM " + fpFields.registro(p[1]) + ' WHERE id = ?');
        params.push(id);
      });
      var out = {};
      if (!partes.length) return out;
      query.runSuiteQL({ query: partes.join(' UNION ALL '), params: params }).asMappedResults()
        .forEach(function (x) { out[x.g] = x.name; });
      return out;
    }

    function codigo(nome) {
      var m = /^\s*([0-9]+)\s*-\s/.exec(String(nome || ''));
      return m ? m[1] : '';
    }

    /**
     * Evento do manifesto: `{ caminho, corpo }`, ou lança dizendo o que falta.
     *
     * O encerramento pede ONDE a viagem terminou — o fato, não a UF planejada —, digitado como
     * `MUNICIPIO/UF` (e, se não foi hoje, `/AAAA-MM-DD`). O cancelamento pede a justificativa.
     */
    function evento(rec, acao, texto) {
      var cfg = EVENTOS[acao];
      if (!cfg) throw new Error('ação desconhecida para o MDF-e: ' + acao);
      var chave = valor(rec, 'CHAVE');
      if (!chave) throw new Error('o manifesto não tem chave de acesso: não há MDF-e para ' + cfg.rotulo.toLowerCase());

      var corpo = null;
      if (acao === 'encerrar') {
        var partes = String(texto || '').split('/').map(function (p) { return p.trim(); });
        if (!partes[0] || !partes[1]) throw new Error('Encerramento: informe o município onde a viagem terminou como MUNICIPIO/UF.');
        corpo = { municipio: { nome: partes[0], uf: partes[1].toUpperCase() } };
        if (partes[2]) corpo.dataEncerramento = partes[2];
      } else if (acao === 'cancelar') {
        if (!texto) throw new Error('Cancelamento: a justificativa não veio.');
        corpo = { justificativa: texto };
      }
      return { caminho: cfg.caminho.replace('{chave}', chave), corpo: corpo, rotulo: cfg.rotulo };
    }

    /**
     * O que vai para os campos do manifesto. Emissão: o documento (`situacao` é o status). Evento
     * REGISTRADO: o status que a plataforma dá ao manifesto (`mdfe-eventos.service.ts:180,187`).
     * Reconciliação: só a `situacaoNova`, quando houver.
     */
    function documentoDaResposta(acao, corpo) {
      if (!corpo || typeof corpo !== 'object') return null;
      if (acao === 'emitir') {
        return { chaveAcesso: corpo.chaveAcesso, numero: corpo.numero, serie: corpo.serie,
          status: corpo.situacao || corpo.status, cStat: corpo.cStat, xMotivo: corpo.xMotivo, nProt: corpo.nProt };
      }
      if (EVENTOS[acao] && EVENTOS[acao].status) {
        return corpo.situacao === 'REGISTRADO' ? { status: EVENTOS[acao].status } : null;
      }
      if (acao === 'reconciliar') {
        return corpo.situacaoNova ? { status: corpo.situacaoNova, cStat: corpo.cStat, xMotivo: corpo.xMotivo } : null;
      }
      return null;
    }

    /** Um `submitFields` no manifesto — o equivalente do `fp_persist.gravarNaTransacao`. */
    function gravar(id, doc) {
      if (!doc) return;
      var mapa = { CHAVE: doc.chaveAcesso, NUMERO: doc.numero, SERIE: doc.serie, STATUS: doc.status,
        CSTAT: doc.cStat, XMOTIVO: doc.xMotivo, PROTOCOLO: doc.nProt };
      var valores = {};
      Object.keys(mapa).forEach(function (k) {
        var c = fpFields.idMdfe(k);
        if (c && mapa[k] !== undefined && mapa[k] !== null) valores[c] = mapa[k];
      });
      if (!Object.keys(valores).length) return;
      record.submitFields({ type: tipo(), id: id, values: valores,
        options: { enableSourcing: false, ignoreMandatoryFields: true } });
      log.audit('fp_mdfe.gravar', 'manifesto ' + id + ' · ' + JSON.stringify(valores));
    }

    /** A subsidiária da Filial — é por ela que o `fp_client` acha a configuração e o token. */
    function subsidiaria(rec) {
      var r = query.runSuiteQL({ query: 'SELECT subsidiary FROM location WHERE id = ?',
        params: [valor(rec, 'LOCATION')] }).asMappedResults();
      return r.length ? r[0].subsidiary : null;
    }

    return { tipo: tipo, subsidiaria: subsidiaria, montar: montar, evento: evento, documentoDaResposta: documentoDaResposta, gravar: gravar,
      valor: valor };
  });
