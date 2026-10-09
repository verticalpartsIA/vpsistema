-- Central de Eventos. Aplicado somente na branch `central-eventos` do Supabase (teste).
-- Fora de supabase/migrations de propósito: só entra lá com autorização para ir à produção.
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
  modo text not null default 'sombra' check (modo in ('legado','sombra','ativo','desligado')),
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

-- ---------------------------------------------------------------- Segurança
-- Admin = perfil com level 'Administrador' (mesma regra que protege /eventos no portal).
create or replace function eventos.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and level = 'Administrador')
$$;
revoke all on function eventos.is_admin() from public, anon;
grant execute on function eventos.is_admin() to authenticated;

grant usage on schema eventos to authenticated;
grant select, insert, update, delete on all tables in schema eventos to authenticated;
alter default privileges in schema eventos grant select, insert, update, delete on tables to authenticated;
-- anon não recebe nada. A ingestão (edge function) usa service_role e ignora RLS.

do $$
declare t text;
begin
  foreach t in array array['origens','catalogo_gatilhos','eventos','templates','destinatarios','grupos',
                           'grupo_membros','regras','canais','envios','tentativas','auditoria']
  loop
    execute format('alter table eventos.%I enable row level security', t);
    execute format('drop policy if exists admin_select on eventos.%I', t);
    execute format('create policy admin_select on eventos.%I for select to authenticated using (eventos.is_admin())', t);
  end loop;
  -- Escrita pela interface: só o que o administrador edita. eventos, tentativas e auditoria são só do sistema.
  foreach t in array array['catalogo_gatilhos','templates','destinatarios','grupos','grupo_membros','regras','canais','envios']
  loop
    execute format('drop policy if exists admin_write on eventos.%I', t);
    execute format('create policy admin_write on eventos.%I for all to authenticated using (eventos.is_admin()) with check (eventos.is_admin())', t);
  end loop;
end $$;
-- origens guarda hash de chave: a interface só lê; quem altera é o processo de rotação.
revoke insert, update, delete on eventos.origens, eventos.eventos, eventos.tentativas, eventos.auditoria from authenticated;

-- ---------------------------------------------------------------- Auditoria automática
-- canais usa slug como chave (sem id) e grupo_membros tem chave composta
create or replace function eventos.auditar() returns trigger
language plpgsql security definer set search_path = eventos, public, pg_temp as $$
declare novo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        ref jsonb := coalesce(novo, velho);
begin
  insert into eventos.auditoria (ator, acao, objeto, antes, depois)
  values (coalesce(auth.uid()::text, current_user), tg_op,
          tg_table_name || ':' || coalesce(ref->>'id', ref->>'slug', (ref->>'grupo_id') || '/' || (ref->>'destinatario_id')),
          velho, novo);
  return coalesce(new, old);
end $$;
revoke all on function eventos.auditar() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['catalogo_gatilhos','regras','canais','destinatarios','grupos','grupo_membros','templates']
  loop
    execute format('drop trigger if exists trg_auditar on eventos.%I', t);
    execute format('create trigger trg_auditar after insert or update or delete on eventos.%I for each row execute function eventos.auditar()', t);
  end loop;
end $$;

-- Auditoria é append-only
create or replace function eventos.bloquear_alteracao() returns trigger language plpgsql as $$
begin raise exception 'eventos.auditoria é somente de inclusão'; end $$;
drop trigger if exists trg_auditoria_imutavel on eventos.auditoria;
create trigger trg_auditoria_imutavel before update or delete on eventos.auditoria
  for each row execute function eventos.bloquear_alteracao();

-- ---------------------------------------------------------------- Dados iniciais
insert into eventos.canais (slug, ativo, limite_por_minuto, intervalo_min_ms) values
  ('whatsapp', true,  20, 2000),
  ('interno',  true,  60, 0),
  ('email',    false, 30, 0)
on conflict (slug) do nothing;

-- Origens e catálogo inicial (gerado de src/lib/eventosCatalogo.js)
insert into eventos.origens (slug, nome) values
  ('vprequisicoes', 'VP Requisições'),
  ('posvenda360', 'Pós-Venda 360'),
  ('vphub', 'VP HUB'),
  ('vpclick', 'VP Click'),
  ('vpsistema', 'Portal')
on conflict (slug) do nothing;

