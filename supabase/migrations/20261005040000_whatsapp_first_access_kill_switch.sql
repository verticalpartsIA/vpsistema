-- O interruptor também vale para os links de primeiro acesso: com o login por
-- celular desligado, nenhum link novo pode ser criado e nenhum link existente
-- pode ser consumido (ficam pendentes e voltam a valer se o interruptor for ligado).
create or replace function public.whatsapp_first_access_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce(
    (select phone_login_enabled from public.whatsapp_login_config where id = 1), false);
begin
  if tg_op = 'INSERT' then
    if not v_enabled then
      raise exception 'Acesso por WhatsApp desativado' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE: bloqueia só o consumo (used_at null -> preenchido) com o interruptor desligado.
  if not v_enabled and old.used_at is null and new.used_at is not null then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_first_access_guard on public.whatsapp_first_access_links;
create trigger trg_whatsapp_first_access_guard
  before insert or update on public.whatsapp_first_access_links
  for each row execute function public.whatsapp_first_access_guard();
