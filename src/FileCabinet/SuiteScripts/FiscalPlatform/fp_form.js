/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * ORGANIZAÇÃO DOS COMPONENTES NO FORMULÁRIO.
 *
 * Réplica dos idiomas do `brl_ue_transaction.js` do SuiteApp **Brazil Localization v1.11.0**
 * (`com.netsuite.brazillocalization`), lidos do fonte minificado do bundle — ver `MEDICOES.md`
 * §5.4. Não é convenção inventada: é o que a Oracle faz para encaixar campo de localização entre
 * campos nativos sem deixar o formulário remendado.
 *
 * ── O PROBLEMA CENTRAL, E O IDIOMA QUE O RESOLVE ───────────────────────────────────────────────
 *
 * `Form.insertField({field, nextfield})` insere **ANTES** de `nextfield`. Não existe "insira
 * depois". Então colocar um campo nosso DEPOIS de um nativo se faz em dois movimentos:
 *
 *   1. insere o nosso ANTES do nativo        →  [nosso] [nativo]
 *   2. reinsere o NATIVO antes do nosso      →  [nativo] [nosso]
 *
 * É o `positionFederalTaxRegistration` da Oracle, que faz exatamente isso com o CNPJ ao lado do
 * `entity`. Sem o segundo movimento, o campo aparece ANTES do nativo — que é o bug clássico de
 * quem tenta posicionar campo no NetSuite pela primeira vez.
 *
 * ── E O SEGUNDO DETALHE, QUE É O QUE DÁ ORDEM ESTÁVEL ──────────────────────────────────────────
 *
 * Para uma LISTA de campos, o laço tem de correr **DE TRÁS PARA FRENTE**, cada um inserido antes
 * do que foi colocado no passo anterior. Correndo para frente, a ordem final sai **invertida**.
 * É o `positionFieldsInOrder` da Oracle, e o `for (i = n-1; i >= 0; i--)` dele não é estilo.
 *
 * ── ATRIBUIÇÃO DECLARATIVA VENCE POSICIONAMENTO IMPERATIVO ─────────────────────────────────────
 *
 * Campo com `<subtab>` preenchido no XML renderiza NA subtab, e `insertField` **não** o traz para
 * a aba principal. Por isso a divisão no nosso projeto:
 *
 *   · `custbody_fp_tipodoc` e `custbody_fp_natureza` → `<subtab></subtab>` vazio, posicionados
 *     aqui logo depois do `memo`. São DECLARAÇÃO: o usuário digita, e tem de ver sem trocar de aba.
 *   · chave, número, série, status, cStat, xMotivo, protocolo, XML, DANFE, sim_* →
 *     `<subtab>[scriptid=custtab_fp_fiscal]</subtab>`. São RETORNO: consulta, não digitação.
 */
