# Resultados — testes contra o hml

Como rodar, a partir desta pasta:

- `node f1_fumaca.js` grava `f1_resultado.json` e `naturezas_hml.json`.
- `node f0_alcance.js` usa o `naturezas_hml.json` e grava `f0_alcance.json`.

A credencial vem de `fiscal-platform/CREDENCIAIS_OAUTH_HML.md`, lida em memória e nunca impressa
(`fp_hml.js`). Os `.json` de saída ficam fora do git.

## Rodada 1 — 2026-10-20 · empresa 10664687000113 (SP) · 69 naturezas

### F0 — alcance dos CFOPs

| | CFOPs |
|---|---|
| Catálogo | 657 |
| Saem de alguma natureza | 123 |
| Fora do escopo NF-e (energia 51, combustível 63, transporte 40, comunicação 36) | 190 |
| Revogados (`vigencia_fim`) | 38 |
| **Sem natureza** | **306**: compras 81, vendas 75, remessas 32, devoluções 22, compras para industrialização 14, ativo 13, devoluções com ST 10, exportações 10, outros 49 |

A classificação de "fora do escopo" é mecânica, por palavra-chave na descrição e no grupo. A
lista completa está em `f0_alcance.json`.

### F1 — fumaça natureza × âmbito

Foram **132 casos: 100 verdes**. p50 de 237 ms, p95 de 423 ms, máximo de 939 ms. Nenhum 5xx.

As asserções são só de consistência interna: HTTP 200, o CFOP devolvido é o da natureza no
âmbito, e todo tributo tem CST. **Isso não é o gabarito normativo.**

Contraparte usada: contribuinte LR em SP (interna), em MG (interestadual) e nos EUA (exterior).
Item: NCM 8517.62.72, CEST 21.110.00, origem 0, 2 × 100,00.

#### Defeitos confirmados (lado plataforma)

| # | Defeito | Prova | Onde |
|---|---|---|---|
| D1 | `COMPRA_ATIVO`, `COMPRA_USO` e `DEVOL_VENDA` com fornecedor de **SP ou MG** saem como **importação**: CFOP 3551/3556/3202, II 32,00, IPI_IMP, PIS_IMP e COFINS_IMP | `f1_resultado.json`, 6 casos | `tax-engine.service.ts:1436`. Força `EXTERIOR` sempre que a natureza tem `tipoOperacaoExterior=IMPORTACAO` e `cfopExterior` 3xxx, sem olhar o país da contraparte. As três naturezas cobrem os três âmbitos e têm esse flag. |
| D2 | `VENDA_ZFM` para **MG** sai com ICMS **CST 40 (isento)** | 6109, ICMS 40 = 0 | O benefício da ZFM exige destinatário na ZFM/ALC. Destino fora deveria recusar ou tributar. |
| D3 | `VENDA_ST` e `VENDA_ST_PRODUCAO` saem com CFOP de ST (5401, 5403, 6401, 6403), mas com **ICMS CST 00 e sem ICMS-ST** | 4 casos | CFOP de operação com ST e CST sem ST no mesmo item. Ou calcula a ST (CST 10), ou recusa dizendo que não há protocolo ou MVA para o NCM/CEST. |
| D4 | `VENDA_ST_SUBSTITUIDO`: interna devolve `ICMS_ST:60`, interestadual (6404) não devolve linha de ICMS_ST | 5405 × 6404 | Mesmo tributo, presença diferente por âmbito. |
| D5 | Sem nenhuma linha de CBS/IBS: `REMESSA_CONSIGN`, `ENTRADA_CONSIGN`, `RETORNO_CONSIGN`, `SIMPLES_FATURA` | 8 casos | Todas as outras operações devolvem CBS/IBS, mesmo quando é 410 com valor 0. A ausência de linha é ambígua. |
| D6 | Espelho incoerente entre remessa e entrada: `REMESSA_INDUST` e `REMESSA_DEMO` saem com ICMS 50 (suspensão), mas `ENTRADA_INDUST` e `ENTRADA_DEMO` saem com **ICMS 00 tributado**. `RETORNO_INDUST` é 50 na interna e **00 na interestadual**. | 6 casos | A mesma operação vista dos dois lados tem de ter o mesmo tratamento. |
| D7 | `VENDA_SERV_EXPORT`, `COMPL_PRECO`, `COMPL_IPI` e `COMPL_ICMS` não têm CFOP em âmbito nenhum. A primeira simula e devolve CFOP `null`. | catálogo | Cadastro. |

#### Recusas corretas (o harness precisa enriquecer o cenário)

- **13 casos de devolução e complemento:** a plataforma exige `chaveAcessoReferencia` da nota de
  origem. Na próxima rodada, usar uma chave de nota capturada.
- **8 casos `ENTRADA_TRANSF*`:** a plataforma recusa nota de entrada própria de transferência,
  citando o Conv. SINIEF s/nº 1970, art. 54, e o RICMS/SP, art. 136, I. Essas naturezas servem
  para escriturar a nota recebida (`/reclassificar`), não para o `/simular` de emissão.
- **4 casos de ISS sem CST:** falso positivo do teste. O ISS não tem CST no leiaute; a asserção
  já foi corrigida.

#### Suspeitas para o contador (precisam de gabarito com dispositivo)

1. **ICMS 00 tributado em operações que costumam ter suspensão ou não incidência:** remessa e
   retorno de depósito interna (5905/1906), remessa para conserto (5915), amostra grátis (5911).
2. **Entrada com PIS/COFINS CST 70** ("aquisição sem direito a crédito") **e valor calculado**
   (1,07 / 4,92). Com CST 70 o valor deveria ser só informativo, ou não existir.
3. **Importação com `ICMS_IMP` CST 00 e valor 0,00:** falta base ou gross-up.
4. **`SAIDA_ATIVO`:** PIS/COFINS 08 (não é receita) e CBS/IBS 000 tributado. Conferir com a
   LC 214/2025.
5. **`BONIFICACAO` e `REMESSA_BRINDE`** com PIS/COFINS 01 tributado.

## Rodada 2 — 2026-10-20 · tenants CORPUS A–D · contraparte não contribuinte e consumidor final

Seis execuções do F1 em paralelo:
- `EMP=<cnpj> [UF_EMP=ES] [CP=NAOCONTRIB|CF] SAIDA=r2_*.json node f1_fumaca.js`
- resultados: A, B e D com 104/132 · C com 102/132 · GL não contribuinte e GL consumidor final
  com 87/132.

Fora as falhas já conhecidas da rodada 1, os achados novos:

### O que confere (aritmética e alíquota contra a Res. SF 22/89, sem gabarito do contador)

- ES emitente: ICMS interno 17% (34,00 sobre 200). ES → MG a 12%; MG → ES a **7%** (ES recebe
  como N/NE/CO). Certo.
- Venda a não contribuinte: o motor troca 6101/6102 por **6107/6108**. Certo pela tabela CFOP; o
  runner já aceita.

### Defeitos

