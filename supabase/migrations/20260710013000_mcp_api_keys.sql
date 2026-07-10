-- Chaves de acesso para o servidor MCP remoto (conector do Claude).
-- Armazena apenas o hash SHA-256 do token; o valor em texto puro nunca é persistido.
create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text not null unique,
  created_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone,
  active boolean not null default true
);

alter table public.mcp_api_keys enable row level security;
-- Sem policies: acesso somente via service_role (usado pela Edge Function), que ignora RLS.
