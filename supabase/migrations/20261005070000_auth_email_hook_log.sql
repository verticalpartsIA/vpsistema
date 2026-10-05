-- Registro (só o tipo da ação, sem e-mail) dos e-mails nativos do Auth descartados pelo
-- hook auth-email-hook. Serve para provar que o hook está ativo e ver tentativas.
create table if not exists public.auth_email_hook_log (
  id         bigint generated always as identity primary key,
  action     text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_email_hook_log_created_idx on public.auth_email_hook_log (created_at desc);
alter table public.auth_email_hook_log enable row level security;
revoke all on public.auth_email_hook_log from anon, authenticated;