| # | Defeito | Prova |
|---|---|---|
| D8 | **DIFAL calculado onde a operação não tem ICMS**: `DEVOL_COMPRA` (41), `REMESSA_COMODATO` (41), `TRANSFER`/`TRANSFER_PROD` (90 = 0), `VENDA_ZFM` (40), `VENDA_ST_SUBSTITUIDO` (60). Todas com `ICMS_DIFAL` 19,90 para não contribuinte em MG. | `r2_gl_naocontrib.json`, `r2_gl_cf.json` |
| D9 | **Base de PIS/COFINS inconsistente entre tenants**. GL exclui o ICMS (0,65% × 164 = 1,07). CORPUS A, C e D não excluem (0,65% × 200 = 1,30; 1,65% × 200 = 3,30). O crédito da entrada no não cumulativo (C, `COMPRA` CST 50) também usa base 200. | `VENDA`/`COMPRA` nos 5 runs |
| D10 | **Simples Nacional (CORPUS B):** `DAS` = 36,00 / 24,00, igual ao ICMS de 18% / 12% da operação, e não à alíquota do anexo. Em `VENDA_SERV` sai linha `ICMS` com CSOSN 400 num item de serviço. | `r2_corpusB.json` |
| D11 | **ES sem régua para transferência interna** (5151/5152): a plataforma recusa com 400, embora a própria mensagem diga que a não incidência do art. 12, § 4º, da LC 87/96 vale. | `r2_corpusC.json` |

### Suspeitas para o contador

- O valor do `ICMS_DIFAL` é 19,90 em todos os casos para MG, com origem a 12% sobre 200. Conferir
  a metodologia (base única × base dupla) e o FCP de MG.
- CORPUS D ("sem setor") recolhe IPI 15% na venda de produção (`VENDA_PROD`). Conferir se ser
  equiparado a industrial vem do setor ou da natureza.
- Simples (B) sem nenhuma linha de CBS/IBS em 2026.

## Rodada 3 — 2026-10-20 · F3 contrato e robustez (`node f3_contrato.js`)

Foram 28 casos de contrato e mais 1 de concorrência. Nenhum 5xx.

| # | Achado | Esperado | Obtido |
|---|---|---|---|
| C1 | Sem `naturezaOperacaoId` | 4xx | **200**, cai em natureza padrão |
| C2 | `contraparte.uf = "XX"` | 4xx | **200** |
| C3 | CNPJ da contraparte com DV inválido | 4xx | **200**. Vira rejeição da SEFAZ na emissão. |
| C4 | `valorTotal` 999 com preço × quantidade = 200 | 4xx | **200**, com o total declarado ignorado em silêncio (totalNf 200) |
| C5 | `numeroItem` repetido | 4xx | **200**. A SEFAZ rejeita nItem duplicado. |
| C6 | Desconto 500 num item de 200 | 4xx | **200**, com totalNf 0 |
| C7 | Data `2026-13-45` | 4xx com causa | 400 com mensagem genérica ("Não foi possível concluir operação") |
| **C8** | **Corpo acima de 100 KB dá 413.** Com um payload enxuto (≈ 203 bytes por linha), o teto fica em ~490 linhas. Com payload do bundle (mais campos por linha), o teto é menor. | aceitar a nota inteira (até 990 itens) | 413 com 101 KB |
| **C9** | **Latência linear de ~200 ms por linha** (10 linhas: 2,0 s · 50: 10,0 s · 100: 22,3 s). O `N/https` do NetSuite corta em 45 s, ou seja, ~220 linhas. | uma nota de 990 itens dentro de 45 s | 990 itens ≈ 200 s |
| C10 | 30 simulações iguais em paralelo | todas 200 e iguais | ✔ 30 × 200, 1 resultado distinto. p50 de 3,4 s (≈ 9 req/s). |

C8 e C9 são bloqueantes para nota grande. É o caso da "nota de 500 linhas" da memória do
projeto.

## Rodada 4 — 2026-10-20 · produtos com regra própria (`node f4_produtos.js`)

12 produtos × `VENDA`/`VENDA_PROD` × SP/MG = **48 casos**. GL (SP), contribuinte LR. Nenhum 5xx.

### O que confere
- Importado com origem 1, 2 e 3 indo para MG: **4%** (Res. SF 13/2012). Na interna fica 18%.
- Cosmético 3304: na revenda, CST 04 (monofásico, alíquota zero). No fabricante, CST 02 com
  **2,2% / 10,3%** (Lei 10.147/2000).
- Recusas bem fundamentadas, que o harness precisa enriquecer:
  - cerveja do fabricante pede volume (valor mínimo por litro, Lei 13.097/2015);
  - cigarro do fabricante pede preço de varejo (LC 70/91, art. 3º);
  - NCM com vários CEST pede o CEST (cerveja 8, medicamento 12).

### Defeitos

| # | Defeito | Prova |
|---|---|---|
| D12 | **Gasolina (2710.12.59, CEST 06.002.01)** sai com ICMS 00 a 18% *ad valorem* e PIS/COFINS 01. ICMS monofásico de combustível é *ad rem* (LC 192/2022, Conv. ICMS 199/2022, CST 02/15/61). PIS/COFINS é monofásico. | gasolina × 4 |
| D13 | **Pneu 4011.10.00 e autopeça 8708.30.90** saem com PIS/COFINS **CST 01**. Os dois são monofásicos (Lei 10.485/2002): fabricante com CST 02 (2% / 9,5% no pneu), revenda com CST 04. | pneu e autopeça × 4 |
| D14 | **Cerveja de lata para MG, ST com MVA 0**: ICMS_ST 18% = 12,00 = 36 − 24, como se a base ST fosse o próprio valor da operação. | cerveja-lata/VENDA/MG |
| D15 | **Cerveja de lata na revenda interna em SP**: ICMS 00 sem ST, enquanto a mesma mercadoria para MG tem ST (CST 10). | cerveja-lata/VENDA/SP |

### Suspeitas para o contador
- PIS/COFINS da **revenda de cerveja** com CST 01, cumulativo. Pela Lei 13.097/2015, a revenda de
  bebida fria por atacadista ou varejista teria alíquota zero.
- Pneu na lista de ST (Conv. ICMS 92/2015, segmento 16) e smartphone (21.053) sem ICMS-ST em
  nenhum caso.
- Cigarro interno SP a 25%: conferir a alíquota vigente do RICMS/SP e o FCP.
- `VENDA_PROD` da GL **sem IPI** em todo produto. Os CORPUS industriais destacam IPI. É
  configuração do tenant? Conferir.

## Rodada 6 — 2026-10-20 · DIFAL nas 26 UFs de destino (`node f6_difal.js`)

Venda de SP para consumidor final não contribuinte (CPF), 1 × 100,00, nas 26 UFs de destino.
Origem 0 (nacional) e 1 (importado). São 52 casos, todos com HTTP 200 e CFOP 6108.

### O que confere
- Alíquota interestadual: **12%** para MG, PR, RJ, RS e SC; **7%** para N/NE/CO e ES; **4%** para
  o importado (Res. SF 22/89 e 13/2012).
