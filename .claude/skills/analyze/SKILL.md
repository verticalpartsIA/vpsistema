---
name: analyze
description: Audita spec.md, plan.md e tasks.md de uma feature do vpsistema em conjunto contra o CLAUDE.md, procurando conflitos, lacunas e riscos antes de começar a programar. Use depois do /tasks e antes do /implement.
---

# Analyze — análise crítica

## Objetivo

Realizar uma auditoria geral para verificar se as tarefas cobrem o plano, se o plano atende à
especificação, e se tudo cumpre estritamente as regras permanentes do `CLAUDE.md`.

## Passos

1. Leia em conjunto: `CLAUDE.md`, `spec.md`, `clarify.md`, `plan.md` e `tasks.md` da feature.
2. Verifique inconsistências, com atenção especial a estas perguntas (derivadas da seção 7 do
   `CLAUDE.md`):
   - Alguma tarefa cria um controle de acesso que é allow-list disfarçado, em vez de
     bloqueio-por-exceção?
   - Alguma permissão/regra de poder nova tem enforcement garantido no banco (trigger/RLS), ou
     só checagem no React?
   - Algum dado alterado é relevante para um satélite (HUB, VPRequisições) e falta propagar pelo
     sync existente?
   - Alguma tarefa mexe em login/2FA/sessão sem um passo de verificação manual explícito na
     Fase 5 do `tasks.md`?
   - Alguma migration nova está sem o comentário de "porquê" obrigatório?
   - Há requisito do `spec.md` sem nenhuma tarefa correspondente, ou tarefa sem requisito que a
     justifique?
   - Tipos de dado conflitantes entre `data-model.md` e o que as tarefas de frontend/edge
     function esperam?
3. Apresente um relatório objetivo (o que está OK, o que está inconsistente, o que é risco)
   em `specs/NNN-slug/analyze.md`.
4. Pergunte ao usuário se deseja aplicar correções no `plan.md`/`tasks.md` antes de iniciar a
   escrita de código. Não aplique a correção sozinho sem essa confirmação — a auditoria é para
   decisão do usuário, não para a IA corrigir e seguir em frente.
