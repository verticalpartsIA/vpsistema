-- Dois celulares (Corporativo e Pessoal) + registro de inativação.
-- Decisões do Gelson em 09/10/2026.
--
-- ── Celulares ──────────────────────────────────────────────────────────────
-- Regra de envio de mensagens: se tiver os dois, SÓ o corporativo recebe;
-- se tiver só um, esse recebe.
--
-- `profiles.celular` continua existindo e passa a ser o NÚMERO DE
-- NOTIFICAÇÃO, calculado sozinho = coalesce(corporativo, pessoal). Assim
-- todos que já leem `celular` (login 2FA, broadcasts, gi-avisos, sync dos
-- satélites, metadata do Auth) seguem a regra sem mudar nada.
--
-- Escritas antigas direto em `celular` (sistemas que ainda não conhecem os
-- dois campos) continuam funcionando: vão para o campo que hoje é a fonte
-- da notificação (corporativo se existir, senão pessoal).

alter table public.profiles
  add column if not exists celular_corporativo text,
  add column if not exists celular_pessoal     text;

comment on column public.profiles.celular_corporativo is 'Celular corporativo (só dígitos, DDD + 9). Tem prioridade para mensagens.';
comment on column public.profiles.celular_pessoal     is 'Celular pessoal (só dígitos, DDD + 9). Recebe mensagens só se não houver corporativo.';
comment on column public.profiles.celular             is 'Número de NOTIFICAÇÃO (calculado): corporativo se houver, senão pessoal. Não editar direto.';

-- O número que já existe não sabemos se é corporativo ou pessoal: vai para
-- "pessoal" (ninguém perde dado se depois cadastrarem o corporativo). A
-- equipe revisa/preenche aos poucos.
update public.profiles
set celular_pessoal = celular
where nullif(celular, '') is not null
  and celular_corporativo is null and celular_pessoal is null;

create or replace function public.sync_celular_notificacao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.celular_corporativo := nullif(regexp_replace(coalesce(new.celular_corporativo, ''), '\D', '', 'g'), '');
  new.celular_pessoal     := nullif(regexp_replace(coalesce(new.celular_pessoal, ''), '\D', '', 'g'), '');

  -- Escrita antiga direto em `celular` (sem mexer nos dois campos novos)
  if tg_op = 'INSERT' then
    if new.celular_corporativo is null and new.celular_pessoal is null
       and nullif(new.celular, '') is not null then
      new.celular_pessoal := regexp_replace(new.celular, '\D', '', 'g');
    end if;
  elsif new.celular is distinct from old.celular
        and new.celular_corporativo is not distinct from old.celular_corporativo
        and new.celular_pessoal     is not distinct from old.celular_pessoal then
    if old.celular_corporativo is not null then
      new.celular_corporativo := nullif(regexp_replace(coalesce(new.celular, ''), '\D', '', 'g'), '');
    else
      new.celular_pessoal := nullif(regexp_replace(coalesce(new.celular, ''), '\D', '', 'g'), '');
    end if;
  end if;

  new.celular := coalesce(new.celular_corporativo, new.celular_pessoal);
  return new;
end;
$$;

drop trigger if exists trg_sync_celular_notificacao on public.profiles;
-- Nome começa com "a_" para rodar ANTES dos demais BEFORE triggers (ordem
-- alfabética) e do AFTER que espelha o celular no metadata do Auth.
create trigger a_trg_sync_celular_notificacao
before insert or update on public.profiles
for each row execute function public.sync_celular_notificacao();

-- ── Inativação com motivo ──────────────────────────────────────────────────
-- 1ª pergunta ao inativar: "Demissão" ou "Suspensão de acesso" (afastamento,
-- licença ou motivo ainda não definido). Só na Demissão aparece o checklist
-- de devolução de ativos (crachá, celular, notebook…). Cada inativação vira
-- um mini-relatório consultável.
create table if not exists public.profile_inactivations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  motivo        text not null check (motivo in ('demissao', 'suspensao')),
  observacao    text,
  -- [{ "item": "Crachá", "status": "devolvido" | "pendente" | "nao_possuia" }]
  devolucoes    jsonb not null default '[]'::jsonb,
  inativado_por uuid references public.profiles(id) on delete set null,
  inativado_em  timestamptz not null default now(),
  reativado_por uuid references public.profiles(id) on delete set null,
  reativado_em  timestamptz
);

create index if not exists profile_inactivations_user_idx
  on public.profile_inactivations (user_id, inativado_em desc);

alter table public.profile_inactivations enable row level security;

drop policy if exists profile_inactivations_power_all on public.profile_inactivations;
create policy profile_inactivations_power_all on public.profile_inactivations
  for all to authenticated
  using (public.get_my_power() is not null)
  with check (public.get_my_power() is not null);

grant select, insert, update on public.profile_inactivations to authenticated;