- A alíquota interna de destino que o motor usa (interestadual + DIFAL) é plausível nas 26. Por
  exemplo: MG 18, RJ 20, MA 23, PI 22,5, AL 20,5, ES 17, RS 17, SC 17. O valor exato de cada uma
  fica para o contador, porque não há gabarito por UF.

### Defeitos

| # | Defeito | Prova |
|---|---|---|
| D16 | **Base dupla sem excluir o ICMS de origem.** O motor calcula base = V ÷ (1 − alíq. destino). Em MG: 100 ÷ 0,82 = 121,95, e DIFAL = 21,95 − 12 = **9,95**. Pela fórmula da base dupla, base = (V − ICMS origem) ÷ (1 − alíq. destino) = 88 ÷ 0,82 = 107,32, e DIFAL = 19,32 − 12 = **7,32**. O DIFAL sai **a maior** em todas as 26 UFs. | `r6_difal.json`. O comentário do motor diz "DIFAL EC87 base dupla (Conv. 236)". |
| D17 | **Base dupla aplicada às 26 UFs.** Cada UF escolheu base única ou base dupla na própria lei; o motor não distingue. | todas as UFs têm o mesmo padrão |
| D18 | **FCP ausente em todas as UFs.** Nenhuma linha de FCP para consumidor final, nem onde a UF tem FCP sobre o DIFAL (RJ 2%, por exemplo; LC 87/96, art. 82 do ADCT). | coluna FCP vazia nas 52 |

> Para o contador: confirmar a fórmula do D16 na cláusula do Conv. ICMS 236/2021 / LC 190/2022
> (art. 13, § 1º, da LC 87/96) e levantar, por UF, base única × base dupla e o FCP.

## Rodada 5 — 2026-10-20 · devolução e complemento com chave referenciada (`node f5_referencia.js`)

Chaves usadas:
- **PRÓPRIA:** a NF-e da fatura 3133 (`…1334253385`), emitida no hml e parada em `RASCUNHO`.
  Venda para Manaus/AM, 2 × 160,00.
- **TERCEIRO:** chave sintética com DV válido, que a plataforma nunca viu.
- **DV_RUIM:** a mesma chave de terceiro, com o DV trocado.

### O que confere
- Recusas com causa, sem nenhum 5xx:
  - venda de origem não encontrada;
  - nota de origem não capturada (devolução de compra);
  - a nota não é de entrada (devolução de compra que referencia uma saída);
  - destinatário diverge da nota complementada (complemento).
- Na devolução, o CFOP e o âmbito saem **da nota de origem** e não do payload: 2201/2411
  (interestadual, AM), mesmo com contraparte SP. Isso é o espelho.

### Defeitos

| # | Defeito | Prova |
|---|---|---|
| D19 | **Devolução parcial ignora a quantidade e o valor do payload**: devolve sempre a nota inteira. 1 × 100, 1 × 160, 2 × 160 e **5 × 160** (mais do que foi vendido) dão todos totalNf 320 e ICMS 22,40. | `DEVOL_VENDA_PROD` com a chave própria |
| D20 | **Aceita devolver e complementar nota que nunca foi autorizada** (`RASCUNHO`, sem protocolo). A SEFAZ rejeita referência a nota inexistente. | as 3 naturezas com a chave própria |
| D21 | **Complementos saem com CFOP `null`** (`COMPL_PRECO`, `COMPL_ICMS`, `COMPL_IPI`). A mensagem do próprio motor diz que o CFOP sai do documento original. Agrava o D7. | `totalNf` 10, `cfopCodigo` null |
| D22 | **`COMPL_ICMS` e `COMPL_IPI` destacam ICMS 0,70 sobre a base 10**, como numa venda. Complemento de ICMS leva só o imposto complementar, e o de IPI não leva ICMS. | 3 complementos com o mesmo ICMS |
| C11 | Chave com DV inválido recebe "não encontrada" em vez de "chave inválida". | DV_RUIM |

## Rodada 4b — 2026-10-20 · IPI NT, alíquota zero e tributado (`VENDA_PROD`, SP)

| NCM | CORPUS A (industrial) | GL |
|---|---|---|
| 0101.21.00 (NT) | IPI **53** = 0 ✔ | sem IPI |
| 0201.10.00 (TIPI 0%) | IPI **51** = 0 ✔ · ICMS 20, carga efetiva 7% | sem IPI |
| 8517.62.72 (15%) | IPI **50** 15% = 30 ✔ | sem IPI |

Os CSTs de IPI conferem com a IN RFB 1.009/2010. O IPI da GL segue ausente; ver a suspeita da
rodada 4.

Suspeita para o contador: o reprodutor de raça pura (0101.21.00) sai com ICMS 18%. Conferir a
isenção do Conv. ICMS 35/77 / RICMS-SP.

## Próximas rodadas

- [x] **Rodada 4, produtos com regra própria:** feita, D12–D15
  - [ ] ST com protocolo, e MVA original × ajustada (bebidas 2203, autopeças 8708, pneus 4011);
  - [x] monofásico PIS/COFINS (D13; medicamento depende de CEST).
  - [x] IPI alíquota zero e NT (rodada 4b);
  - [x] importado com alíquota de 4% (origem 1/2).
- [x] **Rodada 5, devolução e complemento:** feita, D19–D22. Falta o `/reclassificar`. chave de nota emitida no hml. Mais o `/reclassificar` da entrada.
- [x] **Rodada 6, DIFAL:** feita, D16–D18. não contribuinte, um caso por UF.
- [ ] **F2, gabarito do contador** para as suspeitas e para D28, D29, T1 e T2.
- [ ] Rodada 5: nota de origem com ICMS destacado para o D22; `/reclassificar` com nota de fornecedor.
- [ ] F4, XML por natureza: depende de autorizar `/emitir` em lote na série de homologação.

## Rodada 7 — 2026-10-21 · reteste completo após o deploy da plataforma (313 naturezas)

Plataforma em `2bab039b` (D19, D20 e C11 corrigidos em `8050e378`/`e36a8ec8`; captura de nota
própria em `c13b9dd8`; XML montado sem certificado em `2bab039b`). Saídas `r7_*.json`/`r7_*.log`.

- **F1** em 7 cenários (GL contribuinte, não contribuinte, consumidor final, CORPUS A–D): 594 casos
  cada, **473 verdes** em todos (C: 470). **Nenhum 5xx.** As falhas restantes são recusas corretas
  (devolução/complemento sem chave: 98; entrada própria de transferência: 20) mais os defeitos abaixo.
- Contra a rodada anterior (`f1_pos.json`): 16 casos passaram de 200 a 400, **todos devolução sem
  `chaveAcessoReferencia`**, que antes simulava como operação comum. É correção. Nenhum caso verde
  mudou de imposto.
- **F4 e F6** idênticos à rodada anterior (D12–D18 seguem). **F3**: C1–C8 seguem; a latência não é
  comparável, porque rodou em paralelo com outros nove jobs.

### Devolução e complemento com as seis notas autorizadas (`f5_referencia.js` reescrito)

