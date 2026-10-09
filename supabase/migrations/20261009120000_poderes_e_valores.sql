-- Central de permissões — 1ª entrega: NÍVEL DE PODER + VALORES R$ (topo da árvore).
--
-- Árvore (decidida com o Gelson em 09/10/2026):
--   👤 pessoa
--   ├── 🔑 power_level   — poder DENTRO do vpsistema (quem pode dar poderes)
--   │      plenos : igual ao Gelson/Diego, inclusive dar poderes a si mesmo
--   │      medios : igual ao Gelson/Diego, MENOS dar poderes a si mesmo
--   │      baixos : não abre valores, não dá poderes nem a si nem aos outros
--   │      null   : sem poder no vpsistema (não abre /administracao)
--   ├── ⭐ values_access — valores R$ no ecossistema inteiro
--   │      nenhum (padrão) : R$ aparece desfocado | todos : vê todos os valores
--   │      (exceções por valor/sistema entram nas próximas entregas)
--   └── 🧩 sistemas      — module_permissions (continua guardando só BLOQUEIOS)
--
-- Regras de quem altera o quê (valem no SERVIDOR — a tela só reflete):
--   • Só PLENOS concedem/alteram nível de poder.
--   • Ninguém além de PLENOS altera os próprios poderes (nível, cargo,
--     liderança, departamento, status, valores, sistemas).
--   • MÉDIOS só alteram poderes de quem está ABAIXO deles (baixos/sem poder).
--   • BAIXOS não dão poderes (cargo, liderança, valores, sistemas); podem só
--     ajustar departamento/status de quem não tem poder.
--   • Service role (edge functions, syncs) passa direto: auth.uid() é null.

alter table public.profiles
  add column if not exists power_level text
    check (power_level in ('plenos', 'medios', 'baixos')),
  add column if not exists values_access text not null default 'nenhum'
    check (values_access in ('nenhum', 'todos'));

comment on column public.profiles.power_level is
  'Poder dentro do vpsistema: plenos | medios | baixos | null (sem poder). Só plenos alteram.';
comment on column public.profiles.values_access is
  'Valores R$ no ecossistema: nenhum (desfocado, padrão) | todos.';

-- ── Inauguração ─────────────────────────────────────────────────────────────
-- Gelson e Diego começam com poderes plenos e vendo todos os valores.
update public.profiles set power_level = 'plenos', values_access = 'todos'
where email in ('gelson.simoes@verticalparts.com.br', 'diego@verticalparts.com.br');

-- Quem já era Administrador herda o que tinha (administrar os outros), mas
-- sem poder se autopromover: vira Médio.
update public.profiles set power_level = 'medios'
where level = 'Administrador' and power_level is null;

-- Sigilo de faturamento (Diego, Juliana, Gelson) — Juliana já vê valores.
update public.profiles set values_access = 'todos'
where email = 'juliana@verticalparts.com.br';

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.get_my_power()
returns text
language sql stable security definer
set search_path = public
as $$
  select power_level from public.profiles where id = auth.uid()
$$;

-- Pode o usuário logado mexer nos PODERES (cargo, liderança, valores,
-- sistemas) da pessoa alvo?
create or replace function public.can_grant_powers_to(target_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  me     text := public.get_my_power();
  target text;
begin
  if auth.uid() is null then return true; end if;          -- service role
  if me = 'plenos' then return true; end if;
  if me = 'medios' then
    if target_id = auth.uid() then return false; end if;    -- não dá a si mesmo
    select power_level into target from public.profiles where id = target_id;
    return target is null or target = 'baixos';             -- só quem está abaixo
  end if;
  return false;                                             -- baixos / sem poder
end;
$$;

-- ── Trava em profiles (substitui prevent_profile_privilege_escalation) ────
create or replace function public.enforce_profile_powers()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  me text;
begin
  if auth.uid() is null then
    return new;  -- service role / edge functions
  end if;
  me := public.get_my_power();

  if tg_op = 'INSERT' then
    if new.power_level is not null and me is distinct from 'plenos' then
      raise exception 'Só quem tem poderes plenos concede nível de poder.';
    end if;
    if new.values_access = 'todos' and me is distinct from 'plenos' and me is distinct from 'medios' then
      raise exception 'Você não pode liberar valores.';
    end if;
    if new.level = 'Administrador' and me is distinct from 'plenos' and me is distinct from 'medios' then
      raise exception 'Você não pode cadastrar alguém como Administrador.';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.power_level is distinct from old.power_level and me is distinct from 'plenos' then
    raise exception 'Só quem tem poderes plenos altera nível de poder.';
  end if;

  if (new.level is distinct from old.level
      or coalesce(new.is_department_lead, false) is distinct from coalesce(old.is_department_lead, false)
      or new.values_access is distinct from old.values_access)
     and not public.can_grant_powers_to(old.id) then
    if old.id = auth.uid() then
      raise exception 'Você não pode alterar seus próprios poderes.';
    end if;
    raise exception 'Você não tem alçada para alterar os poderes desta pessoa.';
  end if;

  if (new.department is distinct from old.department
      or coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true))
     and not (
       public.can_grant_powers_to(old.id)
       or (me = 'baixos' and old.id <> auth.uid() and old.power_level is null)
     ) then
    if old.id = auth.uid() then
      raise exception 'Você não pode alterar seu próprio departamento ou status.';
    end if;
    raise exception 'Você não tem alçada para alterar departamento ou status desta pessoa.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
drop trigger if exists trg_enforce_profile_powers on public.profiles;
create trigger trg_enforce_profile_powers
before insert or update on public.profiles
for each row execute function public.enforce_profile_powers();

-- ── Trava em module_permissions (acesso a sistemas = poder) ────────────────
create or replace function public.enforce_module_permission_powers()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  if not public.can_grant_powers_to(target) then
    if target = auth.uid() then
      raise exception 'Você não pode alterar seus próprios acessos.';
    end if;
    raise exception 'Você não tem alçada para alterar os acessos desta pessoa.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_module_permission_powers on public.module_permissions;
create trigger trg_enforce_module_permission_powers
before insert or update or delete on public.module_permissions
for each row execute function public.enforce_module_permission_powers();

-- ── RLS: quem administra passa a ser quem tem poder (não mais o "level") ───
drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists admins_can_update_any_profile on public.profiles;
create policy profiles_power_all on public.profiles
  for all to authenticated
  using (public.get_my_power() is not null)
  with check (public.get_my_power() is not null);

drop policy if exists permissions_admin_all on public.module_permissions;
drop policy if exists admins_delete_permissions on public.module_permissions;
drop policy if exists admins_insert_permissions on public.module_permissions;
drop policy if exists admins_read_all_permissions on public.module_permissions;
create policy module_permissions_power_all on public.module_permissions
  for all to authenticated
  using (public.get_my_power() is not null)
  with check (public.get_my_power() is not null);
