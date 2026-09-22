# Bundle NetSuite → FiscalPlatform — instruções do projeto

Projeto: **SuiteCloud project (SDF)** que liga o NetSuite ao **FiscalPlatform** (NestJS/Postgres,
API sob `/api/v1`). O NetSuite é o ERP; o FiscalPlatform é o **motor fiscal e o emissor** — calcula
tributo, resolve CST/cClassTrib, monta e assina o XML, transmite à SEFAZ e escritura.

**A fronteira é a regra central deste repositório:**

| Quem faz | Onde |
|---|---|
| decidir CST, base, alíquota, natureza contábil, cBenef, fundamento legal | **FiscalPlatform** (régua + motor) |
| montar, assinar (A1) e transmitir o XML; protocolo, CC-e, cancelamento | **FiscalPlatform** |
| reservar numeração fiscal | **FiscalPlatform** (`fiscal_serie`, reserva atômica) |
| dizer **o que** foi vendido/comprado, para quem, com qual natureza declarada | **NetSuite** (este bundle) |
| guardar o retorno (chave, protocolo, XML, DANFE) e refletir valor no contábil | **NetSuite** (este bundle) |

Corolário duro: **nenhum CST, alíquota, MVA, cBenef ou fórmula de base entra em SuiteScript.** Se você
se pegar escrevendo `if (cst === '41')` ou uma tabela de alíquota por UF no bundle, pare — isso é régua
do FiscalPlatform, e duplicá-la cria dois sistemas que divergem em silêncio na primeira mudança de
convênio. O bundle **traduz e transporta**; não classifica.

## Postura

O Rogerio é **dev com boa noção de contabilidade, sem CFC**, e é o autor do FiscalPlatform. A autoridade
normativa é sua: traga a norma de fonte oficial e explique o porquê. A autoridade sobre o contrato da
API é o **Swagger do FiscalPlatform** — não a memória, não este arquivo.

- **Código e arquitetura: decida e implemente**, uma linha de justificativa. Pause **só** diante de
  risco fiscal, consumo de numeração, ou operação irreversível (deploy em produção, publicação de versão).
- **A decisão de desenho dele já foi tomada.** "O que você acha?" é UMA passada: concorda, ou aponta o
  furo concreto, e implementa.
- **Não afirme estado de nenhum dos dois lados de memória.** Campo/scriptid do NetSuite vem do XML do
  objeto ou de Record Types; contrato do FiscalPlatform vem do Swagger; comportamento do motor vem do
  método real lido no fonte.
- **`/simular` para investigar, nunca `/emitir`.** Mesmo motor, devolve `linhas[].impostos[]` com CST
  resolvido e **não consome numeração**. Uma investigação por `/emitir` já queimou sete números.

## Os elos (e onde a fiação morre em silêncio)

```
campo do NetSuite → mapeador do payload (WHITELIST) → /api/v1 → motor → régua → XML → SEFAZ
                                                                    ↓
                                          retorno (chave, protocolo, XML) → custom record + File Cabinet
```

- **O mapeador do payload é whitelist**, igual ao `mapTributoCaptura` do lado do motor: campo do NetSuite
  que não é montado no payload não chega ao motor — `undefined`, não erro. Campo novo tem dois saltos:
  montar aqui **e** existir no DTO lá.
- **Teste na fronteira, não na origem.** A fronteira deste bundle é o **payload que sai** e a **resposta
  que volta** — não a variável interna. Guarde o payload enviado junto do retorno: sem ele, "o motor
  errou" e "eu mandei errado" são indistinguíveis, e a segunda hipótese é a mais frequente.
- Erro do motor é **dado, quase sempre cadastro**. Rejeição da SEFAZ chega com cStat e motivo: propague
  o texto inteiro para quem opera no NetSuite, sem traduzir nem resumir.

## Invariantes do contrato