Fonte: `Downloads/xml-hml-devolucao/LEIA-ME.md`. As vendas 6101, 6102 e 6401 tinham sido capturadas
antes do deploy da captura própria e só existiam como ENTRADA na 0385. Foram recapturadas pela
0001 (201, SAÍDA, `RECEBIDO`). 22 casos, 18 conforme o esperado.

| Caso | Resultado |
|---|---|
| Devolução total 5101, 5102, 6101 | ✔ 1201 / 1202 / 2201, espelho dos valores |
| Parcial 5401, 3 de 10 | ✔ 1410, vProd 300, ICMS 54, ST 34,18 (30% exatos) |
| 11 de 10 · quantidade sem `numeroLinhaReferencia` · item inexistente | ✔ recusados com causa (**D19 corrigido**) |
| Nota em RASCUNHO, para devolução e complemento | ✔ recusada, rejeição 267 (**D20 corrigido**) |
| DV inválido | ✔ "chave inválida", rejeição 547 (**C11 corrigido**) |
| Devolução de compra referenciando uma saída | ✔ recusada |
| COMPL_PRECO, COMPL_ICMS e COMPL_IPI da 5102 | ✔ CFOP **5102 herdado** (**D21 corrigido**) |
| Complemento com outro destinatário | ✔ recusado |

O complemento exige `numeroLinhaReferencia` (`complemento-integracao.ts:312`), coisa que o
LEIA-ME não diz.

### Situação dos defeitos anteriores

| # | Situação |
|---|---|
| D1 | ✔ corrigido: `COMPRA_ATIVO`/`COMPRA_USO` saem 1551/2551 e 1556/2556 nacionais |
| D2, D3, D4, D9, D10, D11 | seguem iguais. D11 agora também em SP: `CFOP_S408` e `CFOP_S409` interna sem régua |
| D5 | parcial: `SIMPLES_FATURA` segue sem CBS/IBS. **Consignação agora traz IBS estadual e municipal sem a linha de CBS** |
| D6 | parcial: `ENTRADA_DEMO` ✔ (50). `ENTRADA_INDUST` segue com 00, e `RETORNO_INDUST` interestadual (2902) também |
| D7 | `VENDA_SERV_EXPORT` segue com CFOP `null` (e `ISS` sem CST, valor 0) |
| D8 | parcial: comodato ✔ sem DIFAL. `TRANSFER` (90), `VENDA_ZFM` (40) e `VENDA_ST_SUBSTITUIDO` (60) seguem com DIFAL 19,90 |
| D12–D18 | seguem (F4/F6 idênticos) |
| D19, D20, D21, C11 | ✔ corrigidos |
| D22 | segue: ver a rodada 8 |

### Defeitos novos

| # | Defeito | Prova |
|---|---|---|
| D23 | **A nota referenciada é buscada só pela chave, sem filial.** A 6102 e a 6401 (GL 0001 → GL 0385) estão escrituradas nas duas pontas, e a devolução e o complemento da 0001 pegaram a ENTRADA da 0385: "não é de SAÍDA" e "é de ENTRADA". A 6101, igual, passou por sorte da ordem. | `devolucao-integracao.ts:92` e `complemento-integracao.ts:185`: `findOne({ where: { chaveAcesso } })`. O controller de transações já documenta que a unicidade é `(branch_id, chave)`. |
| D24 | **A devolução perde o IPI da origem.** 5102 (IPI 3,25) devolve totalNf 100. 5401 10/10 (IPI 150) devolve 1.113,94 contra 1.263,94 da origem. As cinco `DEVOL_VENDA*` têm `geraIpi=false`. | `r7_referencia.json`. É cadastro da natureza, já que o espelho respeita os indicadores (`b4173c1f`). Para o contador: a nota de devolução destaca o IPI da origem para o crédito (RIPI/2010, art. 229 e seguintes). |
| D25 | **Complemento sem IPI.** `COMPL_PRECO` e `COMPL_IPI` da 5102 (origem com IPI 50, 3,25) não devolvem linha de IPI. | Causa: cadastro. O motor zera o IPI de saída quando `companies.sujeito_ipi = false` (`tax-engine.service.ts:8790`). No hml (`GET /companies`), a GL está `false`, mas as vendas de origem dela destacaram IPI; é a mesma causa da "GL sem IPI" da rodada 4. Com `true` no hml: CORPUS A (LP), C (LR, ES) e D (LP). Com `false`: GL e CORPUS B (Simples). |

### XML

A plataforma agora devolve o XML montado sem certificado (`GET /fiscal/emitir/{chave}/xml`). O da
fatura 3133 foi validado contra `nfe_v4.00.xsd` (`fiscal-platform/.../emissao/schemas`):
**válido**, faltando só a `ds:Signature`. Para validar o resto, foi injetada uma assinatura só de
forma. As seis vendas autorizadas também passam. O DANFE recusa nota não autorizada (400, correto).

O XML por natureza precisa de `/emitir`, que consome numeração da série de homologação.

## Rodada 8 — 2026-10-21 · GL sujeita a IPI e vendas com ICMS destacado

Duas mudanças antes de rodar:
- **Cadastro no hml:** a GL foi de `sujeitoIpi=false` para `true` (`PATCH /companies/73b71ab1-…`).
  As vendas reais dela destacam IPI (5102 nNF133: 3,25; nNF129: 75,00), então o `false` era o
  erro. Para desfazer, basta o mesmo PATCH com `false`.
- **Notas novas:** 6102 nNF170 (SC, ICMS 12% = 617,24) e 5102 nNF129 (Santos, ICMS CST 10 com ST
  56,97, IPI 75,00), capturadas como SAÍDA pela GL. O runner de captura é `captura.js`.

Resultados: `r8_referencia.json`, `r8_gl.json`, `r8_produtos.json`.

### O que confere
- **D25 corrigido pelo cadastro:** os complementos da 5102 agora trazem IPI (50, 3,25%).
- F1 da GL: 126 casos passam a ter IPI (`VENDA_PROD` 50 a 15%, `REMESSA_INDUST` e `TRANSFER_PROD`
  com 55). **Nenhum outro tributo mudou** em nenhum caso.
- F4: `VENDA_PROD` com a alíquota da TIPI por NCM (pneu 9,75; smartphone 15; 0101 com 53).
- Devolução parcial de 5 de 25 da 6102: 2202, vProd 1.028,73 e ICMS 123,45 (20% exatos de 617,24).
- `DEVOL_VENDA_ST` da nNF129 traz a ST da origem: ICMS_ST 10 = 56,97.

### Defeitos

