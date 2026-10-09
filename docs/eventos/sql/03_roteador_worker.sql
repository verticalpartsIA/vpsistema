-- Central de Eventos: roteador e worker de envio.
-- Status: TESTADO numa branch descartável do Supabase (funções, permissões e a função eventos-worker de ponta
-- a ponta, com um eco no lugar da Evolution). NÃO aplicado em produção.
-- Pré-requisitos: central_eventos.sql e 02_ingestao.sql já aplicados.
--
-- Fluxo
--   evento (recebido) --rotear_pendentes()--> envios (simulado | pendente | descartado)
--   envios pendentes  --worker (edge function eventos-worker)--> canal --> enviado | falha
--
-- Segurança de operação
--   * Gatilho em modo 'sombra' só gera envios 'simulado': NADA é enviado de verdade.
--   * Só o modo 'ativo' gera envios 'pendente' que o worker entrega.
--   * Canal desativado nunca é entregue (o envio fica 'descartado', com o motivo).
--
-- Config no Vault (SQL editor, uma vez; nunca em arquivo ou git):
--   select vault.create_secret('<token longo e aleatório>', 'eventos_worker_token');
--   -- opcional: select vault.create_secret('https://<projeto>.supabase.co/functions/v1/eventos-worker', 'eventos_worker_url');
-- Secrets da função eventos-worker (Settings > Edge Functions): EVOLUTION_API_URL, EVOLUTION_API_KEY,
-- EVOLUTION_INSTANCE (os mesmos que o portal já usa).

alter table eventos.eventos add column if not exists erro text;
alter table eventos.envios  add column if not exists reservado_em timestamptz;

create unique index if not exists destinatarios_perfil_uq on eventos.destinatarios (perfil_id) where perfil_id is not null;
create index if not exists destinatarios_email_idx on eventos.destinatarios (lower(email));
create index if not exists envios_processando_idx on eventos.envios (reservado_em) where status = 'processando';
create index if not exists tentativas_envio_idx on eventos.tentativas (envio_id, iniciada_em);

-- ─────────────────────────────────────────────────────────── Destinatários (a partir dos perfis do portal)
-- Celular: corporativo tem prioridade; pessoal só se não houver corporativo; depois o legado `celular`.
-- Só dígitos com 10 ou 11 (DDD + número). `ativo` acompanha o perfil; `aceita_whatsapp` é escolha do
-- administrador e não é sobrescrita depois da criação.
create or replace function eventos.sincronizar_destinatarios() returns int
language plpgsql security definer set search_path = eventos, public, pg_temp as $$
declare n int;
begin
  with fonte as (
    select p.id,
           coalesce(nullif(trim(p.name), ''), lower(trim(p.email)), 'sem nome') as nome,
           nullif(lower(trim(p.email)), '') as email,
           coalesce(p.is_active, false) as ativo,
           (select d from (
              select regexp_replace(coalesce(x, ''), '\D', '', 'g') as d, o
                from unnest(array[p.celular_corporativo, p.celular_pessoal, p.celular]) with ordinality as u(x, o)
            ) t where length(d) in (10, 11) order by o limit 1) as whatsapp
      from public.profiles p
     where not coalesce(p.is_placeholder, false)
  )
  insert into eventos.destinatarios as d (tipo, perfil_id, nome, whatsapp, email, ativo, aceita_whatsapp)
  select 'pessoa', f.id, f.nome, f.whatsapp, f.email, f.ativo, f.whatsapp is not null from fonte f
  on conflict (perfil_id) where perfil_id is not null do update
     set nome = excluded.nome, whatsapp = excluded.whatsapp, email = excluded.email, ativo = excluded.ativo
   where (d.nome, d.whatsapp, d.email, d.ativo) is distinct from (excluded.nome, excluded.whatsapp, excluded.email, excluded.ativo);
  get diagnostics n = row_count;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────── Texto do modelo: {{campo}} e {{a.b}}
