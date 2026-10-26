-- Fecha o elo mais fraco do 2FA (decisão do Gelson, 26/10/2026): o login exige e-mail + senha +
-- código por WhatsApp desde a migration two_factor_whatsapp, mas a recuperação de senha
-- ("Esqueceu a senha?") só exigia acesso à caixa de e-mail — quem comprometesse só o e-mail de
-- um colaborador trocava a senha dele sem o segundo fator, contornando a proteção do login.
--
-- Reavalia do zero a intenção da PR #49 (parada desde 05/10, nunca mesclada, com 2 achados de
-- segurança do Codex nunca resolvidos) contra o estado atual do sistema. Ver
-- specs/001-recuperacao-senha-2fa/ para spec/plan/tasks completos.
--
-- Como funciona: recuperação de senha passa a exigir DOIS códigos de 6 dígitos — um por e-mail,
-- outro por WhatsApp — antes de aceitar a nova senha. Nenhum link com token na URL em nenhum
-- momento (fecha também o achado de timing do detectSessionInUrl: sem token na URL, não há o que
-- o client processar cedo demais). Ao concluir, profiles.pwd_changed_at é atualizado e todas as
-- sessões abertas daquela conta são revogadas na hora (auth.admin.signOut, chamado pela edge
-- function reset-complete) — e uma claim customizada (pwd_changed_at) embutida em todo JWT novo
-- (hook Custom Access Token, ativação manual pós-deploy) permite que a RLS das tabelas de
-- permissão mais sensíveis rejeite um token já emitido antes da troca, mesmo que ele ainda não
-- tenha expirado.

-- ── Tabela: desafio de recuperação de senha ──────────────────────────────────────────────────
create table if not exists public.credential_challenges (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  email_code_hash      text not null,
  whatsapp_code_hash   text not null,
  email_confirmed_at   timestamptz,
  whatsapp_confirmed_at timestamptz,
  attempts_email       int not null default 0,
  attempts_whatsapp    int not null default 0,
  ip                   text,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  used_at              timestamptz
);
create index if not exists credential_challenges_user_idx on public.credential_challenges (user_id, created_at desc);

-- Rate limit de pedidos de recuperação — mesmo padrão de two_factor_attempts.
create table if not exists public.credential_reset_attempts (
  id        bigint generated always as identity primary key,
  email_key text not null,
  ip        text,
  created_at timestamptz not null default now()
);
create index if not exists credential_reset_attempts_email_idx on public.credential_reset_attempts (email_key, created_at desc);
create index if not exists credential_reset_attempts_ip_idx on public.credential_reset_attempts (ip, created_at desc);

-- ── Tabela: log do Send Email Hook ───────────────────────────────────────────────────────────
-- Toda vez que o GoTrue tentaria mandar um e-mail nativo (recuperação, convite, confirmação) —
-- inclusive disparado direto do painel do Supabase, por fora de todo o fluxo acima — fica
-- registrado aqui, e o e-mail nunca chega a sair (ver função auth_email_hook mais abaixo e a
-- edge function supabase/functions/auth-email-hook).
create table if not exists public.auth_email_hook_log (
  id         bigint generated always as identity primary key,
  email_type text,
  user_id    uuid,
  created_at timestamptz not null default now()
);

alter table public.credential_challenges enable row level security;
alter table public.credential_reset_attempts enable row level security;
alter table public.auth_email_hook_log enable row level security;
revoke all on public.credential_challenges, public.credential_reset_attempts, public.auth_email_hook_log
  from anon, authenticated;

-- ── Coluna: quando a senha de cada um mudou pela última vez ──────────────────────────────────
alter table public.profiles add column if not exists pwd_changed_at timestamptz not null default now();

