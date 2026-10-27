-- Limpeza final dos artefatos órfãos deixados pela PR #49 (recuperação de senha, nunca
-- mesclada), aplicada direto em produção em 05/10/2026 e substituída pela migration
-- 20261026180000 (recuperacao_senha_2fa) em 27/10/2026, a pedido do Gelson. Sem uso desde
-- então — só ocupando espaço e confundindo quem for investigar o schema no futuro.
--
-- password_reset_confirm(uuid, text, text, integer): function SQL do fluxo antigo de
-- recuperação (um único código, sem segundo fator), já sem chamador desde que
-- credential_confirm_email/credential_confirm_whatsapp assumiram o lugar dela.
-- password_reset_challenges: tabela que ela usava — confirmada vazia antes do drop.
--
-- A edge function "reset-confirm" (singular, caminho antigo) também foi apagada nesta
-- limpeza, direto no painel/MCP do Supabase (não tem representação em migration).
drop function if exists public.password_reset_confirm(uuid, text, text, integer);
drop table if exists public.password_reset_challenges;
