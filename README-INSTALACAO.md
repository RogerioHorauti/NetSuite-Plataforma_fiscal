# Agente do bundle NetSuite → FiscalPlatform — instalação

Pacote com `CLAUDE.md`, 4 subagentes sênior e 4 skills, para o repositório do **SuiteCloud project (SDF)**
do bundle que integra o NetSuite ao FiscalPlatform.

## Instalar (PowerShell 5.1)

```powershell
$destino = "C:\Users\TI\Documents\GitHub\<repo-do-bundle>"

Expand-Archive -Path "$env:USERPROFILE\Downloads\netsuite-fiscalplatform-agente.zip" `
               -DestinationPath "$env:TEMP\nsagente" -Force

Copy-Item -Path "$env:TEMP\nsagente\netsuite-fiscalplatform-agente\*" `
          -Destination $destino -Recurse -Force

Get-ChildItem -Path "$destino\.claude" -Recurse | Select-Object FullName
```

`Copy-Item -Recurse -Force` mescla com o que já existe. **Não use `Move-Item`** — ele substitui a pasta
inteira e apaga agentes/skills que já estivessem lá. Se o repositório já tem `CLAUDE.md`, renomeie o
antigo antes (`Rename-Item CLAUDE.md CLAUDE.anterior.md`) e mescle o conteúdo à mão.

## Abrir

Abra o Claude Code **da raiz do repositório do projeto SDF** — a mesma pasta de `manifest.xml`,
`deploy.xml` e `src/`. Aberto de subpasta, ele não vê o `.claude/`.

```powershell
cd $destino
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17.0.20.1"   # ajuste ao JDK 17 instalado
claude
```

Para persistir:

```powershell
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Java\jdk-17.0.20.1", "User")
```

## A fronteira que o pacote inteiro assume

O **FiscalPlatform** calcula, classifica, numera, assina e transmite. O **bundle traduz e transporta**:
declara identidade da operação e natureza, e guarda o retorno (chave, protocolo, XML, DANFE).

Nenhum CST, alíquota, MVA, cBenef ou fórmula de base entra em SuiteScript — isso é régua do motor, e
duplicá-la cria dois sistemas que divergem na primeira mudança de convênio. Os quatro agentes recusam
requisito que peça isso.

## Conteúdo

```
CLAUDE.md                                        instruções do projeto (fronteira, elos, contrato)
.claude/settings.json                            bloqueia certificado/token; deploy exige confirmação
.claude/agents/
  analista-requisitos-senior.md                  processo do ERP + norma → requisito com aceite medível
  contador-fiscal-senior.md                      o que declarar, e conferência do que o motor devolveu
  dev-senior-suitescript.md                      mapeador, integração, custom record, SDF, governança
  gerente-projeto-senior.md                      escopo, ordem, versão, release, duas cadências
.claude/skills/
  bundle-netsuite-fiscalplatform/SKILL.md        contrato, invariantes e armadilhas da integração
  bundle-netsuite-fiscalplatform/references/
    mapeamento-netsuite-payload.md               de-para campo do NetSuite → payload, e o que gravar
  suitescript-senior/SKILL.md                    ofício SuiteScript 2.1 + SDF + integração
  motor-fiscal-br/SKILL.md                       doutrina fiscal para declarar e conferir (não recriar)
  requisitos-e-release-fiscal/SKILL.md           template de requisito, priorização, pronto, release
```

## Fluxo default

**requisitos → contador (ancora a norma) → dev (implementa) → gerente (encaixa no release).**
Frente pequena e óbvia vai direto no dev.

## O que o `settings.json` bloqueia

- Leitura de `.pfx/.p12/.pem/.key/.cer`, `.env` e de `~/.suitecloud-sdk` (tokens de conta).
- `project:deploy`, `account:setup` e `account:savetoken` por conta própria — `project:validate --server`
  está liberado.
- `object:import`, `file:upload` e `git push` pedem confirmação.

Ajuste as listas se o seu fluxo pedir outra coisa; o arquivo é seu.
