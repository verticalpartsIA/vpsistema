-- Propaga nome/departamento/celular/status ativo do vpsistema pro
-- VPRequisições sempre que um perfil existente muda. Mesmo padrão já usado
-- pra Pós-Venda 360 (sync_user_status_to_posvenda), só que cobrindo mais
-- campos e fazendo update em vez de só ban/invite — o provisionamento
-- inicial (criar a conta) continua vindo do sso-proxy/provision-module-user.
--
-- Contexto: antes desta migração, uma mudança de nome/departamento/celular
-- em vpsistema nunca chegava no VPRequisições — só a criação da conta no
-- primeiro clique em "Abrir sistema" tinha esses dados, e nunca mais era
-- atualizada depois disso. Levou a casos reais de gente com nome/depto
-- errado no VPRequisições meses depois de terem sido corrigidos aqui.
create or replace function public.sync_profile_to_vprequisicoes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then
    return new;
  end if;

  if old.name is not distinct from new.name
     and old.department is not distinct from new.department
     and old.celular is not distinct from new.celular
     and old.is_active is not distinct from new.is_active
  then
    return new;
  end if;

  perform net.http_post(
    url := 'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/sync-user-vprequisicoes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', 'vpreq-sync-2026-secret'
    ),
    body := jsonb_build_object(
      'email', new.email,
      'name', new.name,
      'department', new.department,
      'celular', new.celular,
      'is_active', coalesce(new.is_active, true)
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_to_vprequisicoes on public.profiles;
create trigger trg_sync_profile_to_vprequisicoes
  after update of name, department, celular, is_active on public.profiles
  for each row execute function public.sync_profile_to_vprequisicoes();
