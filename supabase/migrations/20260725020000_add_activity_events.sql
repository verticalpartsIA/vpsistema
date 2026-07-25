-- Rastro de clique cross-sistema: entrada/saída real de cada app satélite,
-- alimentado pela edge function track-activity (roda com service_role, por
-- isso não há policy de INSERT aqui — só a function escreve).
create table public.activity_events (
  id          uuid primary key default gen_random_uuid(),
  app         text not null,
  event_type  text not null check (event_type in ('enter', 'exit')),
  user_email  text,
  user_name   text,
  target      text,
  session_id  text,
  details     jsonb,
  criado_em   timestamptz not null default now()
);

create index activity_events_email_idx  on public.activity_events (user_email, criado_em desc);
create index activity_events_session_idx on public.activity_events (session_id);

alter table public.activity_events enable row level security;

create policy events_select_admin on public.activity_events
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.level = 'Administrador'
    )
  );
