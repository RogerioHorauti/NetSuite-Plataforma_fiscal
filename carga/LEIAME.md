# Carga dos cadastros — ordem e verificação

CSV Import (**Setup > Import/Export > Import CSV Records**), tipo **Custom Record**. O cabeçalho de
cada arquivo já é o **scriptid** do campo, então o mapeamento sai quase automático.

## Ordem, e ela importa

| # | arquivo | registro | depende de |
|---|---|---|---|
| 1 | `customrecord_fp_imposto.csv` | Imposto | — |
| 2 | `customrecord_fp_classificador_contabil.csv` | Classificador Contábil | o Imposto existir (referência por **Código**) e as contas do plano |

A coluna `_referencia_nao_mapear` do classificador existe só para leitura humana — **deixe sem
mapeamento** na tela de import. Linha desativada usa o `Inactive` nativo do registro; não há campo
`Ativo` próprio.

## O que a carga do classificador cobre

**Saída** — é o caminho que o retorno do PV704 exercita hoje: `ICMS`, `PIS` e `COFINS` em `DEBITO`,
mais `IPI` em `DEBITO` com `compoeTotalNf = SIM`.

**Entrada** — escrito a partir da doutrina, **não medido**: recuperável de ICMS/PIS/COFINS/IPI, e
`CUSTO`/`ST_JA_RECOLHIDO` **sem conta em nenhuma das duas pernas**, que é como se diz "não lança".

> **"Não lança" não é campo.** A regra existe no cadastro — alguém pensou no caso — e deixa as duas
> contas em branco com origem `CONTA_FIXA`. O plug-in não posta par sem conta. Regra AUSENTE é
> outra coisa: vai para o log como **erro**, porque é cadastro esquecido. Essa diferença é o único
> aviso que existe quando falta uma regra de verdade.

**CBS, IBS e IS não têm linha, e isso está certo.** O motor devolve os três com
`naturezaContabil: SEM_EFEITO`, e o plug-in descarta `SEM_EFEITO` antes de consultar o cadastro.
Quando a Reforma virar e o motor passar a devolver `DEBITO`, basta cadastrar a linha — nenhuma
mudança de código. (O plano de contas da conta ainda **não tem** conta de CBS/IBS/IS: criar antes.)

## Contas usadas

As colunas de conta trazem o **texto de exibição** — `<número> <nome>` —, que é por onde o CSV
Import casa um campo List/Record de conta. Internal id nessas colunas não resolve.

O texto abaixo foi extraído do `ChartofAccounts597.xlsx` exportado da própria conta, não digitado:
se um nome divergir do plano, a linha falha no import com "Invalid account reference".

| usada em | texto exato |
|---|---|
| ICMS DEBITO saída — débito | `5010.4 ICMS - Sales Expense` |
| ICMS DEBITO saída — crédito | `2310.7 ICMS on Sales - Payable` |
| PIS DEBITO saída — débito | `5010.1 PIS - Sales Expense` |
| PIS DEBITO saída — crédito | `2310.10 PIS on Sales - Payable` |
| COFINS DEBITO saída — débito | `5010.2 COFINS - Sales Expense` |
| COFINS DEBITO saída — crédito | `2310.2 COFINS on Sales - Payable` |
| IPI DEBITO saída — crédito | `2310.8 IPI on Sales - Payable` |
| ICMS recuperável entrada — débito | `1310.4 ICMS on Purchases - Credit` |
| PIS recuperável entrada — débito | `1310.8 PIS on Purchases - Credit` |
| COFINS recuperável entrada — débito | `1310.9 COFINS on Purchases - Credit` |
| IPI recuperável entrada — débito | `1310.5 IPI on Purchases - Credit` |

Isso é questão **só do import**. Gravado, o campo é List/Record de conta, e tanto o `getValue`
quanto o SuiteQL devolvem o **internal id** — que é o que `fp_gl_lines_plugin.js` põe em
`line.accountId`. O plug-in não lê nome de conta em lugar nenhum.

## Antes de confiar no plug-in: uma medição

O plug-in lê a régua com `BUILTIN.DF()` para traduzir os campos List/Record em texto — é obrigatório
porque `getText` **não existe** no Custom GL Lines síncrono (manual p.60–61). Isso ainda não foi
medido nesta conta. Cole em **Analytics > SuiteQL** (ou na ferramenta de SuiteQL do seu bundle):

```sql
SELECT
  i.custrecord_fp_codigo_impo               AS imposto,
  BUILTIN.DF(c.custrecord_fp_natureza_cc)   AS natureza,
  BUILTIN.DF(c.custrecord_fp_sentido_cc)    AS sentido,
  BUILTIN.DF(c.custrecord_fp_compoe_total_cc)   AS compoe,
  BUILTIN.DF(c.custrecord_fp_debito_origem_cc)  AS debito_origem,
  BUILTIN.DF(c.custrecord_fp_credito_origem_cc) AS credito_origem,
  c.custrecord_fp_debito_cc                 AS conta_debito,
  c.custrecord_fp_credito_cc                AS conta_credito
FROM customrecord_fp_classificador_contabil c
JOIN customrecord_fp_imposto i ON i.id = c.custrecord_fp_imposto_cc
WHERE c.isinactive = 'F'
```

O que tem de aparecer: `natureza` = `DEBITO`, `sentido` = `SAIDA`, `debito_origem` = `CONTA_FIXA`.
**Se vier número em vez de texto**, `BUILTIN.DF` não resolve List/Record nesta conta e o plug-in
vai achar zero regras — aí o caminho é trocar por um `JOIN` na tabela da customlist.

## Conferência do primeiro lançamento

Com a régua de saída carregada, o retorno do PV704 tem de produzir, no **GL Impact**:

| conta | débito | crédito |
|---|---|---|
| 5010.4 ICMS - Sales Expense | 617,24 | |
| 2310.7 ICMS on Sales - Payable | | 617,24 |
| 5010.1 PIS - Sales Expense | 29,42 | |
| 2310.10 PIS on Sales - Payable | | 29,42 |
| 5010.2 COFINS - Sales Expense | 135,79 | |
| 2310.2 COFINS on Sales - Payable | | 135,79 |

E **nada** de CBS (46,29), IBS estadual (5,14) ou IBS municipal (0,00) — os três são `SEM_EFEITO`.
Se aparecer linha desses, a guarda 2 do plug-in falhou.
