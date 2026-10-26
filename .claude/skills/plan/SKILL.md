---
name: plan
description: Gera o plano técnico (plan.md, data-model.md quando aplicável, research.md quando aplicável) de uma feature do vpsistema já especificada e esclarecida, usando a stack fixa do projeto definida no CLAUDE.md. Use depois do /clarify e antes do /tasks.
---

# Plan — planejamento técnico

## Objetivo

Criar o plano de arquitetura técnica e o modelo de dados, cruzando a especificação aprovada
(`spec.md` + `clarify.md`) com as restrições do `CLAUDE.md`.

## A stack já está decidida — não pergunte, não escolha outra

O vpsistema é **React 19 + Vite + Tailwind** no frontend e **Supabase (Postgres + RLS + Edge
Functions em Deno/TypeScript)** no backend, sem ORM, sem biblioteca de state management, sem
router externo (ver `CLAUDE.md`, seção 2). O plano técnico sempre se encaixa nessa stack — nunca
proponha uma tecnologia diferente nem pergunte ao usuário "qual stack usar".

## Passos

1. Leia `spec.md` e `clarify.md` da feature, e o `CLAUDE.md` inteiro (principalmente as seções
   2 a 7: stack, deploy/CI, testes, lint, migrations, regras permanentes).
2. Gere, dentro de `specs/NNN-slug/`:
   - **`research.md`** — **só crie este arquivo se houver pesquisa externa real a fazer** (ex.:
     como uma API de terceiro funciona, como o WhatsApp/Evolution API espera um payload). Não
     crie um arquivo vazio só para "seguir o template" quando a feature é inteiramente interna.
   - **`data-model.md`** — **só quando a feature mexe em dado persistido**. Para cada tabela
     nova ou alterada: colunas, tipos, chaves, e principalmente **que triggers/RLS garantem as
     regras de negócio no banco** (não é opcional — regra 5 do `CLAUDE.md`: nenhuma regra de
     permissão pode depender só do frontend).
   - **`plan.md`** — o plano técnico, cobrindo:
     - **Frontend**: quais páginas/componentes de `src/pages/` e `src/lib/` mudam ou são
       criados.
     - **Banco**: quais migrations novas (nome + o comentário de "porquê" obrigatório — seção 6
       do `CLAUDE.md`), quais triggers/RLS.
     - **Edge Functions**: quais são novas ou mudam, em `supabase/functions/`.
     - **Impacto em satélites**: a mudança precisa propagar para o sync do HUB e/ou
       VPRequisições (edge functions de sync existentes)? Se sim, como.
     - **Risco e rollback**: dado que não há suíte automatizada de testes nem gate de CI (seções
       3 e 4 do `CLAUDE.md`), descreva como verificar manualmente que a mudança funciona antes
       do deploy, e como reverter se algo der errado em produção. Para qualquer mudança em
       login/2FA/sessão/permissão, isso é obrigatório, não opcional.
3. Escreva tudo em português.
4. Não comece a escrever código nesta etapa — o próximo passo é `/tasks`.
