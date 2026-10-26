---
name: clarify
description: Lê o spec.md mais recente de uma feature do vpsistema, identifica ambiguidades, lacunas e conflitos com o CLAUDE.md, e pergunta ao usuário diretamente antes de liberar o planejamento técnico. Use depois do /specify e antes do /plan.
---

# Clarify — esclarecer requisitos

## Objetivo

Analisar a especificação atual em busca de ambiguidades, lacunas ou pontos omissos antes de
avançar para o planejamento técnico. Esta etapa existe para que decisões de negócio sejam
tomadas pelo usuário — nunca assumidas pela IA.

## Passos

1. Leia o `spec.md` mais recente da feature em andamento (`specs/NNN-slug/spec.md`) e o
   `CLAUDE.md` da raiz.
2. Identifique:
   - Pontos que não estão claros ou comportamentos omissos no `spec.md`.
   - Possíveis conflitos com alguma regra permanente do `CLAUDE.md` (seção 7) — em especial:
     a feature mexe em permissão/poder sem prever enforcement no banco? Mexe em dado que algum
     satélite também precisa (HUB, VPRequisições) sem prever o sync? Mexe em login/sessão/2FA?
   - Casos de borda óbvios que o spec não cobriu (ex.: o que acontece com um colaborador
     inativo, com poder `baixos`, com um módulo que não existe ainda).
3. **Pare a execução** e use a ferramenta `AskUserQuestion` para fazer as perguntas — não basta
   escrever as perguntas em texto corrido e seguir adiante. Agrupe perguntas relacionadas (até 4
   por chamada), com opções A/B/C quando fizer sentido.
4. Registre as perguntas e as respostas obtidas em `specs/NNN-slug/clarify.md`, no formato:

```markdown
# Esclarecimentos: [Nome da Funcionalidade]

## P1: [pergunta]
Resposta: [decisão do usuário]

## P2: [pergunta]
Resposta: [decisão do usuário]
```

5. Se alguma resposta mudar o `spec.md` (ex.: adiciona um requisito, remove algo do escopo),
   atualize o `spec.md` para refletir a decisão — o `clarify.md` registra o histórico da
   pergunta, o `spec.md` fica sempre como a versão corrente e coerente.
6. Só depois de todas as ambiguidades relevantes resolvidas (não precisa ser exaustivo até o
   último detalhe cosmético) o `/plan` pode ser chamado.
