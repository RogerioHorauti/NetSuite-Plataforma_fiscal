# Camada de compatibilidade — reaproveitar os ids do bundle instalado

> ⚠ **FRENTE DIFERIDA.** Decisão do Rogerio em 04/09/2026: isto é outra frente, e o foco agora é a
> instalação **original** (perfil `original`, ids nossos). O documento e o `fp_fields.js` ficam
> escritos e funcionando — o perfil `original` é o caminho default e não depende de nada aqui —, mas
> **nenhum perfil de terceiro é ativado nesta etapa** e o `oracle_brl` / `avalara` não serão escritos
> por enquanto.
>
> Implementação: `src/FileCabinet/SuiteScripts/FiscalPlatform/fp_fields.js`
> Perfis: `src/FileCabinet/SuiteScripts/FiscalPlatform/perfis/fp_perfil_*.json`
> Medições que sustentam este documento: `MEDICOES.md`

## 1. O problema, dito com precisão

O cliente tem o bundle da Oracle instalado e vai trocar pelo nosso. **O que dói na troca não é o
dado — é tudo que aponta para os ids antigos:** saved search, relatório salvo, formulário
customizado, workflow, template de impressão, CSV import salvo, coluna de lista, integração de
terceiro que lê campo por nome, e a memória muscular de quem usa o sistema todo dia.

Reusar o **mesmo scriptid** faz esse acervo continuar funcionando sem que ninguém o toque. É a
diferença entre uma troca de bundle e um projeto de migração.

## 2. Verdade dura, antes de qualquer desenho

**O de-para preserva os IDS. Não preserva os DADOS.**

Desinstalar um bundle no NetSuite **apaga os campos customizados dele e o conteúdo deles**. Então
"reaproveitar o id" resolve o acervo que *lê* o campo, e não resolve o histórico que *está dentro*
do campo. São dois problemas, e só um é desta camada.

### 2.1 O cenário escolhido: substituição com merge de componentes

**Decidido pelo Rogerio:** replicar os componentes do bundle antigo com os **mesmos scriptids**,
**desligar todos os scripts** do bundle antigo, e instalar o nosso com **merge dos componentes**. O
código é um só — o nosso —, e ele identifica qual bundle está sendo espelhado.

Isso resolve o furo mais sério que este documento levantava: **sem os scripts do bundle antigo
rodando, não há disputa de escrita.** Os campos passam a ter um único dono. A lista `somenteLeitura`
do §7 continua no perfil como cinto de segurança — protege contra um script que ficou ligado por
esquecimento —, mas deixa de ser a restrição estrutural que era.

O que **continua valendo** no cenário escolhido:

- **o de-para preserva os ids, não os dados** (§2) — desligar script não devolve conteúdo de campo
  apagado por desinstalação;
- **mapa de valor** (§8) — o campo List/Record continua sendo dele, com o vocabulário dele, mesmo
  sem script nenhum rodando;
- **prefixo reservado** (§2, abaixo) — criar scriptid no prefixo de um publisher pode ser bloqueado
  independentemente de script ligado ou desligado.

### 2.2 Os dois cenários, para registro

Daí saem dois cenários, que se comportam de forma diferente e **precisam ser escolhidos antes de
ativar perfil** — o escolhido é o segundo:

| cenário | o que acontece | o que esta camada resolve | o que fica de fora |
|---|---|---|---|
| **Convivência** — o bundle antigo fica instalado | nós lemos e (às vezes) escrevemos nos campos dele | acervo continua funcionando · nada é perdido | **disputa de escrita**: o bundle dele também escreve nesses campos (§7) |
| **Substituição** — o bundle antigo é desinstalado | os campos dele e o conteúdo somem; nós recriamos os campos com o mesmo scriptid | acervo continua funcionando | **o histórico**, que precisa de export antes da desinstalação e import depois — projeto separado, não é esta camada |

Na substituição há ainda o risco de **prefixo reservado**: scriptid no prefixo de um SuiteApp de
publisher (`psg_`, `avlr_`) pode não ser criável por outro projeto. **Medir na conta antes de
prometer**, criando um campo de teste com o prefixo alvo.

## 3. As três camadas de origem de um campo

Nesta ordem de preferência — é a política de "máximo de standard possível", tornada operacional:

| # | origem | exemplo | entra em perfil? |
|---|---|---|---|
| 1 | **NATIVO do NetSuite** | `tranid`, `externalid`, `subsidiary`, `location`, `entity`, `memo`, `status`, `trandate` | **não** |
| 2 | **scriptid do SuiteApp instalado** | `custbody_fiscal_doc_number`, `custbody_operation_nature`, `custbody_icms_total` | sim |
| 3 | **scriptid nosso** | `custbody_fp_corrid`, `custbody_fp_sim_payload`, `custbody_fp_chave` | sim (perfil `original`) |

