# Plano de testes — exercitar o FiscalPlatform até ele ficar estável

> Rascunho de 2026-10-20. Os números da §2 foram medidos nos seeds de
> `fiscal-platform/backend/src/database/seed/`. Nada nesta página é gabarito: o gabarito de cada
> cenário vem da norma, com o dispositivo citado (§5).

## 1. Objetivo e fronteira

O objetivo é varrer a base legal e as operações do catálogo pelo **contrato público** da
plataforma, até que três afirmações sejam verdadeiras:

1. Nenhuma combinação válida responde 5xx.
2. Toda recusa (4xx) diz a causa em texto que o operador entende.
3. Os tributos devolvidos batem com o gabarito normativo.

- **`/simular` é a porta principal.** É o mesmo motor da emissão e **não consome numeração**.
- **`/emitir` fica para a Fase 4**, só no hml e só com certificado A1 de homologação.
- **O gabarito vem da norma, nunca da saída do motor.** É a regra do
  `corpus-maturidade.fixtures.ts`: um corpus gerado a partir do `/simular` passa verde e congela
  o defeito.

## 2. O que existe hoje (medido)

| Catálogo | Linhas | Observação |
|---|---|---|
| `cfop` | **657** | 159 / 126 / 32 de entrada (1/2/3); 159 / 151 / 30 de saída (5/6/7) |
| `natureza_operacao` | **69** | 31 de entrada, 38 de saída |
| CFOPs **alcançáveis** por natureza (`cfop_interno/interestadual/exterior_codigo`) | **123** | **534 CFOPs não saem de natureza nenhuma** |
| Naturezas **sem CFOP** em nenhum âmbito | 4 | `VENDA_SERV_EXPORT`, `COMPL_PRECO`, `COMPL_IPI`, `COMPL_ICMS` |
| `cst_operacao_cfop` | 224 linhas · 126 CFOPs | régua CST × CFOP |
| `cst_icms` / `csosn` / `cst_ipi` / `cst_pis_cofins` / `cst_ibs_cbs` / `cclasstrib` | 15 / 10 / 14 / 33 / 18 / 164 | |
| Specs na plataforma | 1.866 | corpus de maturidade: 20 cenários + 11 invertidos |

**O CFOP não é entrada do contrato.** O motor deriva o CFOP da natureza e do âmbito, que vem da
UF da contraparte. Por isso "testar todos os CFOPs" significa duas coisas:

- **Alcance:** que CFOP cada natureza produz, e por que 534 não são produzidos (§4, F0).
- **Correção:** para cada CFOP produzido, o CST e o tributo batem com a norma (F1 e F2).

## 3. Eixos da matriz

O produto cartesiano completo não roda. A combinação é **pairwise** (todo par de valores de dois
eixos aparece ao menos uma vez), mais **cenários dirigidos** para as combinações que a norma
trata de forma especial.

| Eixo | Valores |
|---|---|
| Natureza | as 69 do catálogo |
| Âmbito | interna · interestadual · exterior (o que a natureza admite) |
| Regime do emitente | Simples (CRT 1) · Simples com excesso de sublimite (CRT 2) · Presumido (cumulativo) · Real (não cumulativo) |
| Contraparte | contribuinte · não contribuinte · consumidor final · órgão público · exterior · ZFM/ALC |
| Par de UFs | interna · 4% (importado, Res. SF 13/2012) · 7% · 12% · DIFAL (EC 87/2015, LC 190/2022) |
| Produto | tributado integral · ST com MVA (original e ajustada) · monofásico PIS/COFINS · IPI pela TIPI · redução de base / isenção com cBenef · CEST ambíguo · serviço LC 116 (ISS) |
| Reforma | 2026, ano de teste (CBS 0,9% · IBS 0,1%, LC 214/2025) · cClassTrib por operação |
| Documento | NF-e 55 · NFC-e 65 · NFS-e · CT-e 57 |

## 4. Fases

### F0 — Inventário de alcance (sem gabarito; automático)
Classificar cada um dos 534 CFOPs não alcançáveis em uma destas categorias:
- **falta natureza:** operação real que o ERP vai pedir;
- **fora do escopo:** energia, comunicação, transporte e combustível, que têm documento próprio;
- **revogado:** `vigencia_fim` preenchido.

Também cobre as 4 naturezas sem CFOP: complemento e exportação de serviço precisam de um
caminho explícito.

**Saída:** uma tabela CFOP → categoria, e a lista de naturezas a criar, priorizada pelo
gerente.

