-- Corrige colisão de schema descoberta ao validar a migration 20261026180000: a tabela
-- auth_email_hook_log já existia em produção antes dela, criada junto com o deploy órfão e nunca
-- mesclado da PR #49 (05/10/2026), com as colunas (id, action, created_at) — diferentes das que
-- 20261026180000 esperava (id, email_type, user_id, created_at). Como a migration usou
-- `create table if not exists`, ela não deu erro: só manteve o schema antigo intocado, e a edge
-- function auth-email-hook nova (que insere email_type/user_id) passou a falhar silenciosamente
-- em todo insert, sem registrar nada em auth_email_hook_log (achado durante verificação manual,
-- 26/10/2026, ao checar a tabela depois de ativar o Send Email Hook no painel).
--
-- Acrescenta as colunas que faltam, sem mexer na coluna `action` antiga (órfã, inofensiva —
-- limpeza futura junto com os outros artefatos soltos da PR #49: reset-confirm e
-- password_reset_challenges).
alter table public.auth_email_hook_log add column if not exists email_type text;
alter table public.auth_email_hook_log add column if not exists user_id uuid;
