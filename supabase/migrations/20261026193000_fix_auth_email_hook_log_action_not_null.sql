-- Segunda correção de schema na mesma tabela órfã (ver 20261026190000): a coluna `action`,
-- herdada do artefato nunca mesclado da PR #49, é NOT NULL sem default. A edge function
-- auth-email-hook nova nunca preenche `action` (só email_type/user_id), então todo insert
-- vinha falhando com violação de NOT NULL — engolida pelo try/catch da function, que ainda
-- respondia 200 pro GoTrue ("Hook ran successfully" nos logs, log vazio na tabela). Achado ao
-- verificar manualmente o auth_email_hook_log depois de ativar o Send Email Hook (26/10/2026).
--
-- `action` fica órfã e nullable — sem uso pelo código novo, mas sem motivo pra apagar agora
-- (limpeza futura junto com reset-confirm/password_reset_challenges).
alter table public.auth_email_hook_log alter column action drop not null;
