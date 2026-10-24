-- vpsistema → HUB: substituição temporária (férias) passa a valer no HUB (24/10/2026).
--
-- Escopo: SÓ system_slug = 'cotacao-importacao' (VP Gestão). Substituições de outros
-- sistemas (ex.: vprequisicoes) NÃO vão ao HUB e não são tocadas aqui.
--
-- No HUB não há módulos "ciencia"/"aprovacao": os módulos são telas e a aprovação são
-- capacidades nelas. Por isso, para as substituições do HUB, a lista (p_caps, "modulo.acao")
-- é montada a partir das capacidades REAIS do titular — a mesma fonte que o hub_push_person
-- já usa (plenos = todo o catálogo; demais = user_grants), sem passar por effective_user_grants:
--   • tipo 'aprovacao': suplente recebe TODAS as capacidades do titular em decisoes,
--     aval-financeiro, aval-juridico, rh-homologacao e propostas;
--   • tipo 'ciencia'  : suplente recebe SÓ as ".ver" do titular nesses módulos;
--   • titular_mantem = false: o titular perde, no período, o que passou ao suplente.
-- O contrato com o HUB não muda (edge function vpsistema-sync e vpsistema_set_alcadas
-- intactas): o HUB grava concedido_por = 'vpsistema' e ignora perfis com acesso_manual.
-- Ao cancelar ou vencer, a lista efetiva volta ao normal e o HUB revoga sozinho, porque os
-- 5 módulos vão sempre em p_modulos.
--
-- Quando envia: ao inserir / alterar / cancelar / excluir a substituição (gatilho) e todo dia
-- às 03:05 UTC (00:05 de Brasília) para quem começa ou termina a substituição.
-- "Hoje" = data de Brasília (o banco está em UTC; current_date viraria às 21h de Brasília).
-- Não muda RLS, tela nem power_level.

create or replace function public.hub_hoje()
returns date
language sql stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create or replace function public.hub_substituicao_modulos()
returns text[]
language sql immutable
as $$
  select array['decisoes', 'aval-financeiro', 'aval-juridico', 'rh-homologacao', 'propostas']
$$;

-- Capacidades próprias de uma pessoa no HUB (sem substituição): mesma regra de antes
create or replace function public.hub_base_caps(p_user uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select case
    when not coalesce(p.is_active, false) or p.email is null then '{}'::text[]
    when p.power_level = 'plenos' then
      coalesce((select array_agg(a.module_key || '.' || a.action_key order by a.module_key, a.action_key)
                from public.catalog_actions a where a.system_slug = 'cotacao-importacao'), '{}'::text[])
    else coalesce(
      (select array_agg(distinct g.module_key || '.' || g.action_key)
       from public.user_grants g where g.user_id = p.id and g.system_slug = 'cotacao-importacao'),
      '{}'::text[])
  end
  from public.profiles p where p.id = p_user
$$;

-- O que o titular repassa numa substituição: tipo aprovacao = tudo; ciencia = só ".ver"
create or replace function public.hub_substituicao_caps(p_titular uuid, p_tipo text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(c), '{}'::text[])
  from unnest(public.hub_base_caps(p_titular)) c
  where split_part(c, '.', 1) = any (public.hub_substituicao_modulos())
    and (p_tipo = 'aprovacao' or split_part(c, '.', 2) = 'ver')
$$;

-- Lista EFETIVA enviada ao HUB: próprias − cedidas (titular_mantem = false) + recebidas
create or replace function public.hub_desired_caps(p_user uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select case
    when not coalesce(p.is_active, false) or p.email is null then '{}'::text[]
    else (
      select coalesce(array_agg(distinct x.c), '{}'::text[])
      from (
        select c
        from unnest(public.hub_base_caps(p.id)) c
        where not exists (
          select 1 from public.alcada_substitutions s
          where s.titular_id = p.id and s.system_slug = 'cotacao-importacao'
            and s.cancelado_em is null and not s.titular_mantem
            and public.hub_hoje() between s.inicio and s.fim
            and c = any (public.hub_substituicao_caps(s.titular_id, s.tipo)))
        union
        select c
        from public.alcada_substitutions s,
             unnest(public.hub_substituicao_caps(s.titular_id, s.tipo)) c
        where s.substituto_id = p.id and s.system_slug = 'cotacao-importacao'
          and s.cancelado_em is null
          and public.hub_hoje() between s.inicio and s.fim
      ) x
    )
  end
  from public.profiles p where p.id = p_user
$$;

-- Módulos que o HUB pode revogar: catálogo do HUB + os 5 das substituições + admin
create or replace function public.hub_managed_modules()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select array_agg(m order by m)
  from (
    select module_key as m from public.catalog_modules where system_slug = 'cotacao-importacao'
    union select unnest(public.hub_substituicao_modulos())
    union select 'admin'
  ) x
$$;

revoke all on function public.hub_base_caps(uuid) from public, anon, authenticated;
revoke all on function public.hub_substituicao_caps(uuid, text) from public, anon, authenticated;

-- Gatilho: substituição criada / alterada / cancelada / excluída → reenvia titular e suplente
create or replace function public.trg_hub_substituicao_changed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  ids uuid[] := '{}';
  u   uuid;
begin
  if tg_op <> 'DELETE' then
    if new.system_slug = 'cotacao-importacao' then
      ids := ids || new.titular_id || new.substituto_id;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    if old.system_slug = 'cotacao-importacao' then
      ids := ids || old.titular_id || old.substituto_id;
    end if;
  end if;
  for u in select distinct unnest(ids) loop
    perform public.hub_push_person(u);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_hub_substituicao_changed on public.alcada_substitutions;
create trigger trg_hub_substituicao_changed
after insert or update or delete on public.alcada_substitutions
for each row execute function public.trg_hub_substituicao_changed();

-- Vencimento por data: quem começa hoje ou terminou ontem (data de Brasília)
create or replace function public.hub_push_substituicoes_do_dia()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  u uuid;
  n int := 0;
begin
  for u in
    select titular_id from public.alcada_substitutions
    where system_slug = 'cotacao-importacao' and cancelado_em is null
      and (inicio = public.hub_hoje() or fim = public.hub_hoje() - 1)
    union
    select substituto_id from public.alcada_substitutions
    where system_slug = 'cotacao-importacao' and cancelado_em is null
      and (inicio = public.hub_hoje() or fim = public.hub_hoje() - 1)
  loop
    if public.hub_push_person(u) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.hub_push_substituicoes_do_dia() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hub-substituicoes-diario';
select cron.schedule('hub-substituicoes-diario', '5 3 * * *', $$select public.hub_push_substituicoes_do_dia()$$);
