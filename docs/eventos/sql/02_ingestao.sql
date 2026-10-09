-- Central de Eventos: apoio à função de ingestão (eventos-ingest).
-- Status: aplicado e testado na branch `central-eventos`. NÃO aplicado em produção.
-- Pré-requisito: central_eventos.sql (schema `eventos`) e a extensão Vault (supabase_vault).

alter table eventos.origens add column if not exists limite_por_minuto int not null default 300;
create index if not exists eventos_origem_recebido_idx on eventos.eventos (origem_id, recebido_em);

-- A função de ingestão roda com service_role: precisa de acesso explícito ao schema.
grant usage on schema eventos to service_role;
grant select, insert, update on all tables in schema eventos to service_role;

-- Segredo HMAC por origem, guardado no Vault com o nome eventos_hmac_<slug>.
-- Cadastro (feito por um administrador, no SQL editor, nunca no código):
--   select vault.create_secret('<segredo-longo-e-aleatório>', 'eventos_hmac_vprequisicoes');
-- Rotação: vault.update_secret(<id>, '<novo segredo>').
create or replace function eventos.segredo_origem(p_slug text)
returns table (origem_id uuid, ativo boolean, segredo text, limite int)
language sql stable security definer set search_path = eventos, vault, pg_temp as $$
  select o.id, o.ativo, s.decrypted_secret, o.limite_por_minuto
  from eventos.origens o
  left join vault.decrypted_secrets s on s.name = 'eventos_hmac_' || o.slug
  where o.slug = p_slug
$$;

create or replace function eventos.gatilho_origem(p_origem uuid, p_tipo text)
returns table (schema_payload jsonb, modo text)
language sql stable security definer set search_path = eventos, pg_temp as $$
  select g.schema_payload, g.modo from eventos.catalogo_gatilhos g
  where g.origem_id = p_origem and g.tipo = p_tipo
$$;

-- Grava o evento com idempotência e limite por minuto. Resultado: criado | duplicado | limite.
create or replace function eventos.registrar_evento(
  p_origem uuid, p_limite int, p_tipo text, p_key text, p_ocorrido timestamptz,
  p_ator jsonb, p_ent_tipo text, p_ent_id text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = eventos, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from eventos.eventos where origem_id = p_origem and idempotency_key = p_key;
  if v_id is not null then
    return jsonb_build_object('resultado', 'duplicado', 'evento_id', v_id);
  end if;

  if (select count(*) from eventos.eventos where origem_id = p_origem and recebido_em > now() - interval '1 minute') >= p_limite then
    return jsonb_build_object('resultado', 'limite');
  end if;

  insert into eventos.eventos (origem_id, tipo, idempotency_key, ocorrido_em, ator, entidade_tipo, entidade_id, payload)
  values (p_origem, p_tipo, p_key, p_ocorrido, p_ator, p_ent_tipo, p_ent_id, coalesce(p_payload, '{}'))
  on conflict (origem_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then  -- corrida: outro pedido idêntico gravou no meio tempo
    select id into v_id from eventos.eventos where origem_id = p_origem and idempotency_key = p_key;
    return jsonb_build_object('resultado', 'duplicado', 'evento_id', v_id);
  end if;
  return jsonb_build_object('resultado', 'criado', 'evento_id', v_id);
end $$;

revoke all on function eventos.segredo_origem(text), eventos.gatilho_origem(uuid, text),
  eventos.registrar_evento(uuid, int, text, text, timestamptz, jsonb, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function eventos.segredo_origem(text), eventos.gatilho_origem(uuid, text),
  eventos.registrar_evento(uuid, int, text, text, timestamptz, jsonb, text, text, jsonb)
  to service_role;
