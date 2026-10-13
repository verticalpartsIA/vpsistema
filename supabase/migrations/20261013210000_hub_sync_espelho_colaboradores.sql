-- vpsistema → HUB: o envio passa a levar os dados de COLABORADOR (13/10/2026). Já aplicada em produção.
--
-- O espelho colaboradores_vpsistema do HUB (tela Administração › Configurações) estava congelado desde
-- 14/08/2026. Agora p_perfil leva, para toda pessoa @verticalparts.com.br (ativa ou não): nome, departamento,
-- ativo, nível, cargo, unidade, liderança, gestor e foto; a edge function vpsistema-sync chama
-- vpsistema_ensure_perfil do HUB, que atualiza o espelho (ver migration do HUB 20261013190000).
-- Contas fora do domínio (gmail pessoal, agente.ia@vpsistema.com) não existem no HUB por decisão: não são enviadas.
-- O gatilho de profiles reenvia a pessoa quando muda qualquer um desses campos.

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
  v_perfil jsonb;
begin
  if not p_force and not coalesce((select enabled from public.integration_flags where name = 'hub_alcadas'), false) then
    return null;
  end if;
  select email, values_access, coalesce(is_active, false), power_level = 'plenos',
         case when lower(email) like '%@verticalparts.com.br' then
           jsonb_build_object('id', id, 'email', lower(email), 'nome', name, 'departamento', department,
                              'ativo', coalesce(is_active, false), 'whatsapp', coalesce(celular_corporativo, celular),
                              'nivel_vpsistema', level, 'cargo', job_title, 'unidade', unit,
                              'lider', coalesce(is_department_lead, false), 'gestor_id', manager_id, 'avatar', avatar_url)
         end
    into v_email, v_modo, v_ativo, v_plenos, v_perfil
  from public.profiles where id = p_user;
  if v_email is null or v_perfil is null then return null; end if;

  perform public.hub_call(jsonb_strip_nulls(jsonb_build_object(
    'action', 'set_valores', 'p_email', v_email, 'p_perfil', v_perfil,
    'p_modo', case when not v_ativo then 'nenhum' when v_plenos then 'todos' else coalesce(v_modo, 'nenhum') end,
    'p_liberar',  coalesce((select array_agg(module_key || '.' || tag_key) from public.user_value_exceptions
                            where user_id = p_user and system_slug = 'cotacao-importacao' and allow), '{}'),
    'p_esconder', coalesce((select array_agg(module_key || '.' || tag_key) from public.user_value_exceptions
                            where user_id = p_user and system_slug = 'cotacao-importacao' and not allow), '{}'))));

  return public.hub_call(jsonb_strip_nulls(jsonb_build_object(
    'action', 'set_alcadas', 'p_email', v_email, 'p_perfil', v_perfil,
    'p_caps', public.hub_desired_caps(p_user), 'p_modulos', public.hub_managed_modules())));
end;
$$;
revoke all on function public.hub_push_person(uuid, boolean) from public, anon, authenticated;

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
     or new.values_access is distinct from old.values_access
     or new.name is distinct from old.name
     or new.department is distinct from old.department
     or new.level is distinct from old.level
     or new.job_title is distinct from old.job_title
     or new.unit is distinct from old.unit
     or new.is_department_lead is distinct from old.is_department_lead
     or new.manager_id is distinct from old.manager_id
     or new.avatar_url is distinct from old.avatar_url then
    perform public.hub_push_person(new.id);
  end if;
  return new;
end;
$$;
