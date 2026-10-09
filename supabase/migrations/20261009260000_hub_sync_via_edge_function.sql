-- Sincronização vpsistema → VP HUB, versão final (09/10/2026).
-- A chave legada do HUB foi desligada pela Supabase em 28/09/2026 e a política
-- do conector proíbe criar chaves-mestras. Desenho adotado (sem chave-mestra):
--   • vpsistema envia para a edge function `vpsistema-sync` do HUB com o header
--     x-sync-secret = senha aleatória guardada SÓ no cofre (vault: hub.SYNC_SECRET);
--   • o HUB confere a senha PERGUNTANDO ao vpsistema (verify_hub_sync_secret) e
--     grava pela conexão interna do próprio banco (SUPABASE_DB_URL).
-- Ligado em 09/10/2026 (integration_flags.hub_alcadas = true).
-- Decisão do Gelson sobre a Inbox: fica ativa a Inbox dos PRÓPRIOS e-mails
-- (ver/criar/editar/excluir); "ver e-mails de outros" começa fechado.

create or replace function public.verify_hub_sync_secret(p_secret text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(length(p_secret) >= 32, false) and exists (
    select 1 from vault.decrypted_secrets where name = 'hub.SYNC_SECRET' and decrypted_secret = p_secret
  )
$$;
revoke all on function public.verify_hub_sync_secret(text) from public;
grant execute on function public.verify_hub_sync_secret(text) to anon, authenticated;

create or replace function public.hub_call(p_body jsonb)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hub.SYNC_SECRET';
  if v_secret is null then raise warning 'hub_call: senha hub.SYNC_SECRET ausente no cofre'; return null; end if;
  return net.http_post(
    url     := 'https://jxtqwzmpgofwctqajewt.supabase.co/functions/v1/vpsistema-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body    := p_body,
    timeout_milliseconds := 15000
  );
end;
$$;
revoke all on function public.hub_call(jsonb) from public, anon, authenticated;

create or replace function public.hub_push_person(p_user uuid, p_force boolean default false)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not p_force and not coalesce((select enabled from public.integration_flags where name = 'hub_alcadas'), false) then
    return null;
  end if;
  select email into v_email from public.profiles where id = p_user;
  if v_email is null then return null; end if;
  return public.hub_call(jsonb_build_object(
    'action', 'set_alcadas', 'p_email', v_email,
    'p_caps', public.hub_desired_caps(p_user), 'p_modulos', public.hub_managed_modules()));
end;
$$;

-- E-mail trocado no vpsistema → troca no HUB (e reenvia as alçadas)
create or replace function public.trg_hub_profile_changed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email and old.email is not null and new.email is not null
     and coalesce((select enabled from public.integration_flags where name = 'hub_alcadas'), false) then
    perform public.hub_call(jsonb_build_object('action', 'set_email', 'p_old', old.email, 'p_new', new.email));
  end if;
  if new.power_level is distinct from old.power_level
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email then
    perform public.hub_push_person(new.id);
  end if;
  return new;
end;
$$;

update public.integration_flags set enabled = true, updated_at = now() where name = 'hub_alcadas';
