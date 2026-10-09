-- vpsistema → VP HUB: o vpsistema passa a ALIMENTAR as alçadas do HUB
-- (piloto da árvore de alçadas, decisão do Gelson, 09/10/2026).
--
-- O HUB já lê `alcadas_capacidade`; aqui o vpsistema envia, por pessoa, a lista
-- COMPLETA do que ela pode no HUB, chamando a função `vpsistema_set_alcadas`
-- do banco do HUB (só service_role). A credencial do HUB é lida do COFRE
-- (vault: vpprd.SUPABASE_URL / vpprd.SUPABASE_SERVICE_ROLE_KEY) — nada de
-- segredo em código.
--
-- O que vai para o HUB, por pessoa:
--   • inativa (ou sem e-mail)   → nada (perde tudo nos módulos governados);
--   • poderes PLENOS            → todas as ações do catálogo do HUB;
--   • demais                    → effective_user_grants('cotacao-importacao').
-- Módulos governados = os 59 do catálogo do HUB + 'admin' (o antigo
-- "conceder alçadas" sai do HUB: quem dá poder agora é o vpsistema).
--
-- Quando envia: ao mudar alçada do HUB (user_grants), ao mudar poder /
-- ativo / e-mail da pessoa, e numa conferência diária (06:15 UTC).
-- Tudo atrás do interruptor integration_flags('hub_alcadas'), que nasce DESLIGADO.

create table if not exists public.integration_flags (
  name       text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.integration_flags (name, enabled) values ('hub_alcadas', false)
on conflict (name) do nothing;
alter table public.integration_flags enable row level security;
drop policy if exists integration_flags_read on public.integration_flags;
create policy integration_flags_read on public.integration_flags for select to authenticated
  using (public.get_my_power() is not null);

create or replace function public.hub_managed_modules()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select array_agg(module_key order by module_key) || array['admin']
  from public.catalog_modules where system_slug = 'cotacao-importacao'
$$;

create or replace function public.hub_desired_caps(p_user uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select case
    when not coalesce(p.is_active, false) or p.email is null then '{}'::text[]
    when p.power_level = 'plenos' then
      (select array_agg(a.module_key || '.' || a.action_key order by 1)
       from public.catalog_actions a where a.system_slug = 'cotacao-importacao')
    else coalesce(
      (select array_agg(distinct e.module_key || '.' || e.action_key)
       from public.effective_user_grants('cotacao-importacao') e where e.user_id = p.id),
      '{}'::text[])
  end
  from public.profiles p where p.id = p_user
$$;

-- Envia a lista de uma pessoa ao HUB (assíncrono, pg_net). p_force ignora o interruptor.
create or replace function public.hub_push_person(p_user uuid, p_force boolean default false)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text;
  v_url   text;
  v_key   text;
begin
  if not p_force and not coalesce((select enabled from public.integration_flags where name = 'hub_alcadas'), false) then
    return null;
  end if;
  select email into v_email from public.profiles where id = p_user;
  if v_email is null then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'vpprd.SUPABASE_URL';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'vpprd.SUPABASE_SERVICE_ROLE_KEY';
  if v_url is null or v_key is null then
    raise warning 'hub_push_person: credencial do HUB ausente no cofre';
    return null;
  end if;
  return net.http_post(
    url     := rtrim(v_url, '/') || '/rest/v1/rpc/vpsistema_set_alcadas',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('p_email', v_email, 'p_caps', public.hub_desired_caps(p_user), 'p_modulos', public.hub_managed_modules())
  );
end;
$$;

create or replace function public.hub_push_all(p_force boolean default false)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.profiles where email is not null loop
    if public.hub_push_person(r.id, p_force) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.hub_push_person(uuid, boolean) from public, anon, authenticated;
revoke all on function public.hub_push_all(boolean) from public, anon, authenticated;

-- Gatilhos: alçadas do HUB mudaram → reenvia as pessoas afetadas (uma vez por pessoa)
create or replace function public.trg_hub_grants_changed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  u uuid;
begin
  if tg_op = 'DELETE' then
    for u in select distinct user_id from old_rows where system_slug = 'cotacao-importacao' loop
      perform public.hub_push_person(u);
    end loop;
  else
    for u in select distinct user_id from new_rows where system_slug = 'cotacao-importacao' loop
      perform public.hub_push_person(u);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_hub_grants_ins on public.user_grants;
create trigger trg_hub_grants_ins after insert on public.user_grants
  referencing new table as new_rows for each statement execute function public.trg_hub_grants_changed();
drop trigger if exists trg_hub_grants_del on public.user_grants;
create trigger trg_hub_grants_del after delete on public.user_grants
  referencing old table as old_rows for each statement execute function public.trg_hub_grants_changed();

-- Pessoa mudou poder / ativo / e-mail → reenvia
create or replace function public.trg_hub_profile_changed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.power_level is distinct from old.power_level
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email then
    perform public.hub_push_person(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hub_profile_changed on public.profiles;
create trigger trg_hub_profile_changed after update on public.profiles
  for each row execute function public.trg_hub_profile_changed();

-- Conferência diária (corrige qualquer diferença; respeita o interruptor)
select cron.unschedule(jobid) from cron.job where jobname = 'hub-alcadas-diario';
select cron.schedule('hub-alcadas-diario', '15 6 * * *', $$select public.hub_push_all(false)$$);
