# Convenção de `specs/`

Cada funcionalidade não-trivial do vpsistema ganha uma pasta numerada sequencialmente:

```
specs/
  001-nome-curto-da-feature/
    spec.md         ← gerado por /specify
    clarify.md      ← gerado por /clarify (perguntas + respostas registradas)
    research.md     ← gerado por /plan, só quando há pesquisa externa real a fazer
    data-model.md   ← gerado por /plan, só quando a feature mexe em dado persistido
    plan.md         ← gerado por /plan
    tasks.md        ← gerado por /tasks
    analyze.md      ← gerado por /analyze
```

- Numeração: `NNN` é sequencial com 3 dígitos (`001`, `002`, ...), nunca reaproveitado.
- `nome-curto-da-feature`: kebab-case, em português, descrevendo o que a feature faz (não a
  tecnologia usada).
- Nem toda pasta terá todos os arquivos — `research.md` e `data-model.md` só existem quando fazem
  sentido para aquela feature (ver `.claude/skills/plan/SKILL.md`).
- As regras que todo artefato aqui dentro precisa respeitar estão no `CLAUDE.md` da raiz do
  repositório — ele é a constituição do projeto, este README só documenta a convenção de pastas.
