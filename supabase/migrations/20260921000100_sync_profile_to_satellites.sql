-- Generaliza o sync de perfil pra todos os satélites com Auth/perfil
-- próprio (VP Requisições, Propostas, Pós-Venda 360, Visitas e Brindes),
-- não só VPRequisições. Substitui trg_sync_profile_to_vprequisicoes /
-- sync-user-vprequisicoes (migration 20260919001940).
--
-- Também corrige a exposição de segredo daquela migration: o header
-- x-sync-secret aqui é lido do Vault em tempo de execução
-- (satellite_sync_secret, criado via vault.create_secret — nunca em texto
-- puro em SQL versionado), não mais um literal no corpo da function.
--
-- VP Catraca fica de fora por enquanto — schema de controle de acesso
-- físico não documentado o suficiente (mesma cautela do delete-user).
drop trigger if exists trg_sync_profile_to_vprequisicoes on public.profiles;
drop function if exists public.sync_profile_to_vprequisicoes();

create or replace function public.sync_profile_to_satellites()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
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

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'satellite_sync_secret'
  limit 1;

  if v_secret is null then
    raise warning 'satellite_sync_secret não encontrado no Vault — sync pros satélites pulado';
    return new;
  end if;

  perform net.http_post(
    url := 'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/sync-satellite-profiles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_secret
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

create trigger trg_sync_profile_to_satellites
  after update of name, department, celular, is_active on public.profiles
  for each row execute function public.sync_profile_to_satellites();
