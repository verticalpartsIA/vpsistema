-- Limites do login por WhatsApp atômicos (corrige corrida em requisições
-- concorrentes): a checagem do limite e a reserva da vaga acontecem na mesma
-- transação, sob advisory lock, ANTES de enviar o código / validar o OTP.

alter table public.whatsapp_login_attempts
  drop constraint if exists whatsapp_login_attempts_kind_check;
alter table public.whatsapp_login_attempts
  add constraint whatsapp_login_attempts_kind_check
  check (kind in ('send', 'verify_attempt', 'verify_fail', 'verify_ok'));

-- Reserva um envio: false se estourou o limite por celular ou por IP na última hora.
create or replace function public.whatsapp_login_reserve_send(
  p_phone text, p_ip text, p_max_phone int, p_max_ip int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - interval '1 hour';
begin
  -- Ordem fixa (celular, depois IP) evita deadlock entre requisições.
  perform pg_advisory_xact_lock(hashtextextended('wpp_send_phone:' || p_phone, 0));
  if p_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('wpp_send_ip:' || p_ip, 0));
  end if;

  if (select count(*) from public.whatsapp_login_attempts
       where phone = p_phone and kind = 'send' and created_at >= v_since) >= p_max_phone then
    return false;
  end if;
  if p_ip is not null and (select count(*) from public.whatsapp_login_attempts
       where ip = p_ip and kind = 'send' and created_at >= v_since) >= p_max_ip then
    return false;
  end if;

  insert into public.whatsapp_login_attempts (phone, kind, ip) values (p_phone, 'send', p_ip);
  return true;
end;
$$;

-- Reserva uma tentativa de validação do último código enviado.
-- Retorna 'ok' (tentativa reservada), 'invalid' (sem código válido) ou 'locked'.
create or replace function public.whatsapp_login_reserve_verify(
  p_phone text, p_ip text, p_ttl_seconds int, p_max_attempts int
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('wpp_send_phone:' || p_phone, 0));

  select created_at into v_last
    from public.whatsapp_login_attempts
   where phone = p_phone and kind = 'send'
   order by created_at desc limit 1;

  if v_last is null or now() - v_last > make_interval(secs => p_ttl_seconds) then
    return 'invalid';
  end if;

  if exists (select 1 from public.whatsapp_login_attempts
              where phone = p_phone and created_at > v_last and kind = 'verify_ok') then
    return 'invalid';
  end if;

  if (select count(*) from public.whatsapp_login_attempts
       where phone = p_phone and created_at > v_last and kind = 'verify_attempt') >= p_max_attempts then
    return 'locked';
  end if;

  insert into public.whatsapp_login_attempts (phone, kind, ip) values (p_phone, 'verify_attempt', p_ip);
  return 'ok';
end;
$$;

revoke all on function public.whatsapp_login_reserve_send(text, text, int, int) from public, anon, authenticated;
revoke all on function public.whatsapp_login_reserve_verify(text, text, int, int) from public, anon, authenticated;
grant execute on function public.whatsapp_login_reserve_send(text, text, int, int) to service_role;
grant execute on function public.whatsapp_login_reserve_verify(text, text, int, int) to service_role;
