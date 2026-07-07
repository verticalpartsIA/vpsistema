-- Ao conceder module_permissions para um app com Supabase Auth próprio
-- (vprequisicoes, posvenda360, visitas), provisiona automaticamente o
-- usuário lá, em vez de depender do primeiro clique em "Abrir sistema".
create or replace function public.trigger_provision_module_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/provision-module-user',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('user_id', new.user_id, 'module_slug', new.module_slug)
  );
  return new;
end;
$$;

drop trigger if exists on_module_permission_created on public.module_permissions;
create trigger on_module_permission_created
after insert on public.module_permissions
for each row execute function public.trigger_provision_module_user();
