---
name: implement
description: Executa o tasks.md de uma feature do vpsistema em ordem, gerando código, migrations e testes, respeitando os limites do CLAUDE.md. Use depois do /analyze, só quando o usuário confirmar que pode começar a programar.
---

# Implement — implementação e verificação

## Objetivo

Executar as tarefas mapeadas em `tasks.md`, gerando o código-fonte, as migrations e os testes
possíveis neste projeto, e validando manualmente o que não tem teste automatizado.

## Passos

1. Leia `tasks.md` e execute as tarefas sequencialmente (`T001`, `T002`, ...).
2. Respeite rigorosamente os limites do `CLAUDE.md` — em especial a seção 7 (regras permanentes)
   e a seção 2 (stack: sem introduzir ORM, state lib, router externo ou framework de teste novo
   sem aprovação explícita).
3. **Testes**: este projeto não tem `vitest`/`jest`. Para lógica de negócio pura extraída de uma
   edge function, escreva teste com `node:test` + `node:assert/strict`, seguindo exatamente o
   padrão de `supabase/functions/_shared/__tests__/*.test.mjs` (comentário com o comando de
   execução na primeira linha, nomes de teste em português). Para fluxos de UI, não existe teste
   de integração automatizado — siga o checklist de verificação manual da Fase 5 do `tasks.md`,
   rodando `npm run dev` e testando de fato no navegador.
4. Ao final, rode `npm run build` para confirmar que o projeto compila. **Não existe gate de
   lint confiável** (`CLAUDE.md` seção 5) — não trate um `npm run lint` limpo como garantia de
   nada, e não tente consertar a config do ESLint como parte desta tarefa a menos que isso tenha
   sido pedido explicitamente.
5. **Nunca dê `git push` para `main`** nem faça merge para `main` por conta própria
   (`CLAUDE.md` seção 3) — commit/push em branch de trabalho, e peça aprovação explícita do
   usuário antes de qualquer coisa que chegue em produção.
6. Se, no meio da implementação, uma tarefa exigir contrariar uma regra do `CLAUDE.md` ou algo
   que o `/analyze` não previu, pare e avise o usuário em vez de seguir em frente improvisando.
