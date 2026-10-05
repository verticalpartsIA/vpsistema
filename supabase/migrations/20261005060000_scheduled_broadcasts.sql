-- Disparos agendados de WhatsApp (avisos para a equipe). Cada disparo é uma linha com
-- horário, mensagem e o hash de um token de uso único; um job do pg_cron chama a edge
-- function send-broadcast com o token no horário marcado. Só a service role acessa.
create table if not exists public.scheduled_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  run_at      timestamptz not null,
  message     text not null,
  audience    text[],                      -- null = todos os perfis ativos com celular válido; senão, lista de celulares (só dígitos)
  token_hash  text not null,
  status      text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  recipients  int,
  sent        int not null default 0,
  failed      int not null default 0,
  detail      jsonb,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
alter table public.scheduled_broadcasts enable row level security;
revoke all on public.scheduled_broadcasts from anon, authenticated;

-- Destinatários "todos": um por número (quem divide o celular recebe uma mensagem só).
create or replace function public.broadcast_recipients()
returns table (phone text, name text)
language sql
security definer
set search_path = public
as $$
  select distinct on (d.phone) d.phone, d.name
    from (
      select regexp_replace(p.celular, '\D', '', 'g') as phone, p.name
        from public.profiles p
        join auth.users u on u.id = p.id
       where p.is_active
         and length(regexp_replace(coalesce(p.celular, ''), '\D', '', 'g')) in (10, 11)
    ) d
   order by d.phone, d.name
$$;
revoke all on function public.broadcast_recipients() from public, anon, authenticated;
grant execute on function public.broadcast_recipients() to service_role;