| # | Defeito | Prova |
|---|---|---|
| D22 | **segue.** `COMPL_ICMS` da 6102 trata o valor da linha (10) como **base** e calcula 12% = 1,20, com totalNf 10. `COMPL_IPI` da nNF129 calcula **ICMS 1,80** além do IPI 1,50. O complemento de imposto leva o valor do imposto complementado, não uma operação sobre nova base, e o de IPI não leva ICMS. | `r8_referencia.json` |
| D24 | **segue mesmo com a GL sujeita a IPI:** a devolução da nNF129 devolve totalNf 500, sem os 75,00 de IPI. É o `geraIpi=false` das `DEVOL_VENDA*`. | 5102 ST+IPI total |
| D26 | **A devolução por `DEVOL_VENDA` perde a ST da origem e mantém o CST 10.** A nNF129 (CST 10, ST 56,97) devolvida como `DEVOL_VENDA` sai com ICMS **CST 10 sem linha de ICMS_ST** (totalNf 500). Como `DEVOL_VENDA_ST` vem certa (556,97). O ERP escolhe a natureza pela venda e a venda era 5102. Ou a devolução segue a situação da origem, ou recusa a natureza. | 5102 ST+IPI × DEVOL_VENDA |
| D27 | **`COMPL_PRECO` de item com ST não herda o CST nem calcula a ST.** O complemento de preço da nNF129 sai com ICMS **CST 00** (1,80) e sem ICMS_ST, quando a origem é CST 10. O próprio `complemento-integracao.ts` deixa o CST do complemento "em aval". | COMPL_PRECO 5102 (ST) |

### Suspeitas para o contador
- `VENDA` (revenda) da GL sai **sem IPI**, até para o notebook importado (origem 1). O importador
  que revende é equiparado a industrial (RIPI/2010, art. 9º, I). E a venda real nNF129, uma 5102,
  destacou IPI. Conferir se a revenda da GL deve destacar.
- `DEVOL_COMPRA_PROD` destaca IPI só no âmbito exterior (7201), não na interna nem na
  interestadual.

## Rodada 9 — 2026-10-21 · reteste após `21f2c0ba` e revisão da tabela de naturezas

Plataforma até `21f2c0ba`: D22 e D27 (complementar), D26 (devolução com ST), D23 e D24
(origem pela filial; o IPI volta), IPI na revenda do importado na régua, naturezas renomeadas
com natOp literal. Saídas `r9_*`. Tabela gravada em `naturezas_hml_r9.json` e `nat_r9.txt`.

### Tabela de naturezas

- Agora são **314** (+1: `REMESSA_ARMAZEM_GERAL`, separada de `REMESSA_DEPOSITO`). Foram **244
  códigos renomeados** e **257 descrições trocadas**. Nenhum indicador mudou: CFOP, `gera*`,
  finalidade, E/S e tipo de exterior seguem iguais.
- Conferências mecânicas: **nenhuma descrição passa de 60** caracteres; todos os códigos estão no
  padrão (`[A-Z_]`); nenhum CFOP está em sentido trocado (E com 5/6/7, S com 1/2/3) nem no âmbito
  errado.
- **NetSuite:** os 69 registros de `customrecord_fp_natureza_operacao` da tstdrv1647270 continuam
  existindo no hml com o mesmo código. A renomeação não afetou o bundle, porque ele manda o
  *nome* do registro.

| # | Achado na tabela | Prova |
|---|---|---|
| T1 | **Entrega futura com PIS/COFINS dobrado na revenda.** `SIMPLES_FATURA` (5922) tem `geraPisCofins`, e `REMESSA_FUTURA` (5117, revenda) também tem, enquanto `VENDA_PROD_ENTREGA_FUTURA` (5116, produção) não tem. As duas remessas são a mesma operação e divergem. Se a receita é reconhecida no faturamento, a remessa 5117 cobra de novo. | `nat_r9.txt` |
| T2 | **Mesmo CFOP com indicadores diferentes:** 1923/2923 (`ENTRADA_ARMAZEM_OUTRA_UF` IP × `ENTRADA_VENDA_ORDEM` sem nada) e 5923/6923 (`REMESSA_ARMAZEM_OUTRA_UF` IP × `REMESSA_VENDA_ORDEM` sem nada). O ERP que escolhe uma ou outra muda ICMS e IPI na mesma operação. Conferir se a do armazém de outra UF é procedimento de UF específica e merece nota no cadastro. | idem |
| T3 | **Causa do D5:** a CBS segue `geraCbs ?? geraPisCofins` (`tax-engine.service.ts:9645`), e o IBS segue `geraIcms`. Na consignação (`REMESSA_CONSIGN`: ICMS sim, PIS não, CBS null) sai IBS sem CBS. São dois eixos para a mesma incidência da LC 214/2025. | `r9_gl.json` |
| T4 | Descrições iguais em pares com sentido oposto (`RECLASSIF_KIT_ENTRADA`/`_SAIDA`, `RESSARC_ICMS_ST_ENTRADA`/`_SAIDA`) e em pares de natOp literal (`TRANSFER`/`TRANSFER_PROD`, `REMESSA_FUTURA`/`VENDA_PROD_ENTREGA_FUTURA`). O literal é da norma, então está certo, mas nos dois primeiros o natOp não diz se é entrada ou saída. | idem |

### Devolução e complemento (`f5_referencia.js` atualizado para o contrato da `21f2c0ba`)

O complemento de imposto agora manda só a referência, com `valorProduto` 0. **30 casos, 28
conforme o esperado.**

| Caso | Resultado |
|---|---|
| Notas entre filiais (6102 nNF134, 6401 nNF86) | ✔ **D23 corrigido**: 2202 e 2410, parcial por item 4/10 + 2/2 = 726,80 |
| 5401 inteira, 5102 nNF133, 5401 3/10 | ✔ **D24 corrigido**: 1.263,94 (IPI 150), 103,25 (IPI 3,25), IPI 45 |
| nNF129 (CST 10, ST) por `DEVOL_VENDA` | ✔ **D26 corrigido**: recusa apontando a natureza de ST. Por `DEVOL_VENDA_ST`: 1411, total 631,97 = 500 + ST 56,97 + IPI 75; metade = 315,98 |
| `COMPL_ICMS` da 6102 com ICMS certo · `COMPL_IPI` da nNF129 com IPI | ✔ recusa: "já é o devido" (**D22 corrigido**: não calcula mais ICMS de venda) |
| `COMPL_PRECO` da nNF129 (CST 10) | ✔ **D27 corrigido**: CST 10 herdado, ICMS 1,80, ST 1,14 e IPI 1,50 |

### Defeitos

| # | Defeito | Prova |
|---|---|---|
| D28 | **Complemento de preço e de imposto seguem critérios diferentes para o mesmo item.** Na nNF129 (revenda 5102 de produto nacional), o `COMPL_PRECO` herda da origem (CST 10, ST, IPI 50 = 1,50), mas o `COMPL_IPI` recalcula pela régua e responde "nenhum tributo de IPI devido na operação original". Pela régua a revenda nacional não debita IPI nem tem ST para 8517.62.72 / 21.110.00 em SP (`VENDA` simulada: ICMS 00 18%, sem IPI, sem ST). Um dos dois está errado: ou a venda original destacou IPI e ST indevidos, e o complemento de preço repete o erro, ou a régua está incompleta (D15). | `r9_referencia.json` e a simulação da `VENDA` |
| D29 | **ICMS CST 00 com alíquota 0%** no NCM 9030.84.90, em `VENDA` e `VENDA_PROD` internas SP. Também vale para a origem nNF133, que a plataforma emitiu assim. CST 00 é "tributada integralmente", e alíquota zero com esse CST é incoerente. Ou falta a alíquota na régua, ou o CST é outro (20, 40, 41). Por isso o `COMPL_ICMS` da nNF133 diz "devido 0,00". | simulação da `VENDA` e da `VENDA_PROD` com 90308490 |

