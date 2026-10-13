-- vpsistema → VP HUB: criar o perfil no HUB quando a pessoa ainda não existe lá (13/10/2026).
--
-- Antes: o HUB respondia {"ok":false,"motivo":"sem_perfil_no_hub"} para quem não
-- tinha linha em `perfis` e a alçada/valores dessa pessoa se perdiam.
-- Agora o envio leva `p_perfil` (id do vpsistema, nome, departamento, ativo,
-- celular). A edge function `vpsistema-sync` (v6) chama, antes de gravar,
-- vpsistema_ensure_perfil(p_perfil) no banco do HUB, que cria o perfil se faltar
-- (mesmo id; nivel SEMPRE 'Colaborador' — o poder no HUB vem das alçadas).
--
-- Só vai p_perfil para pessoa ATIVA com e-mail @verticalparts.com.br
-- (contas como gmail pessoal ou agente.ia@vpsistema.com não viram perfil no HUB).
-- Retrocompatível: sem p_perfil o HUB se comporta como antes.

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
         case when coalesce(is_active, false) and lower(email) like '%@verticalparts.com.br' then
           jsonb_build_object('id', id, 'email', lower(email), 'nome', name, 'departamento', department,
                              'ativo', true, 'whatsapp', coalesce(celular_corporativo, celular))
         end
    into v_email, v_modo, v_ativo, v_plenos, v_perfil
  from public.profiles where id = p_user;
  if v_email is null then return null; end if;

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