insert into eventos.catalogo_gatilhos (origem_id, tipo, descricao, ativo, modo, legado_ref)
select o.id, v.tipo, v.descricao, true, v.modo, v.legado from (values
  ('vprequisicoes', 'requisicao.criada', 'Requisição criada, aguarda ciência do gestor', 'sombra', 'LIDER_CIENCIA / REQUISITANTE_CRIADA'),
  ('vprequisicoes', 'requisicao.ciencia_ok', 'Gestor deu ciência, segue para cotação', 'sombra', 'COMPRADOR_COTAR / REQUISITANTE_CIENCIA_OK'),
  ('vprequisicoes', 'requisicao.reprovada_gestor', 'Gestor reprovou a requisição', 'sombra', 'REQUISITANTE_REPROVADO_GESTOR'),
  ('vprequisicoes', 'requisicao.cotada', 'Cotação finalizada, aguarda aprovação', 'sombra', 'APROVACAO_PENDENTE / REQUISITANTE_COTADO'),
  ('vprequisicoes', 'requisicao.aprovada', 'Aprovação financeira concedida (total ou parcial)', 'sombra', 'COMPRA_APROVADA / REQUISITANTE_APROVADO_*'),
  ('vprequisicoes', 'requisicao.reprovada', 'Aprovação financeira negada', 'sombra', 'REQUISITANTE_REPROVADO_FINANCEIRO'),
  ('vprequisicoes', 'requisicao.comprada', 'Compra confirmada', 'sombra', 'REQUISITANTE_COMPRADO'),
  ('vprequisicoes', 'requisicao.recebida', 'Material recebido', 'sombra', 'EXPEDICAO_RECEBIMENTO / REQUISITANTE_RECEBIDO'),
  ('vprequisicoes', 'requisicao.sla_vencida', 'Etapa parada além da meta de SLA', 'sombra', 'cron SLA a cada 4h'),
  ('posvenda360', 'nf.emitida_classe_a', 'NF de cliente classe A emitida (follow-up VIP)', 'sombra', 'VIP_FOLLOWUP'),
  ('posvenda360', 'pesquisa.enviada', 'Pesquisa de satisfação (NPS) após a entrega', 'sombra', 'enviar-pesquisa'),
  ('posvenda360', 'handoff.vencido', 'Responsável não atendeu o cliente no prazo', 'sombra', 'cron-handoffs'),
  ('posvenda360', 'handoff.criado', 'IA acionou um departamento (avisar_departamento)', 'sombra', 'avisar_departamento'),
  ('posvenda360', 'ticket.criado', 'Ticket de atendimento criado ou alterado', 'legado', 'trg_vpclick_ticket_*'),
  ('posvenda360', 'ticket_interno.criado', 'Ticket interno criado', 'legado', 'trg_vpclick_interno'),
  ('posvenda360', 'expedicao.divergencia', 'Divergência na conferência da expedição', 'legado', 'expedicao-divergencia'),
  ('vphub', 'decisao.pendente', 'Decisão gerencial aguardando aprovação', 'sombra', 'whatsapp-notify (não ativo) / alerta T1'),
  ('vphub', 'decisao.resolvida', 'Decisão aprovada ou reprovada', 'sombra', 'whatsapp-notify (não ativo) / alerta J1'),
  ('vphub', 'proposta.aprovada', 'Proposta aprovada, avais financeiro e jurídico abertos', 'legado', 'alerta T2'),
  ('vphub', 'aval.liberado', 'Avais OK, compra na China liberada', 'legado', 'alerta T3'),
  ('vphub', 'contrato.assinado', 'Proposta ou contrato assinado, recusado ou revisado', 'legado', 'alerta T9 / J2-J4'),
  ('vphub', 'projeto_instalacao.assinado', 'Projeto de instalação assinado ou recusado', 'legado', 'alerta T7'),
  ('vphub', 'inbox.sem_resposta', 'E-mail de entrada sem resposta (2h e 4h úteis)', 'legado', 'cron C2'),
  ('vphub', 'embarque.chegando', 'Navio chegando em até 3 dias úteis', 'legado', 'cron C5'),
  ('vphub', 'pcp.atraso', 'Pedidos, compras e expedição com prazo vencido', 'legado', 'crons C6-C8, E1, E2'),
  ('vphub', 'solicitacao_produto.criada', 'Nova solicitação de produto', 'legado', 'alerta J9 (destinatário fixo no código)'),
  ('vpclick', 'tarefa.observador_adicionado', 'Pessoa adicionada como observador da tarefa', 'sombra', 'whatsapp-notify-event (dry-run) e motor legado'),
  ('vpclick', 'tarefa.mencao', 'Pessoa mencionada em tarefa ou comentário', 'sombra', 'whatsapp-notify-event (dry-run) e motor legado'),
  ('vpclick', 'tarefa.concluida', 'Tarefa concluída ou cancelada', 'sombra', 'whatsapp-notify-event (dry-run) e motor legado'),
  ('vpclick', 'tarefa.resumo_diario', 'Resumo diário de atrasadas e inatividade', 'legado', 'motor legado na VPS'),
  ('vpsistema', 'acesso.codigo_2fa', 'Código de verificação no login', 'legado', 'two-factor'),
  ('vpsistema', 'acesso.primeiro_acesso', 'Link de primeiro acesso', 'legado', 'whatsapp-first-access'),
  ('vpsistema', 'comunicado.agendado', 'Disparo agendado de WhatsApp', 'legado', 'send-broadcast')
) as v(slug, tipo, descricao, modo, legado) join eventos.origens o on o.slug = v.slug
on conflict (origem_id, tipo) do nothing;