- **Idempotência por `idExterno`**, único por filial. Reenviar o mesmo `idExterno` **devolve a nota
  anterior — inclusive se ela foi rejeitada**. Logo: `idExterno` é derivado de identidade estável da
  transação do NetSuite (id interno + tipo), nunca de tentativa/timestamp, e retry **reusa** a chave.
- **Declaração do ERP é override por tributo, nunca interruptor.** `linhas[].impostos[]` sobrepõe o
  homônimo e o motor continua calculando os outros. Não mande imposto que você não tem motivo para
  declarar — deixar o motor calcular é o default correto.
- **Natureza de operação na entrada vem declarada pelo NetSuite, no consumo**, por
  `POST /transacoes/reclassificar` pela **chave de acesso** (o id é do FiscalPlatform, o ERP nunca o
  viu). Quem abriu o pedido de compra já decidiu insumo × revenda × ativo × uso e consumo: é dado que
  já existe, não trabalho novo para o usuário.
- **O body substitui, não incrementa.** Havendo declaração, ela é a declaração inteira do documento.
  Precedência: **linha declarada > cabeçalho declarado > resolvedor de CFOP**; cabeçalho **não** silencia
  o resolvedor nas linhas que calaram.
- **Persistir cada avanço antes de responder/prosseguir.** Autorização não se perde porque a gravação no
  NetSuite falhou depois: guarde chave e protocolo assim que chegarem.
- **Não recalcule para "conferir".** Se o valor do NetSuite divergir do motor, o motor está certo por
  definição de fronteira; o que se investiga é o payload.

## Multi-subsidiária

Subsidiária do NetSuite ↔ filial (CNPJ) do FiscalPlatform é **mapeamento em régua do bundle**, nunca
`if (subsidiary === 3)`. O escopo do tenant vem do contexto de autenticação da API — jamais de campo que
o cliente preenche sobre si mesmo. Piloto define **o que testar**, não o que o bundle faz.

## Segurança

Token/credencial da API do FiscalPlatform vive em **Secrets Management** do NetSuite (Setup > Company >
Secrets), referenciado pelo script — **nunca** em campo texto, custom record, código ou log. Payload de
log não carrega credencial. Certificado A1 não passa pelo NetSuite: ele é do FiscalPlatform.

## Ambiente e comandos

Windows + **PowerShell 5.1** · `curl.exe` · sem `grep`/`wc` (use `Select-String`) ·
`Copy-Item -Recurse -Force` para mesclar diretório. SuiteCloud CLI exige **Oracle JDK 17** com
`JAVA_HOME` explícito na sessão.

```powershell
suitecloud project:validate --server   # sempre antes
suitecloud project:deploy              # só depois, e produção só com aval
```

Limite de 50 MB no zip do projeto (XML de NF-e vai para File Cabinet, não para o projeto). SuiteBundler
está morto para desenvolvimento novo: ACP para conta própria, SuiteApp Project para distribuir.

## Trabalho com o Rogerio

Ele sobe os arquivos; entregue por `present_files` com o nome exato do repositório — **nunca** peça para
colar snippet, nem para mudança de uma linha. pt-BR sempre.

- **Uma pergunta aberta por vez**, no fim, e só se for decisão dele.
- **Documento errado ou erro próprio: primeira linha da resposta.**
- **Não escreva as duas possibilidades quando dá para saber qual é.** Leia o código, o Swagger, ou meça.

## Subagentes

| Chame | Para |
|---|---|
| `analista-requisitos-senior` | frente nova: processo do ERP + norma → requisito com aceite medível no payload/retorno |
| `contador-fiscal-senior` | matéria tributária: o que o NetSuite precisa **declarar** e como conferir o que o motor devolveu |
| `dev-senior-suitescript` | mapeador, integração, custom record, script, SDF, governança, deploy |
| `gerente-projeto-senior` | escopo, ordem, versão do bundle, risco de prazo normativo e de release do NetSuite |

Ordem default: **requisitos → contador → dev → gerente**. Frente pequena e óbvia: direto no dev.