### F1 — Fumaça por natureza × âmbito (≈ 150 casos; automático)
Um `/simular` mínimo e válido por par natureza × âmbito. Asserções:
- HTTP 200;
- o CFOP devolvido é o `cfop_<âmbito>_codigo` da natureza;
- o CST é coerente com o `cst_operacao_cfop`;
- todo tributo tem `naturezaContabil`;
- nenhum 5xx.

As asserções são de **consistência interna**: não dependem do contador e podem rodar já.

### F2 — Matriz tributária (gabarito do contador)
Uma frente por tributo. Cada cenário traz entrada, valor esperado e **dispositivo legal**.

- **ICMS:** os CSTs 00, 10, 20, 30, 40, 41, 50, 51, 60, 70 e 90, e os CSOSNs 101 a 900; ST com
  MVA ajustada; diferimento; DIFAL nas duas metodologias (base única e base dupla); FCP; ZFM.
- **IPI:** tributado pela TIPI, isento, suspenso (remessa para industrialização), retorno e
  `cEnq`.
- **PIS/COFINS:** cumulativo, não cumulativo, monofásico, alíquota zero; e a base sem ICMS
  (Tema 69 do STF).
- **CBS/IBS:** CST e cClassTrib por operação, reduções e alíquota do ano de teste.
- **ISS:** código LC 116, município de incidência, retenção.
- **Entrada:** reclassificação por finalidade (insumo, revenda, ativo, uso e consumo) e crédito ×
  custo.

### F3 — Contrato e robustez (automático)
- **Idempotência por `idExterno`:** o reenvio devolve o mesmo documento. Hoje isso falha: cada
  reenvio da 3133 voltou com uma chave nova (§7).
- **Validação:** payload inválido dá 400 com a causa, nunca 500. O whitelist não come campos
  silenciosamente.
- **Limites:** nota de 999 linhas, arredondamento por item × total, descontos, frete, seguro e
  outras despesas na base.
- **Carga:** latência p50/p95 do `/simular`, concorrência de 10 a 50 chamadas e expiração do
  token.

### F4 — Emissão e XML (hml, com certificado A1 de homologação)
- XML conferido contra o XSD vigente (PL_009 com as NTs da Reforma). Os tributos do XML batem
  com o retorno do `/simular`, que foi o que o ERP reenviou.
- Eventos: cancelamento, CC-e e inutilização; DANFE.
- Ponta a ponta pelo bundle em uma amostra (um caso por tipo de transação do NetSuite). É a
  fronteira payload → retorno.

### F5 — Regressão contínua
O corpus versionado roda a cada deploy do hml. Um cenário que fica vermelho bloqueia a
promoção. Divergência encontrada vira cenário novo, e um cenário nunca é apagado.

## 5. Onde cada coisa vive

| Peça | Onde | Por quê |
|---|---|---|
| Corpus (cenário + esperado + dispositivo) | `fiscal-platform`, extensão do corpus de maturidade | é o gabarito do motor; tem de viver junto dele |
| Runner caixa-preta (F0, F1, F3) | script Node contra o hml | milhares de `/simular` em minutos, sem tocar o NetSuite |
| E2E pelo bundle (F4) | tstdrv1647270, por REST (PATCH simula) e pelo Suitelet | prova a fronteira do bundle, não o motor |
| Credencial do runner | client OAuth **dedicado de teste**, por variável de ambiente | não reutilizar o client da Group Link nem ler o arquivo de credenciais em claro |

## 6. Critério de "estável"

- Zero 5xx em todo o corpus.
- F1 100% verde.
- F2 com zero divergências abertas: cada divergência tem dono, ou foi corrigida e virou
  cenário.
- Idempotência 100%.
- `/simular` com p95 abaixo de 2 s (hoje: 0,9 a 1,6 s por chamada isolada).

## 7. Achados já abertos (2026-10-19/20)

| Achado | Lado |
|---|---|
| Mesmo `idExterno` (3133) devolve chave nova a cada `/emitir` (cNF 78712509, 67591229, 02944426, 79742043, 33425338) | plataforma |
| `GET /fiscal/emitir/status-sefaz` responde 400 sempre | plataforma |
| Sem certificado, a nota fica em `RASCUNHO` e não há XML para baixar (`emissao.service.ts:3239`) | ambiente hml |
| NCM 85176272 abre em 2 CEST e exige declaração (comportamento correto, `CestAmbiguoParaONcmError`) | cadastro |

## 8. Ordem

1. **F0 + F1:** automáticos e sem dependência; já mostram o alcance e os 5xx.
2. **F3:** contrato e robustez, também automático.
3. **F2:** começar pelo ICMS de saída e PIS/COFINS, onde está o volume. Depende do contador.
4. **F4:** depende do A1 de homologação.
5. **F5:** liga quando houver corpus.
