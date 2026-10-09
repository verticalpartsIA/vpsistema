-- RASCUNHO PARA REVISÃO. NÃO APLICADO. Fora de supabase/migrations de propósito.
create schema if not exists eventos;

create table eventos.origens (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nome text not null,
  ativo boolean not null default true,
  chave_hash text,
  segredo_hmac_ref text,
  chave_ultima_rotacao timestamptz,
  criado_em timestamptz not null default now()
);

create table eventos.catalogo_gatilhos (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null references eventos.origens(id),
  tipo text not null,
  descricao text,
  schema_payload jsonb,
  ativo boolean not null default true,
  modo text not null default 'sombra' check (modo in ('sombra','ativo','desligado')),
  legado_ref text,
  unique (origem_id, tipo)
);

create table eventos.eventos (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null references eventos.origens(id),
  tipo text not null,
  idempotency_key text not null,
  ocorrido_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  ator jsonb,
  entidade_tipo text,
  entidade_id text,
  payload jsonb not null default '{}',
  status text not null default 'recebido'
    check (status in ('recebido','processado','sem_regra','erro')),
  correlacao_id uuid,
  unique (origem_id, idempotency_key)
);
create index on eventos.eventos (status, recebido_em);
create index on eventos.eventos (entidade_tipo, entidade_id);

create table eventos.templates (
  id uuid primary key default gen_random_uuid(),
  canal text not null,
  idioma text not null default 'pt-BR',
  assunto text,
  corpo text not null,
  versao int not null default 1
);

create table eventos.destinatarios (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pessoa','externo')),
  perfil_id uuid,
  nome text not null,
  whatsapp text,
  email text,
  ativo boolean not null default true,
  aceita_whatsapp boolean not null default true,
  aceita_email boolean not null default true
);

create table eventos.grupos (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  tipo text not null check (tipo in ('papel','departamento','lista')),
  nome text not null
);
create table eventos.grupo_membros (
  grupo_id uuid references eventos.grupos(id) on delete cascade,
  destinatario_id uuid references eventos.destinatarios(id) on delete cascade,
  primary key (grupo_id, destinatario_id)
);

create table eventos.regras (
  id uuid primary key default gen_random_uuid(),
  gatilho_id uuid not null references eventos.catalogo_gatilhos(id),
  ativa boolean not null default true,
  condicao jsonb,
  canais text[] not null,
  template_id uuid references eventos.templates(id),
  destino jsonb not null,
  janela_envio jsonb,
  atraso_segundos int not null default 0,
  prioridade int not null default 5
);

create table eventos.canais (
  slug text primary key,
  ativo boolean not null default true,
  config_ref text,
  limite_por_minuto int not null default 20,
  intervalo_min_ms int not null default 2000
);

create table eventos.envios (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos.eventos(id),
  regra_id uuid not null references eventos.regras(id),
  destinatario_id uuid not null references eventos.destinatarios(id),
  canal text not null references eventos.canais(slug),
  status text not null default 'pendente'
    check (status in ('pendente','processando','enviado','falha','descartado','cancelado','simulado')),
  agendado_para timestamptz not null default now(),
  tentativas int not null default 0,
  proxima_tentativa_em timestamptz,
  mensagem_renderizada text,
  motivo_descarte text,
  unique (evento_id, regra_id, destinatario_id, canal)
);
create index on eventos.envios (status, agendado_para);

create table eventos.tentativas (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid not null references eventos.envios(id) on delete cascade,
  iniciada_em timestamptz not null default now(),
  resultado text not null,
  http_status int,
  erro text,
  id_externo text
);

create table eventos.auditoria (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  ator text,
  acao text not null,
  objeto text,
  antes jsonb,
  depois jsonb
);

-- RLS: tudo fechado por padrão; a interface lê por políticas de perfil admin (a definir na etapa 3).
alter table eventos.origens enable row level security;
alter table eventos.catalogo_gatilhos enable row level security;
alter table eventos.eventos enable row level security;
alter table eventos.templates enable row level security;
alter table eventos.destinatarios enable row level security;
alter table eventos.grupos enable row level security;
alter table eventos.grupo_membros enable row level security;
alter table eventos.regras enable row level security;
alter table eventos.canais enable row level security;
alter table eventos.envios enable row level security;
alter table eventos.tentativas enable row level security;
alter table eventos.auditoria enable row level security;
