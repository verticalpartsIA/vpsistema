-- Registro de envios/tentativas do login por código via WhatsApp.
-- O código em si é gerado e validado pelo GoTrue (magiclink email_otp); esta
-- tabela só serve pra rate limit, expiração curta (5 min) e trava de tentativas.
-- Acesso exclusivo pela service role das edge functions: RLS ligado e sem
-- policy alguma, então anon/authenticated não leem nem escrevem.
create table if not exists public.whatsapp_login_attempts (
  id          bigint generated always as identity primary key,
  phone       text        not null,           -- só dígitos, DDD + número (10-11)
  kind        text        not null check (kind in ('send', 'verify_fail', 'verify_ok')),
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists whatsapp_login_attempts_phone_idx
  on public.whatsapp_login_attempts (phone, created_at desc);
create index if not exists whatsapp_login_attempts_ip_idx
  on public.whatsapp_login_attempts (ip, created_at desc);

alter table public.whatsapp_login_attempts enable row level security;
revoke all on public.whatsapp_login_attempts from anon, authenticated;