### F4 e F6
- F4: a única mudança é o **notebook importado (origem 1) na `VENDA`**, que agora tem IPI 50 a 15%
  em SP e em MG (RIPI, art. 9º, I). O móvel de origem 2 (adquirido no mercado interno) segue sem
  IPI, o que está certo.
- F6 (DIFAL): idêntico. D16, D17 e D18 seguem.

### F1 e F3 (rodada 9)

- **F1:** 596 casos por cenário (314 naturezas). Verdes: GL contribuinte, não contribuinte e
  consumidor final, CORPUS A, B e D com **475**; C com **472**. **Nenhum 5xx.** As falhas são as
  recusas corretas já conhecidas e os defeitos abertos.
- Contra a rodada 8, com os códigos mapeados pelo `id`: a única natureza nova,
  `REMESSA_ARMAZEM_GERAL`, sai interna 5905 com ICMS 41 e interestadual 6905 com ICMS 00. Isso
  confere com a LC 87/96, art. 3º, VI: a não incidência é só na mesma UF.
- **Efeito colateral da renomeação no harness:** o `f1_fumaca.js` decide serviço × mercadoria pelo
  `/SERV/` no código. As renomeadas `ANULA_SERV_*`, `COMPRA_SERV_*` e `DEVOL_COMPRA_SERV` passaram a
  receber um item de serviço (LC 116 1.07), e isso expôs o defeito abaixo.

| # | Defeito | Prova |
|---|---|---|
| D30 | **ICMS e ISS no mesmo item.** Com um item LC 116 1.07, `COMPRA_SERV_ICMS`, `ANULA_SERV_COMUNIC` e `ANULA_SERV_TRANSPORTE` devolvem **ICMS 00 = 36 e ISS = 5,80** juntos. O serviço de comunicação ou de transporte é ICMS (LC 87/96, art. 2º, II e III). Um subitem da LC 116 nessa natureza é declaração incoerente: o motor deveria recusar, não cobrar os dois. `COMPRA_SERV_ISS` também sai com ICMS 36 junto com o ISS. | `r9_gl.json` |

- **F3:** igual à rodada 7. C1–C6 seguem, e C8 também (413 com 990 linhas). Rodado sozinho, a
  latência caiu: 100 linhas em **19,1 s** (era 22,3 s; ~190 ms por linha) e concorrência de 30 com
  p50 de 3,0 s. O C9 segue: ~230 linhas cabem nos 45 s do `N/https`.
- Durante os dez jobs em paralelo, o `/oauth/token` devolveu **403** para dois tenants, e na hora
  seguinte deu 200. Parece limite de taxa no balanceador. Vale saber, porque é o que o bundle vê
  num pico.

## Rodada 10 — 2026-10-21 · todos os NCM pelo bundle (interrompida)

Pelo NetSuite (tstdrv1647270), não direto na API: um item `FP-NCM-<ncm>[-<cest>]` por NCM × CEST (14.909 itens),
uma location e um cliente contribuinte por UF (`locations_uf.json`, `clientes_uf.json`) e uma filial da GL por UF
no hml (`filiais_uf.js`). O `f8_ns_ncm.js` cria pedidos de venda (`VENDA`) de 100 linhas; o `a8_ns_ncm.js` lê no
File Cabinet o payload e o retorno gravados pelo bundle. **Parou por falta de memória da máquina** no lote AC 057:
62 pedidos, 0 falhas do bundle, retomável pelo memo (faltam os lotes AC 038, 039, 041 e 042 e as outras 26 UFs).

| # | Defeito | Prova |
|---|---|---|
| D31 | **NCM extinto responde "NCM X não encontrado" (404)**, sem dizer que foi extinto nem qual o sucessor. São 7 casos: 1001.91.10→1001.91.00, 2204.10.00→2204.10.10/90, 2208.20.20→2208.20.00, 6402.99.39→6402.99.10/90, 8418.10.10→8418.10.00, 8517.12.13→8517.13.00, 8521.10.00→8521.10.10/81/89/90. O `buscarNcmPorCodigo` filtra `ativo = true` (`tax-engine.service.ts:3775-3790`). No 8517.12.13 sem CEST, a checagem de CEST ambíguo (`regua-cest.ts:249`) vem antes e pede para escolher o CEST de um NCM extinto. | pedidos `FP NCM EXTINTO *` |
| D32 | **O motor faz ~7 linhas/s no total e não escala com concorrência.** 100 linhas: 13,9 s sozinha e ~30 s com 4 em paralelo. 300 linhas: 38,2 s sozinha e 504 aos 60 s em paralelo. Uma nota acima de ~330 linhas passa dos 45 s do `N/https` mesmo com o hml ocioso. Pelo bundle, o pedido salva **sem tributo** (`SSS_REQUEST_TIME_EXCEEDED` cai no catch). | pedidos 3333 e 3334, `r10_ns_pedidos_lote300.log` |

D29 também aparece pelo bundle: no AC, o café 0901.11.10 sai com CST 00 a 0% (7 linhas).

## Rodada 11 — 2026-10-21 · régua nova (27 UFs, cesta, FECP/FECOEP, monofásico) pelo bundle

`f9_ns_regua.js`: um pedido de venda interna por UF (location e cliente contribuinte da UF, `VENDA`), com 31 NCM
de cesta básica, combustível e controle; o frango 0207.14.00 não tem item. `d9_regua.js` lê payload e retorno:
`r11_ns_detalhe.json` / `.log`.
**Bundle: 27 de 27 pedidos sem falha.** O payload trouxe 31 linhas com o NCM e o CEST do item, e o retorno, 31 linhas.

Quadro: ICMS como `CST/valor`, em R$, sobre 100. `+n` é o FCP ou FECOEP.

| UF | arroz | farinha mand. | óleo | açúcar | cerveja | etanol | cigarro | gasolina | GLP | feijão | leite | ovos | banana |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC | 00/17 | 00/19 | 00/19 | 00/19 | 00/27 | 00/19 | 00/30 | 00/19 | 00/19 | 00/19 | 00/19 | 00/19 | 00/0 |
| AL | 00/20,5 | 20/7 | 20/7 | 00/20,5+1 | 00/27+2 | 00/20,5+1 | 00/29+2 | 00/20,5+1 | 00/20,5+1 | 00/20,5 | 00/20,5+1 | 00/20,5+1 | 00/0+1 |
| RJ | 00/12 | 00/20 | 00/20 | 00/20 | 00/17+2 | 00/20+2 | 20/27+2 | 00/20+2 | 00/20 | 00/12 | 00/20+2 | 00/20+2 | 00/0+2 |
| SE | 00/12 | 00/19 | 00/12 | 00/19 | 00/25 | 00/19 | 00/28 | 00/19 | 00/19 | 00/12 | 00/19 | 00/19 | 00/0 |
| SP | 20/7 | 20/7 | 20/7 | 20/7 | 00/20 | 00/18 | 00/30 | 00/18 | 00/18 | 20/7 | 00/18 | 00/18 | 40/0 |

