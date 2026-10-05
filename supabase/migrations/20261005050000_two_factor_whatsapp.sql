-- 2FA por WhatsApp: e-mail + senha + código. Estruturas INERTES até alguém ser ativado
-- (two_factor_activate). Nada muda para quem não está ativo.
--
-- Como impede o atalho "só a senha": para usuários ATIVOS, o hash real da senha
-- fica em user_credentials e o hash no auth.users vira um valor aleatório. Assim o
-- login direto no Supabase (signInWithPassword) deixa de funcionar e a senha só é
-- conferida pelo servidor (two_factor_start), que exige o código do WhatsApp antes
-- de a edge function criar a sessão. Um gatilho em auth.users captura qualquer troca
-- de senha futura (recuperação, convite, admin) e repete a troca.
--
-- Rollback: two_factor_deactivate(user) / two_factor_deactivate_all() devolvem o hash
-- real ao auth.users. Contas isentas (compartilhadas/automação) mantêm o hash real no
-- auth.users e entram só com a senha.

create table if not exists public.two_factor_config (
  id             int primary key default 1 check (id = 1),
  default_active boolean not null default false   -- novos usuários já nascem com 2FA?
);
insert into public.two_factor_config (id, default_active) values (1, false) on conflict (id) do nothing;

create table if not exists public.user_credentials (
  user_id           uuid primary key,
  password_hash     text,
  two_factor_active boolean not null default false,
  two_factor_exempt boolean not null default false,
  exempt_reason     text,
  updated_at        timestamptz not null default now()
);

create table if not exists public.two_factor_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  code_hash  text not null,
  attempts   int  not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  ip         text
);
create index if not exists two_factor_challenges_user_idx on public.two_factor_challenges (user_id, created_at desc);

create table if not exists public.two_factor_attempts (
  id        bigint generated always as identity primary key,
  email_key text not null,
  ip        text,
  kind      text not null check (kind in ('pw_fail', 'challenge')),
  created_at timestamptz not null default now()
);
create index if not exists two_factor_attempts_email_idx on public.two_factor_attempts (email_key, kind, created_at desc);
create index if not exists two_factor_attempts_ip_idx on public.two_factor_attempts (ip, kind, created_at desc);

alter table public.two_factor_config enable row level security;
alter table public.user_credentials enable row level security;
alter table public.two_factor_challenges enable row level security;
alter table public.two_factor_attempts enable row level security;
revoke all on public.two_factor_config, public.user_credentials,
              public.two_factor_challenges, public.two_factor_attempts from anon, authenticated;

-- ── Gatilho: captura trocas de senha e mantém o hash do auth.users inutilizável ──
create or replace function public.two_factor_capture_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cred    public.user_credentials;
  v_default boolean;
begin
  if current_setting('app.two_factor_internal', true) = '1' then return new; end if;
  if coalesce(new.encrypted_password, '') = '' then return new; end if;
  if tg_op = 'UPDATE' and new.encrypted_password is not distinct from old.encrypted_password then return new; end if;

  select * into v_cred from public.user_credentials where user_id = new.id;
  if v_cred.user_id is null then
    select default_active into v_default from public.two_factor_config where id = 1;
    insert into public.user_credentials (user_id, password_hash, two_factor_active)
    values (new.id, new.encrypted_password, coalesce(v_default, false));
    v_cred.two_factor_active := coalesce(v_default, false);
    v_cred.two_factor_exempt := false;
  else
    update public.user_credentials set password_hash = new.encrypted_password, updated_at = now()
     where user_id = new.id;
  end if;

  if v_cred.two_factor_active and not v_cred.two_factor_exempt then
    new.encrypted_password := extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_two_factor_capture_password on auth.users;
create trigger trg_two_factor_capture_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.two_factor_capture_password();