-- ── Passo 1: pedido de recuperação ───────────────────────────────────────────────────────────
-- Resolve a tensão entre "orientar quem não tem celular" e "nunca revelar se o e-mail existe":
-- a resposta pra quem chama esta função é sempre genérica — a diferença de verdade é que, pra
-- conta sem celular (ou e-mail inexistente, ou conta inativa), NENHUM código é criado nem
-- enviado. 'no_phone' aqui só serve pra edge function decidir internamente que não deve disparar
-- nada; nunca é repassado como resposta HTTP diferenciada.
create or replace function public.password_reset_start(p_email text, p_ip text)
returns table (status text, user_id uuid, challenge_id uuid, email_code text, whatsapp_code text, phone text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid   uuid;
  v_prof  record;
  v_digits text;
  v_email_code text;
  v_wa_code    text;
  -- Gerado sempre, mesmo quando nada é enviado de verdade (ver comentário abaixo) — o chamador
  -- nunca recebe uma resposta que distinga "conta existe sem celular" de "e-mail não existe".
  v_cid   uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('pwd_reset_start:' || v_email, 0));

  -- 5 pedidos / 15 min por e-mail; 20 por IP — mesmos números do 2FA de login.
  if (select count(*) from public.credential_reset_attempts
       where email_key = v_email and created_at > now() - interval '15 minutes') >= 5
     or (p_ip is not null and (select count(*) from public.credential_reset_attempts
       where ip = p_ip and created_at > now() - interval '15 minutes') >= 20) then
    return query select 'locked'::text, null::uuid, v_cid, null::text, null::text, null::text; return;
  end if;
  insert into public.credential_reset_attempts (email_key, ip) values (v_email, p_ip);

  select au.id into v_uid from auth.users au where lower(au.email) = v_email limit 1;
  if v_uid is null then
    return query select 'noop'::text, null::uuid, v_cid, null::text, null::text, null::text; return;
  end if;

  select is_active, celular into v_prof from public.profiles where id = v_uid;
  if not found or v_prof.is_active is not true then
    return query select 'noop'::text, null::uuid, v_cid, null::text, null::text, null::text; return;
  end if;

  v_digits := regexp_replace(coalesce(v_prof.celular, ''), '\D', '', 'g');
  if length(v_digits) not in (10, 11) then
    -- Conta existe e está ativa, mas sem celular: não tem como dar o segundo fator.
    -- Não cria desafio, não envia nada — resposta ao chamador (inclusive o challenge_id, que
    -- nunca vai casar com nenhuma linha real) é idêntica à de 'noop'.
    return query select 'noop'::text, null::uuid, v_cid, null::text, null::text, null::text; return;
  end if;

  update public.credential_challenges set used_at = now() where user_id = v_uid and used_at is null;

  v_email_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  v_wa_code    := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.credential_challenges
    (id, user_id, email_code_hash, whatsapp_code_hash, expires_at, ip)
  values (
    v_cid, v_uid,
    encode(extensions.digest(v_email_code || v_cid::text || 'email', 'sha256'), 'hex'),
    encode(extensions.digest(v_wa_code || v_cid::text || 'whatsapp', 'sha256'), 'hex'),
    now() + interval '15 minutes', p_ip
  );

  return query select 'ok'::text, v_uid, v_cid, v_email_code, v_wa_code, v_digits;
end;
$$;

