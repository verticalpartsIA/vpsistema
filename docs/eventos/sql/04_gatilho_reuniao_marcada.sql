-- 04 — Gatilho "reunião marcada" do VP Click no catálogo da Central de Eventos.
-- Em sombra: o VP Click ainda não publica este evento, então nada muda até ele começar a publicar
-- (e mesmo então só simula, até alguém ativar o gatilho). Idempotente.
insert into eventos.catalogo_gatilhos (origem_id, tipo, descricao, ativo, modo, legado_ref)
select o.id, 'reuniao.marcada', 'Reunião marcada', true, 'sombra', 'Ainda não publica na Central'
  from eventos.origens o
 where o.slug = 'vpclick'
on conflict (origem_id, tipo) do nothing;