-- ── Ativar / desativar / isentar (rodam como dono; sem acesso para anon/authenticated) ──
create or replace function public.two_factor_activate(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_exempt boolean;
begin
  perform set_config('app.two_factor_internal', '1', true);

  insert into public.user_credentials (user_id, password_hash, two_factor_active)
  select id, encrypted_password, true from auth.users
   where id = p_user and coalesce(encrypted_password, '') <> ''
  on conflict (user_id) do update
     set password_hash = case when public.user_credentials.two_factor_active
                              then public.user_credentials.password_hash
                              else excluded.password_hash end,
         two_factor_active = true,
         updated_at = now();

  select two_factor_exempt into v_exempt from public.user_credentials where user_id = p_user;
  if v_exempt is not null and not v_exempt then
    update auth.users
       set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf'))
     where id = p_user;
  end if;
  perform set_config('app.two_factor_internal', '', true);   -- não vaza para o resto da transação
end;
$$;

create or replace function public.two_factor_deactivate(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform set_config('app.two_factor_internal', '1', true);
  update auth.users u
     set encrypted_password = c.password_hash
    from public.user_credentials c
   where c.user_id = p_user and u.id = p_user and coalesce(c.password_hash, '') <> '';
  update public.user_credentials set two_factor_active = false, updated_at = now() where user_id = p_user;
  perform set_config('app.two_factor_internal', '', true);
end;
$$;

create or replace function public.two_factor_set_exempt(p_user uuid, p_exempt boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform set_config('app.two_factor_internal', '1', true);
  insert into public.user_credentials (user_id, password_hash, two_factor_exempt, exempt_reason)
  select id, encrypted_password, p_exempt, p_reason from auth.users where id = p_user
  on conflict (user_id) do update
     set two_factor_exempt = p_exempt, exempt_reason = p_reason, updated_at = now();

  if p_exempt then
    -- isento: o hash real volta ao auth.users (entra só com a senha)
    update auth.users u set encrypted_password = c.password_hash
      from public.user_credentials c
     where c.user_id = p_user and u.id = p_user and c.two_factor_active and coalesce(c.password_hash, '') <> '';
  else
    perform public.two_factor_activate(p_user);
  end if;
  perform set_config('app.two_factor_internal', '', true);
end;
$$;

-- ── Passo 1: confere e-mail + senha no servidor e abre o desafio ──
create or replace function public.two_factor_start(p_email text, p_password text, p_ip text)
returns table (status text, user_id uuid, challenge_id uuid, code text, phone text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid   uuid;
  v_cred  public.user_credentials;
  v_prof  record;
  v_digits text;
  v_code  text;
  v_cid   uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('2fa_start:' || v_email, 0));

  -- limites: 5 senhas erradas / 15 min por e-mail; 20 por IP
  if (select count(*) from public.two_factor_attempts
       where email_key = v_email and kind = 'pw_fail' and created_at > now() - interval '15 minutes') >= 5
     or (p_ip is not null and (select count(*) from public.two_factor_attempts
       where ip = p_ip and kind = 'pw_fail' and created_at > now() - interval '15 minutes') >= 20) then
    return query select 'locked'::text, null::uuid, null::uuid, null::text, null::text; return;
  end if;

  select au.id into v_uid from auth.users au where lower(au.email) = v_email limit 1;
  if v_uid is null then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf'));  -- equaliza o tempo
    insert into public.two_factor_attempts (email_key, ip, kind) values (v_email, p_ip, 'pw_fail');
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, null::text; return;
  end if;

  select * into v_cred from public.user_credentials c where c.user_id = v_uid;
  if v_cred.user_id is null or not v_cred.two_factor_active then
    return query select 'legacy'::text, v_uid, null::uuid, null::text, null::text; return;  -- 2FA ainda não ativo
  end if;

  if coalesce(v_cred.password_hash, '') = ''
     or v_cred.password_hash <> extensions.crypt(coalesce(p_password, ''), v_cred.password_hash) then
    insert into public.two_factor_attempts (email_key, ip, kind) values (v_email, p_ip, 'pw_fail');
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, null::text; return;
  end if;

  select is_active, celular into v_prof from public.profiles where id = v_uid;
  if not found or v_prof.is_active is not true then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, null::text; return;
  end if;

  if v_cred.two_factor_exempt then
    return query select 'exempt'::text, v_uid, null::uuid, null::text, null::text; return;
  end if;

  v_digits := regexp_replace(coalesce(v_prof.celular, ''), '\D', '', 'g');
  if length(v_digits) not in (10, 11) then
    return query select 'no_phone'::text, v_uid, null::uuid, null::text, null::text; return;
  end if;

  -- limite de códigos: 5 por hora por usuário
  if (select count(*) from public.two_factor_challenges ch
       where ch.user_id = v_uid and ch.created_at > now() - interval '1 hour') >= 5 then
    return query select 'locked'::text, v_uid, null::uuid, null::text, null::text; return;
  end if;

  update public.two_factor_challenges ch set used_at = now() where ch.user_id = v_uid and ch.used_at is null;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.two_factor_challenges (id, user_id, code_hash, expires_at, ip)
  values (v_cid, v_uid, encode(extensions.digest(v_code || v_cid::text, 'sha256'), 'hex'), now() + interval '5 minutes', p_ip);

  return query select 'ok'::text, v_uid, v_cid, v_code, v_digits;
end;
$$;

-- ── Passo 2: confere o código (atômico) ──
create or replace function public.two_factor_verify(p_challenge uuid, p_code text, p_max int)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ch public.two_factor_challenges;
begin
  select * into v_ch from public.two_factor_challenges where id = p_challenge for update;
  if v_ch.id is null or v_ch.used_at is not null or v_ch.expires_at < now() then
    return query select 'invalid'::text, null::uuid; return;
  end if;
  if v_ch.attempts >= p_max then
    return query select 'locked'::text, null::uuid; return;
  end if;

  update public.two_factor_challenges set attempts = attempts + 1 where id = v_ch.id;

  if v_ch.code_hash = encode(extensions.digest(coalesce(p_code, '') || v_ch.id::text, 'sha256'), 'hex') then
    update public.two_factor_challenges set used_at = now() where id = v_ch.id;
    return query select 'ok'::text, v_ch.user_id; return;
  end if;
  return query select 'invalid'::text, null::uuid;
end;
$$;

revoke all on function public.two_factor_capture_password() from public, anon, authenticated;
revoke all on function public.two_factor_activate(uuid) from public, anon, authenticated;
revoke all on function public.two_factor_deactivate(uuid) from public, anon, authenticated;
revoke all on function public.two_factor_set_exempt(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.two_factor_start(text, text, text) from public, anon, authenticated;
revoke all on function public.two_factor_verify(uuid, text, int) from public, anon, authenticated;
grant execute on function public.two_factor_start(text, text, text) to service_role;
grant execute on function public.two_factor_verify(uuid, text, int) to service_role;