-- ── Passo 2: confirmar cada código (atômico, mesma mensagem genérica pros dois tipos de erro) ─
create or replace function public.credential_confirm_email(p_challenge uuid, p_code text, p_max int)
returns table (status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ch public.credential_challenges;
begin
  select * into v_ch from public.credential_challenges where id = p_challenge for update;
  if v_ch.id is null or v_ch.used_at is not null or v_ch.expires_at < now() then
    return query select 'invalid'::text; return;
  end if;
  if v_ch.attempts_email >= p_max then
    return query select 'locked'::text; return;
  end if;
  update public.credential_challenges set attempts_email = attempts_email + 1 where id = v_ch.id;
  if v_ch.email_code_hash = encode(extensions.digest(coalesce(p_code, '') || v_ch.id::text || 'email', 'sha256'), 'hex') then
    update public.credential_challenges set email_confirmed_at = now() where id = v_ch.id;
    return query select 'ok'::text; return;
  end if;
  return query select 'invalid'::text;
end;
$$;

create or replace function public.credential_confirm_whatsapp(p_challenge uuid, p_code text, p_max int)
returns table (status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ch public.credential_challenges;
begin
  select * into v_ch from public.credential_challenges where id = p_challenge for update;
  if v_ch.id is null or v_ch.used_at is not null or v_ch.expires_at < now() then
    return query select 'invalid'::text; return;
  end if;
  if v_ch.attempts_whatsapp >= p_max then
    return query select 'locked'::text; return;
  end if;
  update public.credential_challenges set attempts_whatsapp = attempts_whatsapp + 1 where id = v_ch.id;
  if v_ch.whatsapp_code_hash = encode(extensions.digest(coalesce(p_code, '') || v_ch.id::text || 'whatsapp', 'sha256'), 'hex') then
    update public.credential_challenges set whatsapp_confirmed_at = now() where id = v_ch.id;
    return query select 'ok'::text; return;
  end if;
  return query select 'invalid'::text;
end;
$$;

-- ── Passo 3: valida que os dois fatores foram confirmados e marca o desafio como usado ──────
-- Só confere estado — quem efetivamente troca a senha (Admin API) e revoga sessões
-- (auth.admin.signOut) é a edge function reset-complete, não SQL.
create or replace function public.credential_complete(p_challenge uuid)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ch public.credential_challenges;
begin
  select * into v_ch from public.credential_challenges where id = p_challenge for update;
  if v_ch.id is null or v_ch.used_at is not null or v_ch.expires_at < now() then
    return query select 'invalid'::text, null::uuid; return;
  end if;
  if v_ch.email_confirmed_at is null or v_ch.whatsapp_confirmed_at is null then
    return query select 'incomplete'::text, null::uuid; return;
  end if;
  update public.credential_challenges set used_at = now() where id = v_ch.id;
  return query select 'ok'::text, v_ch.user_id;
end;
$$;

revoke all on function public.password_reset_start(text, text) from public, anon, authenticated;
revoke all on function public.credential_confirm_email(uuid, text, int) from public, anon, authenticated;
revoke all on function public.credential_confirm_whatsapp(uuid, text, int) from public, anon, authenticated;
revoke all on function public.credential_complete(uuid) from public, anon, authenticated;
grant execute on function public.password_reset_start(text, text) to service_role;
grant execute on function public.credential_confirm_email(uuid, text, int) to service_role;
grant execute on function public.credential_confirm_whatsapp(uuid, text, int) to service_role;
grant execute on function public.credential_complete(uuid) to service_role;

-- ── fn_session_not_stale(): helper de RLS ────────────────────────────────────────────────────
-- Compara a claim customizada 'pwd_changed_at' do JWT atual com o valor ao vivo em
-- profiles.pwd_changed_at. Claim ausente (token emitido antes desta migration, ou antes do
-- Custom Access Token Hook ser ativado no painel) = válido, pra não derrubar ninguém só pelo
-- deploy. Claim mais antiga que o valor ao vivo = sessão corresponde a uma senha que já mudou.
create or replace function public.fn_session_not_stale()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (auth.jwt() ->> 'pwd_changed_at') is null
    or (auth.jwt() ->> 'pwd_changed_at')::numeric >= extract(epoch from (
      select p.pwd_changed_at from public.profiles p where p.id = auth.uid()
    )),
    true
  );
$$;
revoke all on function public.fn_session_not_stale() from public, anon;
grant execute on function public.fn_session_not_stale() to authenticated;

-- ── Convite ativa o 2FA na hora (FR08) ───────────────────────────────────────────────────────
-- two_factor_activate() (migration two_factor_whatsapp) nunca tinha sido chamada por código
-- nenhum até agora — só manualmente via SQL console — e por isso nunca foi concedida ao
-- service_role. invite-user passa a chamá-la na criação de um colaborador novo.
grant execute on function public.two_factor_activate(uuid) to service_role;

-- ── RLS: adiciona fn_session_not_stale() às tabelas de permissão mais sensíveis ─────────────
-- Texto das policies conferido ao vivo no banco antes de alterar (pg_policies) — só acrescenta
-- a condição nova ao que já existia, não reescreve do zero.
alter policy profiles_power_all on public.profiles
  using (get_my_power() is not null and fn_session_not_stale())
  with check (get_my_power() is not null and fn_session_not_stale());
alter policy profiles_select_own on public.profiles
  using (id = auth.uid() and fn_session_not_stale());
alter policy profiles_update_own on public.profiles
  using (id = auth.uid() and fn_session_not_stale());

alter policy module_permissions_power_all on public.module_permissions
  using (get_my_power() is not null and fn_session_not_stale())
  with check (get_my_power() is not null and fn_session_not_stale());
alter policy permissions_select_own on public.module_permissions
  using (user_id = auth.uid() and fn_session_not_stale());

alter policy user_grants_read on public.user_grants
  using ((user_id = auth.uid() or get_my_power() is not null) and fn_session_not_stale());
alter policy user_grants_write on public.user_grants
  using (get_my_power() is not null and fn_session_not_stale())
  with check (get_my_power() is not null and fn_session_not_stale());

alter policy user_value_exceptions_read on public.user_value_exceptions
  using ((user_id = auth.uid() or get_my_power() is not null) and fn_session_not_stale());
alter policy user_value_exceptions_write on public.user_value_exceptions
  using (get_my_power() is not null and fn_session_not_stale())
  with check (get_my_power() is not null and fn_session_not_stale());

-- ── Custom Access Token Hook ──────────────────────────────────────────────────────────────────
-- Embute pwd_changed_at (epoch) em todo JWT novo. Ativação é manual no painel do Supabase
-- (Authentication → Hooks → Custom Access Token) — só no passo 6 do rollout (ver plan.md), depois
-- de tudo o resto já validado em produção.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  claims jsonb;
  v_pwd_changed numeric;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);
  select extract(epoch from pwd_changed_at) into v_pwd_changed
    from public.profiles where id = (event->>'user_id')::uuid;
  if v_pwd_changed is not null then
    claims := jsonb_set(claims, '{pwd_changed_at}', to_jsonb(v_pwd_changed));
  end if;
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
