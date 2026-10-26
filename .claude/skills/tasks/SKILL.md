---
name: tasks
description: Decompõe o plan.md de uma feature do vpsistema em tarefas atômicas, sequenciais e verificáveis (tasks.md), nas fases reais do projeto (schema, edge functions, frontend, sync com satélites, verificação manual). Use depois do /plan e antes do /analyze.
---

# Tasks — decomposição de tarefas

## Objetivo

Fracionar o plano técnico em tarefas pequenas, sequenciais, independentes e verificáveis.

## Passos

1. Leia `plan.md` (e `data-model.md`, se existir) da feature.
2. Crie `specs/NNN-slug/tasks.md` dividindo o trabalho em fases **adaptadas ao stack real do
   vpsistema** (não fases de arquitetura em camadas .NET-style):
   - **Fase 1 — Schema/Migração**: migration(s) SQL nova(s), com o comentário de "porquê"
     obrigatório, e os triggers/RLS que impõem as regras de negócio no banco.
   - **Fase 2 — Edge Functions**: funções novas/alteradas em `supabase/functions/`, incluindo a
     lógica pura extraída para `_shared/` quando fizer sentido testar isoladamente.
   - **Fase 3 — Frontend**: páginas/componentes/lib em `src/pages/`, `src/components/`,
     `src/lib/`.
   - **Fase 4 — Sincronização com satélites** (só se o `plan.md` apontou impacto): ajuste nas
     edge functions de sync existentes (HUB, VPRequisições).
   - **Fase 5 — Verificação**: teste de unidade com `node --experimental-strip-types --test`
     para lógica pura extraída (seguindo o padrão de `supabase/functions/_shared/__tests__/`,
     ver `CLAUDE.md` seção 4), **e** um checklist de verificação manual no navegador
     (`npm run dev`) para os fluxos de UI — já que não há suíte automatizada de integração neste
     projeto. Para features que tocam login/2FA/sessão/permissão, o checklist manual é
     obrigatório e detalhado (não "testar o login", e sim os cenários específicos que mudaram).
3. Nomeie as tarefas sequencialmente (`T001`, `T002`, `T003`...), cada uma descrevendo:
   - O que fazer, especificamente (arquivo(s) afetado(s), não só "mexer no backend").
   - Como essa tarefa é verificável isoladamente (o que rodar/clicar para confirmar que deu
     certo).
4. Uma tarefa nunca deve pedir para violar uma regra permanente do `CLAUDE.md` — se o `plan.md`
   levou a isso, é sinal de que o `/plan` (ou o `/clarify`) precisa ser revisto antes, não que a
   tarefa deve ser escrita violando a regra mesmo assim.
