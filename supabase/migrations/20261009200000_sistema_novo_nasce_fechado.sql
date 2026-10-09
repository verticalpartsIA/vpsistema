-- Bug relatado pelo Gelson (09/10/2026): "a cada atualização os usuários
-- ganham poderes". Uma atualização que não é sobre usuários NÃO pode mudar
-- o que a tela de Administração mostra.
--
-- Causa: desde 29/07 module_permissions guarda só BLOQUEIOS ("libera por
-- padrão"). Logo, quando um sistema novo entra no portal (ex.: Gente & Gestão
-- em 02/08, Asset Manager em 10/08), é reativado, ou tem o slug trocado,
-- ninguém tem bloqueio para ele → TODO MUNDO ganha acesso na hora.
--
-- Correção: sistema novo NASCE FECHADO. Ao criar/reativar um módulo, grava
-- bloqueio para todo mundo que não tem poderes plenos; quem tem alçada libera
-- depois, pela /administracao. Ao trocar o slug, os bloqueios acompanham.

create or replace function public.close_new_module_for_everyone()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- Slug trocado: os bloqueios existentes acompanham o novo slug
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    update public.module_permissions set module_slug = new.slug where module_slug = old.slug;
  end if;

  -- Criado ativo, ou reativado: fecha para quem ainda não tem linha
  if new.is_active and (tg_op = 'INSERT' or not coalesce(old.is_active, false)) then
    insert into public.module_permissions (user_id, module_slug, can_access)
    select p.id, new.slug, false
    from public.profiles p
    where p.power_level is distinct from 'plenos'
      and not exists (
        select 1 from public.module_permissions mp
        where mp.user_id = p.id and mp.module_slug = new.slug
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_close_new_module_for_everyone on public.modules;
create trigger trg_close_new_module_for_everyone
after insert or update of is_active, slug on public.modules
for each row execute function public.close_new_module_for_everyone();
