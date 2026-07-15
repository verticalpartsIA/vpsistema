-- O provisionamento automático só disparava ao CONCEDER acesso (INSERT).
-- Ao REVOGAR (DELETE em module_permissions), nada avisava o app satélite e o
-- usuário continuava ativo lá. Agora o mesmo aviso é disparado nas duas
-- direções; o satélite (hoje, o VP Click via provision-from-vpsistema)
-- reconfirma a permissão no confirm-permission e converge o estado local —
-- cria/reativa quando concedido, desativa quando revogado.
create or replace function public.trigger_provision_module_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  r := coalesce(new, old);
  perform net.http_post(
    url := 'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/provision-module-user',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('user_id', r.user_id, 'module_slug', r.module_slug)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_module_permission_created on public.module_permissions;
create trigger on_module_permission_created
after insert on public.module_permissions
for each row execute function public.trigger_provision_module_user();

drop trigger if exists on_module_permission_revoked on public.module_permissions;
create trigger on_module_permission_revoked
after delete on public.module_permissions
for each row execute function public.trigger_provision_module_user();
