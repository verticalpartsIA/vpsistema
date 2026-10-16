-- 16/10/2026 (Gelson) — botão Ligado/Pausado do WhatsApp por pessoa em vpsistema.com/eventos/destinatarios.
-- Caso real: Bianca recebendo muitos avisos de P.I. Pausa TOTAL (aceita_whatsapp = false) ou PARCIAL (só alguns
-- assuntos), com volta automática opcional (whatsapp_pausa_ate). Vale para o gi-avisos (lê por giavisos_pausas) e
-- para o despachante da própria Central (aceita_whatsapp). Pedido de assinatura NUNCA é pausado (não trava contratos).
-- Aviso pausado não é guardado para depois: fica no Monitor como 'pausado'.

alter table eventos.destinatarios
  add column if not exists whatsapp_pausa_assuntos text[],      -- null/vazio = sem pausa parcial
  add column if not exists whatsapp_pausa_ate timestamptz,      -- null = até alguém religar
  add column if not exists whatsapp_pausa_motivo text,
  add column if not exists whatsapp_pausa_por text,
  add column if not exists whatsapp_pausa_em timestamptz;

-- Assuntos que a tela oferece (slug = o que vai em whatsapp_pausa_assuntos). O gi-avisos traduz o tipo do aviso no assunto.
create table if not exists eventos.assuntos_whatsapp (
  slug text primary key,
  rotulo text not null,
  exemplos text not null,
  ordem int not null default 0,
  pausavel boolean not null default true
);
insert into eventos.assuntos_whatsapp (slug, rotulo, exemplos, ordem, pausavel) values
  ('importacao',  'P.I. e importação',             'P.I. criada, compra iniciada/confirmada/liberada, Cargo Ready, embarque chegou, entregue na obra', 1, true),
  ('fornecedor',  'Fornecedores e cotações',       'RFQ enviada, fornecedor respondeu, fornecedor atrasado, e-mail recebido', 2, true),
  ('precificacao','Formulário e precificação',     'formulário preenchido, precificação concluída', 3, true),
  ('propostas',   'Propostas e contratos',         'proposta visualizada/assinada/recusada, contrato enviado/assinado, sinal pago, contrato do instalador gerado', 4, true),
  ('decisoes',    'Decisões e aprovações',         'decisão pendente, alçadas', 5, true),
  ('alertas',     'Alertas do sistema',            'almoxarifado, financeiro, jurídico, caixa de entrada', 6, true),
  ('prazos',      'Cobranças de prazo',            'prazo vencido e escalonamento', 7, true),
  ('instalacao',  'Instalação',                    'instalação iniciada/concluída', 8, true),
  ('assinaturas', 'Pedidos de assinatura',         'link para assinar contrato — não pode ser pausado', 9, false)
on conflict (slug) do update set rotulo = excluded.rotulo, exemplos = excluded.exemplos, ordem = excluded.ordem, pausavel = excluded.pausavel;
alter table eventos.assuntos_whatsapp enable row level security;
drop policy if exists admin_select on eventos.assuntos_whatsapp;
create policy admin_select on eventos.assuntos_whatsapp for select using (eventos.is_admin());
grant select on eventos.assuntos_whatsapp to authenticated;

-- Quem pausou/religou e quando — carimbado pelo banco (a tela não precisa mandar).
create or replace function eventos.trg_destinatarios_pausa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.aceita_whatsapp is distinct from old.aceita_whatsapp
     or new.whatsapp_pausa_assuntos is distinct from old.whatsapp_pausa_assuntos
     or new.whatsapp_pausa_ate is distinct from old.whatsapp_pausa_ate then
    new.whatsapp_pausa_em := now();
    new.whatsapp_pausa_por := coalesce(nullif(auth.jwt()->>'email', ''), current_user::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_destinatarios_pausa on eventos.destinatarios;
create trigger trg_destinatarios_pausa before update on eventos.destinatarios for each row execute function eventos.trg_destinatarios_pausa();

-- Leitura do gi-avisos (só quem tem alguma pausa valendo agora).
create or replace function eventos.giavisos_pausas() returns table (email text, nome text, total boolean, assuntos text[], ate timestamptz, motivo text)
language sql stable security definer set search_path = '' as $$
  select lower(d.email), d.nome, not coalesce(d.aceita_whatsapp, true), coalesce(d.whatsapp_pausa_assuntos, '{}'), d.whatsapp_pausa_ate, d.whatsapp_pausa_motivo
    from eventos.destinatarios d
   where d.email is not null
     and (not coalesce(d.aceita_whatsapp, true) or coalesce(array_length(d.whatsapp_pausa_assuntos, 1), 0) > 0)
     and (d.whatsapp_pausa_ate is null or d.whatsapp_pausa_ate > now())
$$;
revoke all on function eventos.giavisos_pausas() from public, anon, authenticated;
grant execute on function eventos.giavisos_pausas() to svc_giavisos;

-- Monitor: nova situação 'pausado'.
alter table eventos.entregas_externas drop constraint if exists entregas_externas_situacao_check;
alter table eventos.entregas_externas add constraint entregas_externas_situacao_check
  check (situacao in ('previsto', 'enviado', 'agrupado', 'encerrado', 'na_fila', 'sem_numero', 'autor', 'erro', 'pausado'));
