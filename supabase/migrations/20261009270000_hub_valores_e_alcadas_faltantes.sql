-- vpsistema → VP HUB, parte 2 (fase P do passo 3, Gelson 09/10/2026):
--
-- 1. O HUB passa a saber QUEM VÊ R$ (topo da árvore). Junto com as alçadas,
--    a sincronização envia `set_valores` com:
--      • modo: inativo → 'nenhum'; plenos → 'todos'; demais → profiles.values_access;
--      • liberar / esconder: exceções por etiqueta (user_value_exceptions) do HUB,
--        no formato 'modulo.etiqueta'.
--    O HUB guarda em `valores_acesso` e responde via vp_ve_valor(perfil, etiqueta).
--    Quem não pode ver: o valor aparece DESFOCADO (o registro continua visível).
-- 2. Reenvia quando muda o interruptor de valores ou alguma exceção.
-- 3. As telas de conceder alçada do HUB passam a ser só leitura; as duas
--    alçadas que só existiam lá entram no catálogo daqui:
--      • Quadro de Comando → "Decide fabricar interno ou comprar pronto";
--      • Instalação em Campo → "Edita status do Acompanhamento de Obra".

insert into public.catalog_modules (system_slug, module_key, label, group_label, sort_order) values
  ('cotacao-importacao', 'quadro_comando', 'Quadro de Comando', 'Comercial | Pré-venda', 15)
on conflict (system_slug, module_key) do nothing;

insert into public.catalog_actions (system_slug, module_key, action_key, label, choice_group, sort_order) values
  ('cotacao-importacao', 'quadro_comando', 'decidir_fabricacao', 'Decide fabricar interno ou comprar pronto', null, 0),
  ('cotacao-importacao', 'instalacao', 'editar_status_obra', 'Edita status do Acompanhamento de Obra', null, 4)
on conflict (system_slug, module_key, action_key) do nothing;

create or replace function public.hub_push_person(p_user uuid, p_force boolean default false)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_email  text;
  v_modo   text;
  v_ativo  boolean;
  v_plenos boolean;
begin
  if not p_force and not coalesce((select enabled from public.integration_flags where name = 'hub_alcadas'), false) then
    return null;
  end if;
  select email, values_access, coalesce(is_active, false), power_level = 'plenos'
    into v_email, v_modo, v_ativo, v_plenos
  from public.profiles where id = p_user;
  if v_email is null then return null; end if;

  perform public.hub_call(jsonb_build_object(
    'action', 'set_valores', 'p_email', v_email,
    'p_modo', case when not v_ativo then 'nenhum' when v_plenos then 'todos' else coalesce(v_modo, 'nenhum') end,
    'p_liberar',  coalesce((select array_agg(module_key || '.' || tag_key) from public.user_value_exceptions
                            where user_id = p_user and system_slug = 'cotacao-importacao' and allow), '{}'),
    'p_esconder', coalesce((select array_agg(module_key || '.' || tag_key) from public.user_value_exceptions
                            where user_id = p_user and system_slug = 'cotacao-importacao' and not allow), '{}')));

  return public.hub_call(jsonb_build_object(
    'action', 'set_alcadas', 'p_email', v_email,
    'p_caps', public.hub_desired_caps(p_user), 'p_modulos', public.hub_managed_modules()));
end;
$$;

create or replace function public.trg_hub_profile_changed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email and old.email is not null and new.email is not null
     and coalesce((select enabled from public.integration_flags where name = 'hub_alcadas'), false) then
    perform public.hub_call(jsonb_build_object('action', 'set_email', 'p_old', old.email, 'p_new', new.email));
  end if;
  if new.power_level is distinct from old.power_level
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email
     or new.values_access is distinct from old.values_access then
    perform public.hub_push_person(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.trg_hub_valex_changed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  u uuid;
begin
  if tg_op = 'DELETE' then
    for u in select distinct user_id from old_rows where system_slug = 'cotacao-importacao' loop perform public.hub_push_person(u); end loop;
  else
    for u in select distinct user_id from new_rows where system_slug = 'cotacao-importacao' loop perform public.hub_push_person(u); end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_hub_valex_ins on public.user_value_exceptions;
create trigger trg_hub_valex_ins after insert on public.user_value_exceptions
  referencing new table as new_rows for each statement execute function public.trg_hub_valex_changed();
drop trigger if exists trg_hub_valex_upd on public.user_value_exceptions;
create trigger trg_hub_valex_upd after update on public.user_value_exceptions
  referencing new table as new_rows for each statement execute function public.trg_hub_valex_changed();
drop trigger if exists trg_hub_valex_del on public.user_value_exceptions;
create trigger trg_hub_valex_del after delete on public.user_value_exceptions
  referencing old table as old_rows for each statement execute function public.trg_hub_valex_changed();