Nativo **não entra em perfil de propósito**: id nativo não muda por bundle instalado, e deixá-lo
configurável só criaria a possibilidade de alguém reapontar `tranid` para outro lugar. Ele vive em
`fp_fields.NATIVOS`, e o acesso é por `fpFields.padrao('TRANID')`, que **lança** se a chave não
existir — falhar alto num erro de programação é melhor que devolver `undefined` para um `getValue`.

### 3.1 Por que a camada 2 existe: medição, não preferência

**O NetSuite não tem campo nativo de NF-e.** Isso não é opinião — foi medido no bundle 436209
(`MEDICOES.md` §3): a própria Oracle teve de criar `custbody_fiscal_doc_number`,
`custbody_fiscal_doc_series`, `custbody_operation_nature`, `custbody_psg_ei_status`,
`custbody_icms_total` e o resto. Se houvesse nativo, ela teria usado.

Consequência prática, e é o que faz as duas diretrizes convergirem: **"usar o máximo de standard"
e "reaproveitar os ids do bundle instalado" são a mesma política em duas camadas.** Padrão onde
existe nativo; id do SuiteApp instalado onde o domínio é fiscal e ele já resolveu; id nosso só onde
nem um nem outro tem.

⚠ Cada id da camada 1 tem de ser conferido no **Records Browser da versão da conta** antes do
primeiro deploy. Id nativo afirmado de memória é o erro mais barato de cometer e o mais caro de
achar: o campo existe, o `getValue` devolve `null`, e nada dá erro.

## 4. Como o bundle consome

Nenhum módulo escreve scriptid literal. Todos perguntam:

```js
fpFields.padrao('TRANID')                    // 'tranid' — nativo
fpFields.id('DOC_CHAVE')                     // resolvido no perfil ativo
fpFields.idLinha('LINHA_CFOP')
fpFields.idItem('ITEM_NCM')
fpFields.registro('DOC_ENTRADA')
fpFields.valor('DOC_STATUS', 'AUTORIZADA')   // traduz o VALOR, não só o campo
fpFields.somenteLeitura('DOC_STATUS')        // true → não escrever
```

`id()` devolve **`null`** quando a chave não existe em perfil nenhum, e o chamador decide se aquilo
é opcional (não grava) ou defeito (lança). Devolver `null` em vez de lançar é deliberado: campo que
existe só em alguns perfis é a regra desta arquitetura, não a exceção.

## 5. Perfil é overlay parcial, não substituição

**Chave ausente no perfil ativo resolve para o id do `original`.**

Sem isso, adotar um perfil significaria perder todo campo que o outro bundle não tem — e nenhum
bundle tem todos. Medido: o Electronic Invoicing **não traz campo de chave de acesso de 44 dígitos,
nem cStat, nem xMotivo, nem protocolo** (é motor de e-document genérico — UBL, Peppol; a parte
especificamente brasileira mora no `com.netsuite.brazillocalization`, que é outro perfil). Com o
perfil `oracle_ei` ativo, `DOC_CHAVE` continua vindo de `custbody_fp_chave`, sozinho.

Cada perfil declara em `naoMapeado` as chaves que deliberadamente não mapeia. Isso não muda o
comportamento — o overlay já resolve — e serve para o próximo leitor **não procurar um mapeamento
que não existe de propósito**.

Duas chaves nunca serão mapeadas em perfil nenhum: `CORRID` e `SIM_*`. São mecanismo nosso
(mensagem síncrona e prova do payload enviado), não têm equivalente em bundle de terceiro, e não
deveriam ter.

## 6. Detecção: sonda para o setup, decisão persistida para a operação

**Não existe API suportada de SuiteScript que liste bundle ou SuiteApp instalado por número.** Então
a detecção é por **sonda**: existe o custom record type que assina aquele SuiteApp?

A assinatura é um **record type**, não um campo — record type é o que o SuiteApp cria e mantém entre
versões, enquanto campo entra e sai de release. `search.create` com tipo inexistente lança, e é esse
lance que responde "não está instalado".

Ordem de resolução:

1. **perfil registrado** em `customrecord_fp_config` → **vence**;
2. senão, **sonda** na ordem de `fp_fields.PERFIS_CONHECIDOS` (mais específico primeiro — uma conta
   pode ter Electronic Invoicing *e* Brazil Localization ao mesmo tempo), persiste o resultado;
3. senão, **`original`**.

**Por que o persistido vence a sonda:** um perfil que virasse sozinho passaria a gravar dado fiscal
em outro campo e órfãozaria tudo que foi gravado antes — **em silêncio**, porque nenhum dos dois
campos dá erro. Detecção existe para o setup não ser manual; a decisão fica registrada. Divergência
entre sonda e persistido vira **aviso no log**, nunca troca automática.