As 27 UFs estão no `r11_ns_detalhe.log`.

| # | Defeito | Prova |
|---|---|---|
| D33 | **Combustível sem monofásico: o defeito é do BUNDLE, não da régua.** O payload não leva `cProdANP` (nem `descANP`, `pBio`, `origComb`, `UFCons`): o bundle não tem campo de ANP no item e o mapeador não monta o grupo. Sem `cProdANP`, que é a chave do monofásico (`icms-monofasico.ts`, `regua-cprodanp.ts`; DTO `simulacao-nota-input.dto.ts:1338-1399`), o motor faz o cálculo comum: gasolina, diesel, etanol e GLP saem com ICMS 00, PIS/COFINS 01 e CBS 000 nas 27 UFs (108 casos). Natureza `VENDA`; os NCM são 2710.12.59/CEST 06.002.00, 2710.19.21/06.006.00, 2207.10.90 (sem CEST) e 2711.19.10/06.011.00. Com o `cProdANP`, o motor também exige `unidadeTributavel` igual à da tabela (rejeição 854), `quantidadeTributavel` > 0, `pBio` nos produtos com mistura (908) e `origComb` nos marcados (909). | payload do pedido 4133 |
| D34 | **O FECOEP de SE não sai em nenhuma linha**, nem em cerveja, cigarro ou perfume. | pedido 4134 |
| D35 | **CST 00 com alíquota 0%**, o mesmo padrão do D29, na banana 0803.90.00 em 22 UFs. Só SP e AP saem com CST 40. O CE sai com CST 20 e valor zero. | `r11_ns_detalhe.json` |

### Suspeitas para o contador (rodada 11)
- **FECP do RJ sem padrão aparente.**
  - Sai a 2% em leite, ovos, pão, manteiga, batata, banana, peixe, gasolina, diesel e etanol.
  - Não sai em arroz, feijão, café, açúcar, farinha, óleo, sal, carne nem GLP.
  - Em cigarro e perfume, que saem com CST 20, o FECP de 2% incide sobre a base cheia.
- **FECOEP de AL em quase tudo:** sai a 1% em leite, carne, computador e combustível, e a 2% em bebida, fumo e perfume. Conferir se a lei estadual alcança esses produtos.
- **Cesta de AL desigual:** farinha de mandioca, óleo e sal saem a 7%; arroz e feijão, a 20,5%.
- **UFs sem nenhum benefício na amostra:** AC, AM, PA, PE, PR e TO (a de MA, PA e RO está anunciada como pendente).
- **CBS/IBS (2026, ano-teste), contraparte contribuinte LR com IE e CNPJ:** arroz sai com CST 200 / cClassTrib 200003 a zero; banana, com 200 / 200014 a zero; **ovos 0407.21.00, com 000 / 000001 cheio** (CBS 0,9 e IBS 0,1), em todas as 27 UFs. Ovo é hortifrúti com alíquota zero, como a banana, pelo art. 137 e o Anexo XV da LC 214/2025: é provável que falte o NCM na régua. O contador deve confirmar o anexo.

## Rodada 12 — 2026-10-22 · monofásico pelo bundle (só SP; parada)

`f10_ns_monofasico.js`: dois pedidos de venda interna por UF (`VENDA`). O grupo **PIS** tem medicamento, perfumaria, pneu,
autopeça, veículo, bebida fria e etanol. O grupo **COMB** tem gasolina, diesel, GLP e biodiesel. Leitura:
`RODADA=r12 node d9_regua.js` → `r12_ns_detalhe.json`.
**Parada depois de SP:** o hml roda `hml-219f6de74b10` (ECS `fp-hml`, serviços api/web, deploy de 22/10 01:13 UTC).
Os commits `39a19a4b` (combustível da LC 192: recusa sem cProdANP, CFOP 5.65x, PIS/COFINS 04) e `20d00586` (Anexo XV)
estão na `origin/main`, mas não têm imagem no ECR `fp-hml-api`, ou seja, o deploy-hml não rodou para eles.
Medir as outras 26 UFs agora seria medir a versão antiga.

SP, pedidos 4833 (COMB) e 4834 (PIS), 103 s cada:

| NCM | Produto | CFOP | ICMS | PIS/COFINS | CBS |
|---|---|---|---|---|---|
| 2710.12.59 / 2710.19.21 / 2711.19.10 / 3826.00.00 | gasolina, diesel, GLP, biodiesel | 5102 | 00 a 18% | 01 | 000 |
| 3004.90.99 | medicamento | 5102 | 00 a 18% | **04** | 200 (redução 60%) |
| 3303.00.10 / 3304.99.10 | perfume, cosmético | 5102 | 00 a 25% / 18% | **04** | 000 |
| 3305.10.00 | xampu | 5102 | 70 + ST | **04** | 000 |
| 4011.10.00 / 8708.30.90 / 8703.23.10 | pneu, autopeça, automóvel | 5102 | 00 | **01** | 000 |
| 2203.00.00 / 2202.10.00 / 2201.10.00 | cerveja, refrigerante, água | 5102 | 00 | **01** | 000 |
| 2207.10.90 | etanol | 5102 | 00 | **01** | 000 |

- Perfumaria e medicamento já saem como revenda monofásica (CST 04).
- D13 continua: pneu, autopeça e veículo (Lei 10.485/2002) saem com CST 01.
- Combustível: o bundle segue sem `cProdANP` (D33). Na versão no ar, o motor ainda não recusa.

### Suspeitas para o contador (rodada 12)
- **Bebida fria (Lei 13.097/2015, arts. 14 a 36) e etanol (Lei 9.718/1998, art. 5º)** saem com CST 01 na revenda.
  Conferir se a revenda do atacadista ou varejista tem alíquota zero (CST 04 ou 06).

## Rodada 13 — 2026-10-22 · monofásico pelo bundle, hml com o 39a19a4b

Mesma amostra da rodada 12, nas 27 UFs (`RODADA=r13 node f10_ns_monofasico.js`; leitura `RODADA=r13 node d9_regua.js`
→ `r13_ns_detalhe.json` / `.log`). hml em `hml-20d0058637ce` (ECS `fp-hml`, deploy de 22/10 11:00 UTC).
**Bundle: 54 de 54 pedidos salvos.** Cada nota levou de 3 a 23 s; na rodada 12, levou 103 s.

