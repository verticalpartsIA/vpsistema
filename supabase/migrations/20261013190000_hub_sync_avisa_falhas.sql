-- vpsistema → VP HUB: avisar quando o HUB RECUSA ou não responde (13/10/2026).
--
-- Problema: o HUB devolve HTTP 200 mesmo quando recusa (ex.: {"ok":false,
-- "motivo":"sem_perfil_no_hub"} para quem não tem perfil lá) e o vpsistema só
-- olhava o 200 — a falha passava em silêncio. pg_net é assíncrono, então o
-- hub_push_person não enxerga a resposta; por isso:
--   1. hub_call registra cada envio em hub_sync_envios;
--   2. hub_sync_verificar() cruza os envios com net._http_response e grava em
--      hub_sync_falhas tudo que não voltou {"ok":true} (recusa, erro HTTP,
--      resposta ilegível ou sem resposta há mais de 1h) + RAISE WARNING;
--   3. roda a cada 10 min (as respostas do pg_net duram poucas horas).

create table if not exists public.hub_sync_envios (
  request_id bigint primary key,
  acao       text,
  email      text,
  enviado_em timestamptz not null default now(),
  checado    boolean not null default false
);

create table if not exists public.hub_sync_falhas (
  id           bigserial primary key,
  request_id   bigint unique,
  acao         text,
  email        text,
  motivo       text not null,
  status_code  int,
  resposta     text,
  detectado_em timestamptz not null default now()
);

alter table public.hub_sync_envios enable row level security;
alter table public.hub_sync_falhas enable row level security;
drop policy if exists hub_sync_falhas_read on public.hub_sync_falhas;
create policy hub_sync_falhas_read on public.hub_sync_falhas for select to authenticated
  using (public.get_my_power() is not null);

-- hub_call igual ao anterior + registro do envio
create or replace function public.hub_call(p_body jsonb)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id     bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hub.SYNC_SECRET';
  if v_secret is null then raise warning 'hub_call: senha hub.SYNC_SECRET ausente no cofre'; return null; end if;
  v_id := net.http_post(
    url     := 'https://jxtqwzmpgofwctqajewt.supabase.co/functions/v1/vpsistema-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body    := p_body,
    timeout_milliseconds := 15000
  );
  insert into public.hub_sync_envios (request_id, acao, email)
  values (v_id, p_body->>'action', coalesce(p_body->>'p_email', p_body->>'p_new'))
  on conflict (request_id) do nothing;
  return v_id;
end;
$$;
revoke all on function public.hub_call(jsonb) from public, anon, authenticated;

create or replace function public.hub_sync_verificar()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  r      record;
  v_ok   boolean;
  v_mot  text;
  v_json jsonb;
  n      int := 0;
begin
  for r in
    select e.request_id, e.acao, e.email, e.enviado_em, h.status_code, h.content, h.error_msg
    from public.hub_sync_envios e
    left join net._http_response h on h.id = e.request_id
    where not e.checado
  loop
    if r.status_code is null and r.error_msg is null then
      -- ainda sem resposta: só vira falha depois de 1h
      if r.enviado_em > now() - interval '1 hour' then continue; end if;
      v_ok := false; v_mot := 'sem_resposta';
    else
      begin v_json := r.content::jsonb; exception when others then v_json := null; end;
      if r.status_code = 200 and v_json->>'ok' = 'true' then
        v_ok := true;
      else
        v_ok := false;
        v_mot := coalesce(v_json->>'motivo', v_json->>'erro', r.error_msg,
                          case when r.status_code is distinct from 200 then 'http_' || coalesce(r.status_code::text, 'sem_status') end,
                          'resposta_invalida');
      end if;
    end if;

    update public.hub_sync_envios set checado = true where request_id = r.request_id;
    if not v_ok then
      insert into public.hub_sync_falhas (request_id, acao, email, motivo, status_code, resposta)
      values (r.request_id, r.acao, coalesce(r.email, v_json->>'email'), v_mot, r.status_code, left(r.content, 500))
      on conflict (request_id) do nothing;
      raise warning 'hub_sync: HUB recusou % de % — %', r.acao, coalesce(r.email, v_json->>'email', '?'), v_mot;
      n := n + 1;
    end if;
  end loop;

  delete from public.hub_sync_envios where checado and enviado_em < now() - interval '7 days';
  return n;
end;
$$;
revoke all on function public.hub_sync_verificar() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hub-sync-verificar';
select cron.schedule('hub-sync-verificar', '*/10 * * * *', $$select public.hub_sync_verificar()$$);