Perfil configurado que não carrega (JSON malformado, arquivo removido) **cai no `original` e grita
no log** — não aborta. Abortar deixaria a conta inteira sem simulação por causa de um JSON.

Cache: `N/cache` escopo `PROTECTED`, TTL 3600 s, mais memo por execução. Trocar o perfil no config
exige `fpFields.invalidar()`.

## 7. Disputa de escrita — o furo do cenário de convivência

**Reaproveitar id não é o mesmo que ter permissão de gravar.**

No cenário de convivência, o bundle da Oracle continua instalado e **continua rodando os User
Events dele**, que escrevem nos mesmos campos. Campo em disputa entre dois bundles perde dado, e
qual dos dois ganha depende de **ordem de execução de User Event** — que não é nossa para
controlar. Some-se a isso que objeto de bundle **gerenciado** (o 436209 é gerenciado) pode estar
bloqueado para escrita por script de terceiro.

A saída é declarativa: a lista **`somenteLeitura`** do perfil. Campo do outro bundle que o outro
bundle ainda escreve é **somente-leitura para nós**, e o nosso valor canônico fica no campo do
perfil `original`, que o overlay parcial já resolve.

Hoje `DOC_STATUS` está em `somenteLeitura` no perfil `oracle_ei`, por dois motivos independentes —
cada um bastaria: o vocabulário de valor ainda não foi medido (§8) e o Electronic Invoicing tem
script próprio escrevendo naquele campo.

## 8. Mapa de valor — a metade que se esquece

Mapear `DOC_STATUS` para `custbody_psg_ei_status` e gravar nele a nossa string `'AUTORIZADA'` **não
funciona**: o campo do outro bundle é List/Record, e o que ele aceita é o internal id de um valor
**dele**. E o vocabulário é do fluxo dele (*Ready for Sending*, *Sent*, *Certified*), não do nosso
(`RASCUNHO`, `AUTORIZADA`, `REJEITADA`, `CANCELADA`).

**Campo certo com valor nosso num List/Record grava e não reclama** — e a saved search do cliente
não acha nada. É a falha mais cara desta camada inteira, porque tem cara de sucesso.

Por isso a seção `valores` do perfil, e por isso `fpFields.valor()` registra no log quando o perfil
tem mapa para a chave mas não tem tradução para aquele valor: gravar o canônico num List/Record vai
falhar de qualquer forma, e o log é o que diz por quê.

## 9. Perfis previstos

| perfil | espelha | estado |
|---|---|---|
| `original` | nós | **escrito** — é o catálogo canônico de nomes lógicos |
| `oracle_ei` | bundle 436209 / `com.netsuite.electronicinvoicing` | **escrito**, com ids medidos; `valores` e tipos pendentes de medição na conta |
| `oracle_brl` | `com.netsuite.brazillocalization` | **não escrito** — é onde deve estar chave de acesso, protocolo, cStat |
| `avalara` | prefixos `avlr_` / `enl_` (AvaTax Brasil / Tax Compliance) | **não escrito** — prefixos já inventariados em `MEDICOES.md` §4 |

## 10. Aceite desta camada

Verificável, e nenhum item depende de olhar código:

1. **Sem perfil configurado e sem SuiteApp fiscal instalado** → `fp_fields.perfilAtivo().perfil` é
   `original` e o log de abertura diz `perfil ativo: original (padrao)`.
2. **Com o Electronic Invoicing instalado e nada configurado** → a sonda acha
   `customrecord_psg_ei_standards`, o perfil vira `oracle_ei`, e `fpFields.id('DOC_NUMERO')`
   devolve `custbody_fiscal_doc_number`.
3. **No mesmo estado**, `fpFields.id('DOC_CHAVE')` devolve `custbody_fp_chave` — prova do overlay
   parcial.
4. **Perfil configurado como `original` com o EI instalado** → continua `original`: o registrado
   vence a sonda.
5. **`fpFields.somenteLeitura('DOC_STATUS')`** devolve `true` no `oracle_ei` e `false` no
   `original`, e o mapeador **não grava** naquele campo quando é `true`.
6. **JSON de perfil corrompido** → cai em `original`, com `origem = padrao_por_falha` no log, e a
   simulação continua funcionando.

## 11. O que esta camada NÃO faz

- **Não migra dado.** §2.
- **Não reaproveita régua.** Reusar `custbody_icms_total` é reusar o *lugar de guardar* o ICMS que o
  motor calculou. Não é herdar a alíquota, a base ou o CST do outro bundle. A fronteira do
  `CLAUDE.md` continua inteira: o motor decide, o bundle reflete.
- **Não substitui o bundle antigo em runtime.** Se os dois estiverem instalados e os dois emitirem,
  há dois emissores concorrendo pela mesma numeração — e isso não se resolve com de-para de campo,
  se resolve desligando um.
