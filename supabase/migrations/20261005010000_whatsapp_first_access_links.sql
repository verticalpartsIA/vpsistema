-- Links de primeiro acesso enviados por WhatsApp (parte B do login por celular).
-- Guarda só o hash SHA-256 do token (o token em si só existe na mensagem).
-- Uso único (used_at) e validade curta (expires_at). Acesso exclusivo pela
-- service role das edge functions: RLS ligado e sem policy alguma.
create table if not exists public.whatsapp_first_access_links (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null,
  token_hash  text        not null unique,
  created_by  uuid,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists whatsapp_first_access_links_user_idx
  on public.whatsapp_first_access_links (user_id, created_at desc);

alter table public.whatsapp_first_access_links enable row level security;
revoke all on public.whatsapp_first_access_links from anon, authenticated;
