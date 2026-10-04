-- Espelha profiles.celular em auth.users.raw_user_meta_data->>'celular' pra
-- o número aparecer no painel do Supabase (Auth > Users). Não usamos
-- auth.users.phone de propósito: esse campo é identificador de login por
-- SMS (unicidade + confirmação) e o login aqui é e-mail/senha.
--
-- profiles.celular continua sendo a fonte da verdade (só dígitos, DDD + 9).
-- O trigger cobre qualquer caminho de escrita (modal do Admin, convite,
-- SQL manual); celular vazio remove a chave do metadata.
create or replace function public.sync_celular_to_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users
     set raw_user_meta_data = case
           when nullif(new.celular, '') is null
             then coalesce(raw_user_meta_data, '{}'::jsonb) - 'celular'
           else coalesce(raw_user_meta_data, '{}'::jsonb)
                || jsonb_build_object('celular', new.celular)
         end
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_sync_celular_to_auth_metadata on public.profiles;
create trigger trg_sync_celular_to_auth_metadata
  after insert or update of celular on public.profiles
  for each row execute function public.sync_celular_to_auth_metadata();

-- Backfill dos perfis já existentes.
update auth.users u
   set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
                            || jsonb_build_object('celular', p.celular)
  from public.profiles p
 where p.id = u.id
   and nullif(p.celular, '') is not null
   and (u.raw_user_meta_data->>'celular') is distinct from p.celular;