create or replace function eventos.renderizar(p_modelo text, p_dados jsonb) returns text
language plpgsql immutable as $$
declare r text := coalesce(p_modelo, ''); m text[];
begin
  -- replace simples (não regexp_replace): o valor entra literalmente, sem interpretar \ ou &
  for m in select distinct x from regexp_matches(r, '(\{\{\s*([A-Za-z0-9_.]+)\s*\}\})', 'g') as x loop
    r := replace(r, m[1], coalesce(p_dados #>> string_to_array(m[2], '.'), ''));
  end loop;
  return left(r, 4000);
end $$;

-- ─────────────────────────────────────────────────────────── Condição da regra
-- {"campo":"valor_total","op":">=","valor":1000}  ou uma lista desses objetos (todos precisam valer).
-- Operadores: = != > >= < <= in. Campo ausente = condição falsa.
create or replace function eventos.avaliar_condicao(p_cond jsonb, p_payload jsonb) returns boolean
language plpgsql immutable as $$
declare c jsonb; atual text; esperado text; a numeric; b numeric; num boolean;
begin
  if p_cond is null or p_cond = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p_cond) = 'array' then
    for c in select * from jsonb_array_elements(p_cond) loop
      if not eventos.avaliar_condicao(c, p_payload) then return false; end if;
    end loop;
    return true;
  end if;
  atual := p_payload #>> string_to_array(p_cond->>'campo', '.');
  if atual is null then return false; end if;
  if p_cond->>'op' = 'in' then
    return exists (select 1 from jsonb_array_elements_text(p_cond->'valor') x where x = atual);
  end if;
  esperado := p_cond->>'valor';
  num := atual ~ '^-?\d+(\.\d+)?$' and esperado ~ '^-?\d+(\.\d+)?$';
  if num then a := atual::numeric; b := esperado::numeric; end if;
  return case p_cond->>'op'
    when '='  then case when num then a = b  else atual = esperado end
    when '!=' then case when num then a <> b else atual <> esperado end
    when '>'  then num and a > b
    when '>=' then num and a >= b
    when '<'  then num and a < b
    when '<=' then num and a <= b
    else false end;
end $$;

-- ─────────────────────────────────────────────────────────── Janela de envio
-- {"inicio":"07:00","fim":"18:00","dias":[1,2,3,4,5]}  (1=segunda … 7=domingo; horário de Brasília)
-- Devolve o primeiro instante a partir de p_base em que o envio é permitido.
create or replace function eventos.proxima_janela(p_janela jsonb, p_base timestamptz) returns timestamptz
language plpgsql stable as $$
declare tz constant text := 'America/Sao_Paulo';
        local_base timestamp; dia date; i int; ini time; fim time; dias int[];
        t_ini timestamptz; t_fim timestamptz;
begin
  if p_janela is null or p_janela = 'null'::jsonb then return p_base; end if;
  ini := coalesce(p_janela->>'inicio', '00:00')::time;
  fim := coalesce(p_janela->>'fim', '23:59:59')::time;
  dias := coalesce(array(select jsonb_array_elements_text(p_janela->'dias')::int), array[1,2,3,4,5,6,7]);
  local_base := p_base at time zone tz;
  for i in 0..8 loop
    dia := local_base::date + i;
    continue when not (extract(isodow from dia)::int = any (dias));
    t_ini := (dia + ini) at time zone tz;
    t_fim := (dia + fim) at time zone tz;
    if p_base < t_ini then return t_ini; end if;
    if p_base < t_fim then return p_base; end if;
  end loop;
  return p_base;  -- janela impossível (sem dias): não trava o envio
end $$;

-- ─────────────────────────────────────────────────────────── Destinatários de uma regra
-- destino: {"destinatarios":["<uuid>"], "grupos":["<slug>"], "payload_email":"<campo do payload>"}
create or replace function eventos.resolver_destinatarios(p_destino jsonb, p_payload jsonb)
returns setof eventos.destinatarios
language sql stable security definer set search_path = eventos, public, pg_temp as $$
  select distinct on (d.id) d.* from eventos.destinatarios d
   where d.ativo and (
        d.id::text in (select jsonb_array_elements_text(coalesce(p_destino->'destinatarios', '[]'::jsonb)))
     or d.id in (select gm.destinatario_id from eventos.grupo_membros gm
                   join eventos.grupos g on g.id = gm.grupo_id
                  where g.slug in (select jsonb_array_elements_text(coalesce(p_destino->'grupos', '[]'::jsonb))))
     or (p_destino ? 'payload_email'
         and lower(d.email) = lower(p_payload ->> (p_destino->>'payload_email')))
   )
$$;

-- ─────────────────────────────────────────────────────────── Roteador: eventos recebidos → envios
create or replace function eventos.rotear_pendentes(p_limite int default 100) returns int
language plpgsql security definer set search_path = eventos, public, pg_temp as $$
declare
  ev record; g record; rg record; d record; cn record; v_canal text;
  v_total int := 0; v_criados int; v_status text; v_motivo text; v_msg text; v_ag timestamptz; v_tpl record; v_dados jsonb;
begin
  for ev in
    select * from eventos.eventos where status = 'recebido' order by recebido_em limit p_limite for update skip locked
  loop
    begin
      v_criados := 0;
      select * into g from eventos.catalogo_gatilhos where origem_id = ev.origem_id and tipo = ev.tipo;
      if not found or not g.ativo or g.modo in ('legado', 'desligado') then
        update eventos.eventos set status = 'sem_regra' where id = ev.id;
        continue;
      end if;

      for rg in select * from eventos.regras where gatilho_id = g.id and ativa order by prioridade, id loop
        continue when not eventos.avaliar_condicao(rg.condicao, ev.payload);
        select * into v_tpl from eventos.templates where id = rg.template_id;

        for d in select * from eventos.resolver_destinatarios(rg.destino, ev.payload) loop
          v_dados := ev.payload || jsonb_build_object('destinatario_nome', d.nome, 'evento_tipo', ev.tipo,
                                                       'entidade_id', ev.entidade_id);
          foreach v_canal in array rg.canais loop
            select * into cn from eventos.canais where slug = v_canal;
            continue when not found;  -- canal que não existe na tabela: ignorado

            v_motivo := null;
            v_msg := case when v_tpl.id is not null then eventos.renderizar(v_tpl.corpo, v_dados) end;
            if not cn.ativo then v_motivo := 'canal_desativado';
            elsif v_tpl.id is null then v_motivo := 'sem_template';
            elsif v_canal = 'whatsapp' and (d.whatsapp is null or not d.aceita_whatsapp) then v_motivo := 'sem_contato';
            elsif v_canal = 'email' and (d.email is null or not d.aceita_email) then v_motivo := 'sem_contato';
            end if;

            v_status := case when v_motivo is not null then 'descartado'
                             when g.modo = 'sombra' then 'simulado'
                             else 'pendente' end;
            v_ag := eventos.proxima_janela(rg.janela_envio, now() + make_interval(secs => rg.atraso_segundos));

            insert into eventos.envios (evento_id, regra_id, destinatario_id, canal, status, agendado_para,
                                        mensagem_renderizada, motivo_descarte)
            values (ev.id, rg.id, d.id, v_canal, v_status, v_ag, v_msg, v_motivo)
            on conflict (evento_id, regra_id, destinatario_id, canal) do nothing;
            if found then v_criados := v_criados + 1; end if;
          end loop;
        end loop;
      end loop;

      update eventos.eventos set status = case when v_criados > 0 then 'processado' else 'sem_regra' end
       where id = ev.id;
      v_total := v_total + v_criados;
    exception when others then
      update eventos.eventos set status = 'erro', erro = left(sqlerrm, 500) where id = ev.id;
    end;
  end loop;
  return v_total;
end $$;

-- ─────────────────────────────────────────────────────────── Worker: reservar, registrar, recuperar
-- Envio "processando" há mais de 10 min: o worker caiu ou não conseguiu gravar o resultado, e a mensagem PODE ter
-- sido entregue. Para não mandar duas vezes à mesma pessoa, NÃO volta para a fila: vira falha com o motivo, e um
-- administrador decide pela aba Falhas (Reenviar). (O worker que fica sem tempo ou sem configuração usa
-- devolver_envio, que é seguro porque ainda não chamou o canal.)
create or replace function eventos.recuperar_travados() returns int
language plpgsql security definer set search_path = eventos, pg_temp as $$
declare n int;
begin
  update eventos.tentativas t set resultado = 'interrompida', erro = 'resultado incerto: worker não concluiu'
   where t.resultado = 'em_andamento' and t.iniciada_em < now() - interval '10 minutes';
  update eventos.envios e
     set status = 'falha', proxima_tentativa_em = null,
         motivo_descarte = 'resultado incerto: o worker não confirmou o envio. Confira com o destinatário antes de reenviar.'
   where e.status = 'processando' and e.reservado_em < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- Reserva um lote respeitando o limite por minuto de cada canal e a conferência final do contato.
create or replace function eventos.reservar_envios(p_limite int default 20)
returns table (envio_id uuid, canal text, tentativa int, whatsapp text, email text, nome text,
               mensagem text, intervalo_min_ms int)
language plpgsql security definer set search_path = eventos, public, pg_temp as $$
declare cn record; v_cap int; v_ids uuid[]; v_restante int := p_limite;
begin
  perform eventos.recuperar_travados();

  -- Interruptor de segurança: o que está na fila de um gatilho que deixou de ser 'ativo' (voltou para sombra,
  -- foi desligado ou desativado) NÃO é entregue. Fica 'cancelado', com o motivo.
  update eventos.envios e set status = 'cancelado', motivo_descarte = 'gatilho_nao_ativo'
    from eventos.regras rg join eventos.catalogo_gatilhos g on g.id = rg.gatilho_id
   where rg.id = e.regra_id and e.status = 'pendente' and (g.modo <> 'ativo' or not g.ativo);

  for cn in select * from eventos.canais c where c.ativo order by c.slug loop
    exit when v_restante <= 0;
    select cn.limite_por_minuto - count(*) into v_cap
      from eventos.tentativas t join eventos.envios e on e.id = t.envio_id
     where e.canal = cn.slug and t.iniciada_em > now() - interval '1 minute';
    continue when v_cap <= 0;

    -- contato que sumiu depois do roteamento: descarta em vez de tentar
    update eventos.envios e set status = 'descartado', motivo_descarte = 'sem_contato'
      from eventos.destinatarios d
     where d.id = e.destinatario_id and e.canal = cn.slug and e.status = 'pendente'
       and e.agendado_para <= now()
       and ((cn.slug = 'whatsapp' and (d.whatsapp is null or not d.aceita_whatsapp or not d.ativo))
         or (cn.slug = 'email'    and (d.email is null or not d.aceita_email or not d.ativo)));

    select array_agg(x.id) into v_ids from (
      select e.id from eventos.envios e
       where e.canal = cn.slug and e.status = 'pendente' and e.agendado_para <= now()
         and coalesce(e.proxima_tentativa_em, e.agendado_para) <= now()
         and exists (select 1 from eventos.regras rg join eventos.catalogo_gatilhos g on g.id = rg.gatilho_id
                      where rg.id = e.regra_id and g.ativo and g.modo = 'ativo')
       order by e.agendado_para, e.id
       limit least(v_cap, v_restante) for update skip locked) x;
    continue when v_ids is null;

    update eventos.envios e set status = 'processando', reservado_em = now(), tentativas = e.tentativas + 1
     where e.id = any (v_ids);
    insert into eventos.tentativas (envio_id, resultado) select unnest(v_ids), 'em_andamento';
    v_restante := v_restante - array_length(v_ids, 1);

    return query
      select e.id, e.canal, e.tentativas, d.whatsapp, d.email, d.nome, e.mensagem_renderizada, cn.intervalo_min_ms
        from eventos.envios e join eventos.destinatarios d on d.id = e.destinatario_id
       where e.id = any (v_ids) order by e.agendado_para, e.id;
  end loop;
end $$;

-- Resultado de uma tentativa. Permanente = não adianta tentar de novo. Transitório: espera 1, 5, 15 e 60
-- minutos; depois da 5ª tentativa vira falha.
create or replace function eventos.registrar_tentativa(
  p_envio uuid, p_resultado text, p_http int default null, p_erro text default null,
  p_id_externo text default null, p_permanente boolean default false
) returns text
language plpgsql security definer set search_path = eventos, pg_temp as $$
declare e record; v_status text;
begin
  select * into e from eventos.envios where id = p_envio and status = 'processando' for update;
  if not found then return 'ignorado'; end if;

  update eventos.tentativas set resultado = p_resultado, http_status = p_http, erro = left(p_erro, 500), id_externo = p_id_externo
   where id = (select t.id from eventos.tentativas t where t.envio_id = p_envio and t.resultado = 'em_andamento'
                order by t.iniciada_em desc limit 1);

  if p_resultado = 'enviado' then
    update eventos.envios set status = 'enviado', motivo_descarte = null, proxima_tentativa_em = null where id = p_envio;
    return 'enviado';
  end if;

  if p_permanente or e.tentativas >= 5 then
    v_status := 'falha';
    update eventos.envios set status = 'falha', motivo_descarte = left(coalesce(p_erro, p_resultado), 300) where id = p_envio;
  else
    v_status := 'pendente';
    update eventos.envios
       set status = 'pendente', motivo_descarte = left(coalesce(p_erro, p_resultado), 300),
           proxima_tentativa_em = now() + make_interval(mins => (array[1, 5, 15, 60])[least(e.tentativas, 4)])
     where id = p_envio;
  end if;
  return v_status;
end $$;

-- Worker sem configuração do canal: devolve à fila sem gastar tentativa.
create or replace function eventos.devolver_envio(p_envio uuid, p_motivo text) returns void
language plpgsql security definer set search_path = eventos, pg_temp as $$
begin
  update eventos.tentativas set resultado = 'devolvida', erro = left(p_motivo, 500)
   where id = (select t.id from eventos.tentativas t where t.envio_id = p_envio and t.resultado = 'em_andamento'
                order by t.iniciada_em desc limit 1);
  update eventos.envios set status = 'pendente', tentativas = greatest(tentativas - 1, 0),
         proxima_tentativa_em = now() + interval '2 minutes', motivo_descarte = left(p_motivo, 300)
   where id = p_envio and status = 'processando';
end $$;

-- A função do worker se identifica por um token guardado no Vault.
create or replace function eventos.token_worker_ok(p_token text) returns boolean
language sql stable security definer set search_path = eventos, vault, pg_temp as $$
  select coalesce(p_token <> '' and exists (
    select 1 from vault.decrypted_secrets s where s.name = 'eventos_worker_token' and s.decrypted_secret = p_token), false)
$$;

-- ─────────────────────────────────────────────────────────── Reenvio manual (tela Falhas), com auditoria
create or replace function eventos.reenviar_envio(p_envio uuid) returns boolean
language plpgsql security definer set search_path = eventos, public, pg_temp as $$
declare antes jsonb; depois jsonb;
begin
  if not eventos.is_admin() then raise exception 'apenas administrador' using errcode = '42501'; end if;
  select to_jsonb(e) into antes from eventos.envios e where e.id = p_envio and e.status in ('falha', 'descartado') for update;
  if antes is null then return false; end if;
  if not exists (select 1 from eventos.envios e join eventos.regras rg on rg.id = e.regra_id
                   join eventos.catalogo_gatilhos g on g.id = rg.gatilho_id
                  where e.id = p_envio and g.ativo and g.modo = 'ativo') then
    raise exception 'o gatilho deste envio não está ativo: ative-o no Catálogo antes de reenviar' using errcode = '55000';
  end if;

  update eventos.envios set status = 'pendente', tentativas = 0, proxima_tentativa_em = now(),
         agendado_para = now(), motivo_descarte = null where id = p_envio
  returning to_jsonb(envios.*) into depois;

  insert into eventos.auditoria (ator, acao, objeto, antes, depois)
  values (auth.uid()::text, 'REENVIO_MANUAL', 'envios:' || p_envio, antes, depois);
  return true;
end $$;

-- ─────────────────────────────────────────────────────────── Permissões
revoke all on function
  eventos.sincronizar_destinatarios(), eventos.rotear_pendentes(int), eventos.recuperar_travados(),
  eventos.reservar_envios(int), eventos.registrar_tentativa(uuid, text, int, text, text, boolean),
  eventos.devolver_envio(uuid, text), eventos.token_worker_ok(text), eventos.reenviar_envio(uuid),
  eventos.resolver_destinatarios(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function
  eventos.sincronizar_destinatarios(), eventos.rotear_pendentes(int), eventos.recuperar_travados(),
  eventos.reservar_envios(int), eventos.registrar_tentativa(uuid, text, int, text, text, boolean),
  eventos.devolver_envio(uuid, text), eventos.token_worker_ok(text), eventos.resolver_destinatarios(jsonb, jsonb)
  to service_role;
grant execute on function eventos.reenviar_envio(uuid) to authenticated;  -- a função checa is_admin()
grant update on eventos.envios to service_role;
grant insert, update on eventos.tentativas, eventos.destinatarios to service_role;

-- ─────────────────────────────────────────────────────────── Primeiro gatilho: SLA vencido (modo sombra)
-- Modelo equivalente ao aviso de WhatsApp do VP Requisições (database/035), sem as horas na etapa
-- (o evento ainda não leva esse dado). Em sombra: só gera envios 'simulado', para comparar com o legado.
do $$
declare v_gatilho uuid; v_tpl uuid;
begin
  select g.id into v_gatilho from eventos.catalogo_gatilhos g join eventos.origens o on o.id = g.origem_id
   where o.slug = 'vprequisicoes' and g.tipo = 'requisicao.sla_vencida';
  if v_gatilho is null or exists (select 1 from eventos.regras where gatilho_id = v_gatilho) then return; end if;

  insert into eventos.templates (canal, corpo)
  values ('whatsapp', E'⏰ Sua requisição *{{ticket}}* está vencida na etapa atual ({{etapa}}).\n\n{{titulo}}\n\nVale a pena acompanhar.\n\n🔗 Acompanhar: https://vprequisicoes.vpsistema.com/')
  returning id into v_tpl;

  insert into eventos.regras (gatilho_id, canais, template_id, destino, janela_envio)
  values (v_gatilho, array['whatsapp'], v_tpl, '{"payload_email":"requisitante_email"}'::jsonb,
          '{"inicio":"07:00","fim":"18:00","dias":[1,2,3,4,5]}'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────── Agendamento (só onde há pg_cron)
-- Roteador a cada minuto; sincronização de destinatários a cada 15 min; chamada do worker a cada minuto,
-- somente se houver token no Vault e algo para enviar.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron ausente: agendamento não criado';
    return;
  end if;
  perform cron.schedule('eventos-rotear', '* * * * *', $c$ select eventos.rotear_pendentes(); $c$);
  perform cron.schedule('eventos-sincronizar-destinatarios', '*/15 * * * *', $c$ select eventos.sincronizar_destinatarios(); $c$);
  perform cron.schedule('eventos-worker', '* * * * *', $c$
    select net.http_post(
      url := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'eventos_worker_url'),
                      'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/eventos-worker'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                  'x-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'eventos_worker_token')),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from vault.decrypted_secrets where name = 'eventos_worker_token')
      and exists (select 1 from eventos.envios where status in ('pendente', 'processando') and agendado_para <= now());
  $c$);
end $$;
