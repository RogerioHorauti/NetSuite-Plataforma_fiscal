/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 *
 * PREENCHE O ENDEREÇO A PARTIR DO CEP, no formulário de endereço.
 *
 * Roda no `fieldChanged` do `zip`. Origem: o `GLOCep.js`, reescrito — o que mudou e por quê está
 * no bloco abaixo, porque cada item era um defeito que aparecia só em produção.
 *
 * ── O QUE ESTAVA QUEBRADO NO ORIGINAL ─────────────────────────────────────────────────────────
 *
 * 1. `getViaCep` NÃO TINHA `return`. A terceira tentativa sempre devolvia `undefined`, e a linha
 *    seguinte lia `response.code` — ou seja, o último fallback nunca funcionou e ainda lançava.
 * 2. `response` era lido FORA do `try`. Com as três APIs fora do ar, `response` ficava indefinido
 *    e o `if (response.code == 200)` derrubava o script em cima do usuário.
 * 3. `log.debug` em Client Script. `log` é global de script de servidor; no cliente o correto é
 *    `N/log`, e sem ele a chamada lança.
 * 4. Gravava em `custrecord_brl_addrform_t_complement` e `custrecord_brl_addr_form_city`, e
 *    buscava em `customrecord_ftebr_city`. ⚠ MEDIDO em 2026-09-23: **`customrecord_ftebr_city`
 *    não existe nesta conta** — é da Brazil Localization, que não está instalada. A busca voltaria
 *    vazia sempre e os dois `setValue` falhariam.
 * 5. `filters: [["name","contains", "Palhoça - SC"]]` — `contains` casa demais. "Santa Rita"
 *    casaria "Santa Rita do Sapucaí" e o primeiro resultado ganharia.
 * 6. Punha o bairro em `addr2`. ⚠ MEDIDO em `entityaddress`: nesta conta o bairro mora no
 *    **`addr3`** ("Centro", "Vila Parque Jabaquara") e o `addr2` é complemento.
 *
 * O **código IBGE não é lido nem gravado**: a plataforma o resolve sozinha a partir de município
 * e UF. Trazer isso para o NetSuite seria a segunda cópia de uma régua que já existe lá.
 *
 * ── AS TRÊS APIS, e por que nesta ordem ───────────────────────────────────────────────────────
 *
 * OpenCEP → BrasilAPI → ViaCEP. As três são públicas e gratuitas; nenhuma tem SLA. A ordem é a do
 * original e não mexi nela, mas agora a cadeia é de verdade: cada uma só é tentada se a anterior
 * não respondeu, e falha de todas termina em campo vazio e aviso, nunca em exceção.
 *
 */
define(['N/https', 'N/log'], function (https, log) {

  /** Campos NATIVOS do endereço. Nada de Brazil Localization: não está instalada nesta conta. */
  var CAMPO = {
    CEP: 'zip',
    LOGRADOURO: 'addr1',
    COMPLEMENTO: 'addr2',
    BAIRRO: 'addr3',
    CIDADE: 'city',
    UF: 'state'
  };

  function fieldChanged(contexto) {
    if (contexto.fieldId !== CAMPO.CEP) return;

    var rec = contexto.currentRecord;
    var cep = digitos(rec.getValue({ fieldId: CAMPO.CEP }));

    // Normaliza o que o usuário digitou, sem disparar de novo o fieldChanged.
    rec.setValue({ fieldId: CAMPO.CEP, value: cep, ignoreFieldChange: true });

    if (!cep) { limpar(rec); return; }

    // 8 dígitos ou não é CEP. Sai calado enquanto ele ainda está digitando.
    if (cep.length !== 8) return;

    var end = buscar(cep);

    if (!end) {
      limpar(rec);
      alert('CEP ' + cep + ' não encontrado. Preencha o endereço à mão.');
      return;
    }

    preencher(rec, end);
  }

  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Primeira API que responder com endereço utilizável ganha.
   *
   * ⚠ ESTE `try` É FLUXO, NÃO ENGOLIMENTO, e é o único auxiliar do bundle que mantém um: ele não
   * esconde erro, ele passa para a próxima API. Tirá-lo faria uma API fora do ar impedir as duas
   * seguintes — que é justamente o que a cadeia existe para evitar.
   *
   * Cada tentativa tem `try` próprio: API fora do ar não pode impedir a próxima, e nenhuma delas
   * pode derrubar o formulário. Sem resposta de ninguém, devolve `null` — e quem chama avisa.
   */
  function buscar(cep) {
    var fontes = [
      { nome: 'OpenCEP', url: 'https://opencep.com/v1/' + cep, ler: lerViaCep },
      { nome: 'BrasilAPI', url: 'https://brasilapi.com.br/api/cep/v2/' + cep, ler: lerBrasilApi },
      { nome: 'ViaCEP', url: 'https://viacep.com.br/ws/' + cep + '/json/', ler: lerViaCep }
    ];

    for (var i = 0; i < fontes.length; i++) {
      var f = fontes[i];
      try {
        var r = https.get({ url: f.url });
        if (!r || r.code !== 200 || !r.body) continue;

        var corpo = JSON.parse(r.body);

        // O ViaCEP responde 200 com `{"erro": true}` para CEP inexistente. Sem esta guarda,
        // o endereço seria limpo com "sucesso".
        if (corpo.erro) continue;

        var end = f.ler(corpo);
        if (end && (end.logradouro || end.cidade)) {
          end.fonte = f.nome;
          return end;
        }
      } catch (e) {
        log.debug('fp_cs_endereco_cep', f.nome + ' falhou: ' + (e.message || e));
      }
    }
    return null;
  }

  /** ViaCEP e OpenCEP compartilham o mesmo shape. */
  function lerViaCep(c) {
    return {
      logradouro: c.logradouro || '',
      bairro: c.bairro || '',
      cidade: c.localidade || '',
      uf: c.uf || ''
    };
  }

  function lerBrasilApi(c) {
    return {
      logradouro: c.street || '',
      bairro: c.neighborhood || '',
      cidade: c.city || '',
      uf: c.state || ''
    };
  }

  function preencher(rec, end) {
    grava(rec, CAMPO.LOGRADOURO, end.logradouro);
    grava(rec, CAMPO.BAIRRO, end.bairro);
    grava(rec, CAMPO.CIDADE, end.cidade);
    grava(rec, CAMPO.UF, end.uf);

    log.debug('fp_cs_endereco_cep', end.fonte + ': ' + end.cidade + '/' + end.uf);
  }

  function limpar(rec) {
    grava(rec, CAMPO.LOGRADOURO, '');
    grava(rec, CAMPO.BAIRRO, '');
    grava(rec, CAMPO.CIDADE, '');
    grava(rec, CAMPO.UF, '');
  }

  /**
   * `ignoreFieldChange: true` em tudo, e não é detalhe: sem isso, gravar `state` dispara o
   * `fieldChanged` de novo e o formulário entra em cascata de eventos.
   */
  function grava(rec, campo, valor) {
    rec.setValue({ fieldId: campo, value: valor, ignoreFieldChange: true });
  }

  function digitos(v) {
    return v === null || v === undefined ? '' : String(v).replace(/\D/g, '');
  }

  return { fieldChanged: fieldChanged };
});
