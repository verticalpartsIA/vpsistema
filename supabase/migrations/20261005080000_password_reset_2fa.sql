-- Recuperação de senha com 2 códigos NOSSOS (e-mail + WhatsApp) e sem sessão no meio.
-- O código por e-mail deixa de ser um token do Supabase: quem tem só a caixa de e-mail
-- não consegue abrir sessão (nem redefinir a senha) sem também ter o WhatsApp.
-- A senha nova é gravada pelo servidor (Admin API) e o gatilho de 2FA a captura; o
-- usuário então entra pelo login normal (e-mail + senha + código).

alter table public.two_factor_attempts drop constraint if exists two_factor_attempts_kind_check;
alter table public.two_factor_attempts
  add constraint two_factor_attempts_kind_check check (kind in ('pw_fail', 'challenge', 'reset_start'));

create table if not exists public.password_reset_challenges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  email_code_hash text not null,
  wpp_code_hash   text not null,
  attempts        int  not null default 0,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  ip              text
);
create index if not exists password_reset_challenges_user_idx on public.password_reset_challenges (user_id, created_at desc);
alter table public.password_reset_challenges enable row level security;
revoke all on public.password_reset_challenges from anon, authenticated;

-- Passo 1: abre o desafio (sempre registra a tentativa; para e-mail inexistente devolve 'noop').
create or replace function public.password_reset_start(p_email text, p_ip text)
returns table (status text, user_id uuid, challenge_id uuid, email_code text, wpp_code text, phone text, email_to text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_uid    uuid;
  v_to     text;
  v_prof   record;
  v_digits text;
  v_cid    uuid := gen_random_uuid();
  v_ec     text;
  v_wc     text;
begin
  perform pg_advisory_xact_lock(hashtextextended('2fa_reset:' || v_email, 0));

  if (select count(*) from public.two_factor_attempts
       where email_key = v_email and kind = 'reset_start' and created_at > now() - interval '1 hour') >= 3
     or (p_ip is not null and (select count(*) from public.two_factor_attempts
       where ip = p_ip and kind = 'reset_start' and created_at > now() - interval '1 hour') >= 10) then
    return query select 'locked'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text; return;
  end if;
  insert into public.two_factor_attempts (email_key, ip, kind) values (v_email, p_ip, 'reset_start');

  select au.id, au.email into v_uid, v_to from auth.users au where lower(au.email) = v_email limit 1;
  if v_uid is null then
    return query select 'noop'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text; return;
  end if;

  select is_active, celular into v_prof from public.profiles where id = v_uid;
  if not found or v_prof.is_active is not true then
    return query select 'noop'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text; return;
  end if;

  v_digits := regexp_replace(coalesce(v_prof.celular, ''), '\D', '', 'g');
  if length(v_digits) not in (10, 11) then
    -- sem celular não há como validar o segundo canal: o administrador redefine
    return query select 'no_phone'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text; return;
  end if;

  update public.password_reset_challenges c set used_at = now() where c.user_id = v_uid and c.used_at is null;

  v_ec := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  v_wc := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.password_reset_challenges (id, user_id, email_code_hash, wpp_code_hash, expires_at, ip)
  values (v_cid, v_uid,
          encode(extensions.digest(v_ec || v_cid::text || 'e', 'sha256'), 'hex'),
          encode(extensions.digest(v_wc || v_cid::text || 'w', 'sha256'), 'hex'),
          now() + interval '15 minutes', p_ip);

  return query select 'ok'::text, v_uid, v_cid, v_ec, v_wc, v_digits, v_to;
end;
$$;

-- Passo 2: confere os DOIS códigos (atômico, 5 tentativas por desafio).
create or replace function public.password_reset_confirm(p_challenge uuid, p_email_code text, p_wpp_code text, p_max int)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ch public.password_reset_challenges;
begin
  select * into v_ch from public.password_reset_challenges where id = p_challenge for update;
  if v_ch.id is null or v_ch.used_at is not null or v_ch.expires_at < now() then
    return query select 'invalid'::text, null::uuid; return;
  end if;
  if v_ch.attempts >= p_max then
    return query select 'locked'::text, null::uuid; return;
  end if;

  update public.password_reset_challenges set attempts = attempts + 1 where id = v_ch.id;

  if v_ch.email_code_hash = encode(extensions.digest(coalesce(p_email_code, '') || v_ch.id::text || 'e', 'sha256'), 'hex')
     and v_ch.wpp_code_hash = encode(extensions.digest(coalesce(p_wpp_code, '') || v_ch.id::text || 'w', 'sha256'), 'hex') then
    update public.password_reset_challenges set used_at = now() where id = v_ch.id;
    return query select 'ok'::text, v_ch.user_id; return;
  end if;
  return query select 'invalid'::text, null::uuid;
end;
$$;

-- Depois de trocar a senha, derruba as sessões abertas do usuário.
create or replace function public.password_reset_revoke_sessions(p_user uuid)
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from auth.sessions where user_id = p_user;
$$;

revoke all on function public.password_reset_start(text, text) from public, anon, authenticated;
revoke all on function public.password_reset_confirm(uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.password_reset_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.password_reset_start(text, text) to service_role;
grant execute on function public.password_reset_confirm(uuid, text, text, int) to service_role;
grant execute on function public.password_reset_revoke_sessions(uuid) to service_role;