define(['N/ui/serverWidget', 'N/log'], function (serverWidget, log) {
  /**
   * Posiciona `campos` na ordem declarada, logo **DEPOIS** de `ancora`.
   *
   * Equivale ao `positionFieldsInOrder(form, anchor, fields, true)` da Oracle. O laço de trás para
   * frente é obrigatório (ver docblock do módulo), e a reinserção da âncora no fim é o que
   * transforma "antes" em "depois".
   *
   * Campo inexistente é **pulado em silêncio** — é o `if (o)` da Oracle. Não é descuido: o mesmo
   * User Event roda em oito tipos de transação, e nem todo campo está em todos os formulários.
   * Lançar aqui derrubaria o load do registro por um campo que legitimamente não existe ali.
   *
   * @param {Form} form scriptContext.form
   * @param {string} ancora id do campo de referência (nativo, normalmente)
   * @param {string[]} campos ids na ordem em que devem aparecer
   */
  function posicionarDepoisDe(form, ancora, campos) {
    if (!form || !ancora || !campos || !campos.length) return;

    var proximo = ancora;
    var colocados = [];

    for (var i = campos.length - 1; i >= 0; i--) {
      var campo = obter(form, campos[i]);
      if (!campo) continue;

      form.insertField({ field: campo, nextfield: proximo });
      proximo = campos[i];
      colocados.unshift(campos[i]);
    
    }

    if (!colocados.length) return;

    // SEGUNDO MOVIMENTO: reinsere a âncora antes do primeiro que foi colocado.
    // Sem isto, o bloco fica ANTES da âncora, não depois.
    var campoAncora = obter(form, ancora);
    if (!campoAncora) return;
    form.insertField({ field: campoAncora, nextfield: colocados[0] });
  
  }

  /**
   * Igual ao anterior, mas escolhe como âncora o **primeiro `ancoras` que existir** no formulário.
   *
   * Equivale ao `positionFieldsInOrderWhenReferenceFound` da Oracle, e existe porque o campo de
   * referência muda de nome entre tipos de transação — `entity` na venda, `entity` na compra, mas
   * `memo` não está em todo formulário customizado. Passa-se uma cadeia de preferência e o
   * primeiro que responder vira âncora.
   *
   * @param {Form} form
   * @param {string[]} ancoras em ordem de preferência
   * @param {string[]} campos
   * @returns {string|null} a âncora usada, ou null se nenhuma existe
   */
  function posicionarDepoisDaPrimeiraAncora(form, ancoras, campos) {
    for (var i = 0; i < ancoras.length; i++) {
      if (obter(form, ancoras[i])) {
        posicionarDepoisDe(form, ancoras[i], campos);
        return ancoras[i];
      }
    }
    log.debug('fp_form', 'nenhuma âncora encontrada em [' + ancoras.join(', ') + '] — campos ficam onde estão');
    return null;
  }

  /** Esconde os que existirem. Equivale ao `hideFieldsIfExist`. */
  function esconderSeExistir(form, campos) {
    exibicaoSeExistir(form, campos, serverWidget.FieldDisplayType.HIDDEN);
  }

  /** Muda o display type dos que existirem. Equivale ao `updateDisplayFieldsIfExist`. */
  function exibicaoSeExistir(form, campos, tipo) {
    if (!form || !campos) return;
    for (var i = 0; i < campos.length; i++) {
      var c = obter(form, campos[i]);
      if (!c) continue;
      c.updateDisplayType({ displayType: tipo });
    
    }
  }

  /**
   * A ÂNCORA DO GRUPO — um campo invisível, e sem ele o grupo não recebe ninguém.
   *
   * ⚠ MEDIDO no bundle da Oracle (`brl_ue_purchase_order.js` e outros 55): `addFieldGroup` cria o
   * grupo, mas campo customizado que já existe no formulário NÃO muda de container em runtime —
   * ele fica onde o `<subtab>` do objeto o pôs. O que funciona é criar um campo NOVO com
   * `container: <grupo>`, escondê-lo, e então mover os campos reais para junto dele com
   * `insertField`. O campo novo é do tipo `HELP` porque é o único que não ocupa espaço nem pede
   * rótulo.
   *
   * @returns {string} o id da âncora, para usar como referência de posição
   */
  function criarAncora(form, id, grupo) {
    var campo = form.addField({
      id: id,
      label: ' ',
      type: serverWidget.FieldType.HELP,
      container: grupo
    });
    campo.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
    return id;
  }

  /**
   * Grupo de campos. Equivale ao `createFieldGroup` da Oracle, **com os mesmos quatro padrões**
   * que ela fixa: não colapsado, não colapsável, não single-column, borda visível.
   *
   * @param {Form} form
   * @param {string} id id do grupo (`custpage_...`)
   * @param {string} rotulo
   * @param {string} [aba] id da aba; omitido = aba principal
   */
  function criarGrupo(form, id, rotulo, aba) {
    var g = form.addFieldGroup({ id: id, label: rotulo, tab: aba });
    g.isCollapsed = false;
    g.isCollapsible = false;
    g.isSingleColumn = false;
    g.isBorderHidden = false;
    return g;
  
  }

  /** Desabilita (ou reabilita) os que existirem. Equivale ao `setFormFieldsDisabled`. */
  function desabilitarSeExistir(form, campos, desabilitar) {
    exibicaoSeExistir(
      form,
      campos,
      desabilitar ? serverWidget.FieldDisplayType.DISABLED : serverWidget.FieldDisplayType.NORMAL
    );
  }

  /**
   * `form.getField` sem lançar.
   *
   * O `getField` do NetSuite lança para id inexistente em alguns contextos e devolve `null` em
   * outros. Padronizar em `null` aqui é o que permite o `if (campo)` de todos os chamadores acima
   * — e é o que a Oracle faz implicitamente, chamando sempre dentro de guarda.
   */
  function obter(form, id) {
    if (!form || !id) return null;
    return form.getField({ id: id }) || null;
  
  }

  return {
    posicionarDepoisDe: posicionarDepoisDe,
    posicionarDepoisDaPrimeiraAncora: posicionarDepoisDaPrimeiraAncora,
    esconderSeExistir: esconderSeExistir,
    exibicaoSeExistir: exibicaoSeExistir,
    desabilitarSeExistir: desabilitarSeExistir,
    criarGrupo: criarGrupo,
    criarAncora: criarAncora,
    obter: obter
  };
});
