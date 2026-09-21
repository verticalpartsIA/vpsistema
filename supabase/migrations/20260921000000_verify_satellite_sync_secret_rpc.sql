-- RPC que valida o x-sync-secret recebido pela edge function
-- sync-satellite-profiles contra o valor guardado no Vault, sem nunca
-- devolver o segredo em si (só um boolean) — nem pro chamador nem pra logs.
-- Substitui o padrão anterior de secret literal hardcoded em SQL versionado
-- (ver migration 20260919001940_sync_profile_to_vprequisicoes.sql, secret
-- exposto publicamente porque o repo vpsistema é público no GitHub). O valor
-- em si (satellite_sync_secret) foi criado direto via vault.create_secret()
-- fora de migration — nunca deve existir em texto puro num arquivo versionado.
create or replace function public.verify_satellite_sync_secret(candidate text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'satellite_sync_secret'
  limit 1;

  if v_secret is null or candidate is null then
    return false;
  end if;

  return candidate = v_secret;
end;
$$;

revoke all on function public.verify_satellite_sync_secret(text) from public;
revoke all on function public.verify_satellite_sync_secret(text) from anon;
revoke all on function public.verify_satellite_sync_secret(text) from authenticated;
grant execute on function public.verify_satellite_sync_secret(text) to service_role;