- **COMB (gasolina, diesel, GLP, biodiesel): 27 de 27 recusados com 400**, com a mesma mensagem:
  "NCM 2710.12.59 é combustível do ICMS monofásico (gasolinas — LC 192/2022, art. 2º, I) e a linha não informou
  `cProdANP`…". A régua agora barra o que antes saía como venda comum: o D12 está fechado do lado da plataforma.
  O D33 continua aberto: o bundle não tem campo de ANP no item e o mapeador não monta o grupo `comb`.
  Sem isso, nenhuma venda de combustível sai pelo NetSuite.
  - A recusa cita só a primeira linha (a gasolina). Diesel, GLP e biodiesel não aparecem na mensagem.
  - O pedido salva sem tributo e com status, cStat e motivo vazios. A recusa vai para a mensagem da tela
    (`fp_ue_simular.js:229-235`), que por REST não dá para conferir.
- **PIS: 27 de 27 com retorno.** O PIS/COFINS é o mesmo em todas as UFs, com CFOP 5102:

| NCM | Produto | PIS/COFINS | CBS/IBS |
|---|---|---|---|
| 3004.90.99 | medicamento | 04 | 200 (redução 60%) |
| 3303.00.10 · 3304.99.10 · 3305.10.00 | perfume, cosmético, xampu | 04 | 000 |
| 4011.10.00 · 8708.30.90 · 8703.23.10 | pneu, autopeça, automóvel | **01** a 0,65/3 | 000 |
| 2203.00.00 · 2202.10.00 · 2201.10.00 | cerveja, refrigerante, água | **01** a 0,65/3 | 000 |
| 2207.10.90 | etanol | **01** a 0,65/3 | 000 |

| # | Defeito | Prova |
|---|---|---|
| D13 | Continua: pneu, autopeça e veículo (Lei 10.485/2002) saem com CST 01 nas 27 UFs. | `r13_ns_detalhe.json` |
| D33 | Continua: agora com a recusa da plataforma, o combustível não sai pelo bundle. | pedidos 4835–4881 (COMB) |

As suspeitas da rodada 12 (bebida fria e etanol com CST 01 na revenda) valem para as 27 UFs. O etanol fica fora da
recusa por desenho (`39a19a4b`: a 2207.10 tem anidro combustível e álcool de outro uso).

## Rodada 14 — 2026-10-22 · combustível com o grupo ANP no bundle (SP)

O bundle passou a mandar o grupo ANP: os campos de item `custitem_fp_cod_anp`, `custitem_fp_desc_anp` e
`custitem_fp_pbio` vão para a linha como `cProdANP`, `descANP` e `pBio`. A linha leva também
`UFCons` = UF da contraparte, só na venda.
Itens de teste cadastrados assim: 2245 gasolina C comum 320102001 (L, pBio 30), 2251 diesel B S10 820101034 (L, pBio 15),
2104 GLP 210203001 (KG) e 9412 biodiesel B100 820101001 (L). Um pedido por produto, porque a recusa é da nota inteira
(`RODADA=r14 SO=COMB UM=1 node f10_ns_monofasico.js SP`).

| Pedido | Produto | Resultado |
|---|---|---|
| 5136 | GLP | **CFOP 5655, ICMS 61, PIS/COFINS 04**, CBS 000 |
| 5133 | gasolina C | 400: exige `origComb` (rejeição 909) |
| 5134 | diesel B S10 | 400: exige `origComb` (rejeição 909) |
| 5135 | biodiesel B100 | 400: exige `origComb` (rejeição 909) |

- O D33 está fechado para os produtos que não exigem origem (GLP, diesel A, gasolina A, combustível de aviação).
- Falta a origem do combustível (`origComb`: `indImport`, `cUFOrig`, `pOrig`), que a tabela exige na gasolina C,
  no diesel B, no biodiesel e no etanol anidro.
- O payload não traz `quantidadeTributavel`, e o GLP passou mesmo assim: o motor usa a quantidade comercial.

### Rodada 14 nas 27 UFs

`RODADA=r14 SO=COMB UM=1 node f10_ns_monofasico.js` → 108 pedidos, **108 salvos pelo bundle**
(`r14_ns_detalhe.json` / `.log`). Saiu igual nas 27 UFs:

| Produto | Resultado |
|---|---|
| GLP 210203001 | CFOP 5655, **ICMS 61** com `mono` = { qBCMonoRet 1, adRemICMSRet 1,47, vICMSMonoRet 1,47 }, PIS/COFINS 04, CBS/IBS 000 / 000001 cheio |
| gasolina C 320102001 · diesel B S10 820101034 · biodiesel B100 820101001 | 400 por falta de `origComb` (rejeição 909) |

### Suspeitas para o contador (rodada 14)
- **Ad rem do GLP de R$ 1,47/kg** no `adRemICMSRet`: conferir contra o convênio vigente em 2026.
- **CBS/IBS do GLP com CST 000 / 000001 e alíquota cheia.** Combustível tem regime específico monofásico
  no IBS/CBS (LC 214/2025, arts. 172 e seguintes; cClassTrib 620xxx). Conferir se esse regime já vale no ano-teste de 2026.
- **ICMS 61 com valor 0 e `geraLancamento: true`** (natureza DEBITO): cria uma perna contábil de valor zero.

## Rodadas 15 e 16 — 2026-10-22 · monofásico com o 336b6320 no hml

Confirmado pela resposta (CBS 620), não pelo ECS. `origin/main` em `336b6320`.

**Rodada 15** (`RODADA=r15 SO=COMB UM=1`, natureza VENDA, 108 pedidos, 108 salvos):
- **GLP, nas 27 UFs:** CFOP 5655, ICMS 61 com `valorDaPerna` 0, PIS/COFINS 04, **CBS/IBS 620 / 620006 a zero**.
  A correção do CBS/IBS está confirmada.
- **Gasolina C, diesel B e biodiesel:** 400 por falta de `origComb` (rejeição 909), como esperado.
- **cBenef não aparece no retorno do `/simular`:** nem o GO890004 em GO, nem o RS052905 em RS. A plataforma
  o resolve na montagem do XML (`emissao.service.ts`, comentário do `cbenef`). Pelo bundle, só daria para ver por `/emitir`,
  que não usamos para investigar.

**Rodada 16** (`RODADA=r16 SO=GLP NAT=64`, natureza VENDA_PROD, 27 pedidos, 27 salvos), igual nas 27 UFs:

| Tributo | Resultado |
|---|---|
| ICMS | CFOP 5652, **CST 02**, mono { qBCMono 1, adRemICMS 1,47, vICMSMono 1,47 }, `valor` 0, **`valorDaPerna` 1,47**, ST_A_RECOLHER |
| IPI | 53, SEM_EFEITO |
| PIS / COFINS | **01 a 0,65% / 3%** sobre 100, DEBITO |
| CBS / IBS | **620 / 620001** a zero |

### Suspeitas para o contador (rodadas 15 e 16)
- **PIS/COFINS do produtor de GLP com CST 01 *ad valorem* cumulativo.** O GLP tem regime concentrado no produtor
  e importador (Lei 9.718/1998, art. 4º; opção por alíquota por unidade na Lei 10.865/2004, art. 23). O esperado seria
  CST 02 (alíquota diferenciada) ou 03 (por unidade). O commit `39a19a4b` diz que deixou a produção "sem CST na régua (aviso)",
  mas o retorno traz CST 01, sem aviso.
