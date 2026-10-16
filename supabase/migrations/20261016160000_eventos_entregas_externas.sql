-- 16/10/2026 (Gelson): o WhatsApp dos avisos do HUB (hub.aviso_fluxo) é enviado pelo gi-avisos (VPS),
-- não pelo worker da Central. Para a tela /eventos mostrar o que aconteceu com cada evento,
-- o gi-avisos anota aqui, por destinatário, a situação: previsto (comparação), enviado, agrupado,
-- encerrado (aviso já resolvido no HUB), na_fila (fora do horário), sem_numero, autor ou erro.
create table if not exists eventos.entregas_externas (
  id bigserial primary key,
  evento_id uuid not null references eventos.eventos(id) on delete cascade,
  destinatario_email text not null,
  destinatario_nome text,
  situacao text not null check (situacao in ('previsto','enviado','agrupado','encerrado','na_fila','sem_numero','autor','erro')),
  detalhe text,
  sistema text not null default 'gi-avisos',
  em timestamptz not null default now(),
  unique (evento_id, destinatario_email, situacao)
);
create index if not exists entregas_externas_evento_idx on eventos.entregas_externas (evento_id);
alter table eventos.entregas_externas enable row level security;
drop policy if exists entregas_externas_admin_le on eventos.entregas_externas;
create policy entregas_externas_admin_le on eventos.entregas_externas for select to authenticated using (eventos.is_admin());
revoke all on eventos.entregas_externas from anon;
grant select on eventos.entregas_externas to authenticated;

-- Única porta de escrita: só o papel do gi-avisos executa. Repetir a mesma situação só atualiza a hora/detalhe.
create or replace function eventos.giavisos_registrar_entrega(
  p_evento uuid, p_email text, p_nome text, p_situacao text, p_detalhe text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into eventos.entregas_externas (evento_id, destinatario_email, destinatario_nome, situacao, detalhe)
  values (p_evento, lower(trim(p_email)), nullif(trim(p_nome), ''), p_situacao, left(p_detalhe, 500))
  on conflict (evento_id, destinatario_email, situacao)
  do update set em = now(), detalhe = excluded.detalhe, destinatario_nome = coalesce(excluded.destinatario_nome, eventos.entregas_externas.destinatario_nome);
end $$;
revoke all on function eventos.giavisos_registrar_entrega(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function eventos.giavisos_registrar_entrega(uuid, text, text, text, text) to svc_giavisos;
