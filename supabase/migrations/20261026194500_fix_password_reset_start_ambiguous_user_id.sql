-- Corrige bug encontrado na verificação manual (T016, 26/10/2026, testando a recuperação pelo
-- site de verdade): password_reset_start (migration 20261026180000) tem a coluna de saída
-- `user_id` (do RETURNS TABLE) e a coluna `credential_challenges.user_id` com o mesmo nome — a
-- linha que fecha desafios antigos (`where user_id = v_uid`) ficava ambígua pro PL/pgSQL,
-- derrubando a função com erro 42702 em toda chamada. A edge function reset-start engolia o erro
-- da RPC (log silencioso) e respondia {ok:true} sem challenge_id, e o frontend mostrava "Não foi
-- possível enviar o código" — por isso nunca tinha sido pego antes de testar pelo site.
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
  v_cid   uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('pwd_reset_start:' || v_email, 0));

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
    return query select 'noop'::text, null::uuid, v_cid, null::text, null::text, null::text; return;
  end if;

  update public.credential_challenges set used_at = now()
    where credential_challenges.user_id = v_uid and used_at is null;

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

revoke all on function public.password_reset_start(text, text) from public, anon, authenticated;
grant execute on function public.password_reset_start(text, text) to service_role;
