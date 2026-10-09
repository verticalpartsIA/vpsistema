-- Árvore de alçadas: SUBSTITUIÇÃO TEMPORÁRIA (férias) + MENSAGENS WHATSAPP.
-- Decisões do Gelson (09/10/2026).
--
-- ── Substituição temporária ────────────────────────────────────────────────
-- A ciência e/ou o nível de aprovação de um titular "migram" para outra pessoa
-- por um período — "não fica nada parado". Regras (valem no servidor):
--   • aprovação financeira: só quem tem poderes PLENOS cadastra/altera;
--   • ciência: PLENOS ou MÉDIOS (médio nunca em favor de si mesmo e só para
--     quem está abaixo dele — mesma regra de can_grant_powers_to);
--   • o titular continua podendo agir durante o período (padrão) — só
--     PLENOS desligam isso (titular_mantem = false);
--   • a substituta herdar o nível do titular — só PLENOS ligam/desligam.

create table if not exists public.alcada_substitutions (
  id             uuid primary key default gen_random_uuid(),
  titular_id     uuid not null references public.profiles(id) on delete cascade,
  substituto_id  uuid not null references public.profiles(id) on delete cascade,
  system_slug    text not null references public.modules(slug) on update cascade on delete cascade,
  tipo           text not null check (tipo in ('ciencia', 'aprovacao')),   -- = module_key no catálogo
  inicio         date not null,
  fim            date not null,
  titular_mantem boolean not null default true,
  herda_nivel    boolean not null default true,
  motivo         text,
  criado_por     uuid references public.profiles(id) on delete set null,
  criado_em      timestamptz not null default now(),
  cancelado_por  uuid references public.profiles(id) on delete set null,
  cancelado_em   timestamptz,
  check (fim >= inicio),
  check (titular_id <> substituto_id)
);

create index if not exists alcada_substitutions_ativas_idx
  on public.alcada_substitutions (system_slug, inicio, fim) where cancelado_em is null;

create or replace function public.enforce_substitution_powers()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  me text;
begin
  if auth.uid() is null then return new; end if;   -- service role
  me := public.get_my_power();

  if new.tipo = 'aprovacao' and me is distinct from 'plenos' then
    raise exception 'Substituição de aprovação financeira só por quem tem poderes plenos.';
  end if;
  if me is distinct from 'plenos' and me is distinct from 'medios' then
    raise exception 'Você não tem alçada para cadastrar substituições.';
  end if;
  if me = 'medios' then
    if new.substituto_id = auth.uid() or new.titular_id = auth.uid() then
      raise exception 'Você não pode cadastrar substituição envolvendo a si mesmo.';
    end if;
    if not public.can_grant_powers_to(new.substituto_id) then
      raise exception 'Com poderes médios você só passa a ciência para quem está abaixo de você.';
    end if;
    if tg_op = 'INSERT' and (new.titular_mantem is distinct from true or new.herda_nivel is distinct from true) then
      raise exception 'Só quem tem poderes plenos altera "titular continua" e "herda o nível".';
    end if;
    if tg_op = 'UPDATE' and (new.titular_mantem is distinct from old.titular_mantem or new.herda_nivel is distinct from old.herda_nivel) then
      raise exception 'Só quem tem poderes plenos altera "titular continua" e "herda o nível".';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_substitution_powers on public.alcada_substitutions;
create trigger trg_enforce_substitution_powers
before insert or update on public.alcada_substitutions
for each row execute function public.enforce_substitution_powers();

alter table public.alcada_substitutions enable row level security;
drop policy if exists alcada_substitutions_read on public.alcada_substitutions;
create policy alcada_substitutions_read on public.alcada_substitutions for select to authenticated
  using (public.get_my_power() is not null or auth.uid() in (titular_id, substituto_id));
drop policy if exists alcada_substitutions_write on public.alcada_substitutions;
create policy alcada_substitutions_write on public.alcada_substitutions for all to authenticated
  using (public.get_my_power() is not null) with check (public.get_my_power() is not null);
grant select, insert, update on public.alcada_substitutions to authenticated;

-- Alçadas EFETIVAS de um sistema (o que os sistemas vão ler): o que cada um
-- tem + o que recebeu por substituição ativa hoje − o que o titular cedeu
-- quando "titular continua" estiver desligado. Titular com poderes plenos
-- cede o nível máximo (ciência de todos / aprovação N3).
create or replace function public.effective_user_grants(p_system text)
returns table (user_id uuid, module_key text, action_key text, via_substituicao uuid)
language sql stable security definer
set search_path = public
as $$
  with ativas as (
    select * from public.alcada_substitutions
    where system_slug = p_system and cancelado_em is null
      and current_date between inicio and fim
  )
  select g.user_id, g.module_key, g.action_key, null::uuid
  from public.user_grants g
  where g.system_slug = p_system
    and not exists (select 1 from ativas s
                    where s.titular_id = g.user_id and s.tipo = g.module_key and not s.titular_mantem)
  union
  select s.substituto_id, g.module_key, g.action_key, s.id
  from ativas s
  join public.user_grants g on g.user_id = s.titular_id and g.system_slug = s.system_slug and g.module_key = s.tipo
  where s.tipo = 'ciencia' or s.herda_nivel
  union
  select s.substituto_id, s.tipo,
         case s.tipo when 'ciencia' then 'ciencia_todos' else 'aprovador_n3' end, s.id
  from ativas s join public.profiles t on t.id = s.titular_id and t.power_level = 'plenos'
  where s.tipo = 'ciencia' or s.herda_nivel
$$;

grant execute on function public.effective_user_grants(text) to authenticated;

-- ── Mensagens WhatsApp (VPRequisições) ─────────────────────────────────────
-- Item da árvore: o colaborador só recebe o tipo de aviso que estiver
-- flegado (opt-in explícito, inclusive para quem tem poderes plenos).
-- O número usado é o de notificação (corporativo, senão pessoal).
insert into public.catalog_modules (system_slug, module_key, label, group_label, sort_order) values
  ('vprequisicoes', 'whatsapp', 'Mensagens WhatsApp', 'Avisos', 10)
on conflict (system_slug, module_key) do update set label = excluded.label, group_label = excluded.group_label, sort_order = excluded.sort_order;

insert into public.catalog_actions (system_slug, module_key, action_key, label, choice_group, sort_order) values
  ('vprequisicoes', 'whatsapp', 'aviso_ciencia',   'Recebe: tem requisição para dar ciência',               null, 0),
  ('vprequisicoes', 'whatsapp', 'aviso_cotacao',   'Recebe: tem cotação para fazer',                        null, 1),
  ('vprequisicoes', 'whatsapp', 'aviso_aprovacao', 'Recebe: tem aprovação para decidir',                    null, 2),
  ('vprequisicoes', 'whatsapp', 'aviso_compra',    'Recebe: compra aprovada (para comprar)',                null, 3),
  ('vprequisicoes', 'whatsapp', 'aviso_chegada',   'Recebe: material vai chegar na VerticalParts (expedição)', null, 4),
  ('vprequisicoes', 'whatsapp', 'aviso_fases',     'Recebe: andamento das próprias requisições (cada fase)', null, 5)
on conflict (system_slug, module_key, action_key) do update set label = excluded.label, sort_order = excluded.sort_order;
