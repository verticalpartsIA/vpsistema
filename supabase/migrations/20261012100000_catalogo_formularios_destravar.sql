-- VP HUB: ação "Destrava formulário/cotação" no catálogo de alçadas (Gelson, 12/10/2026).
-- A trava nova de Formulários / Cotações precisa de quem destrave; a chave
-- 'destravar' é a MESMA que o HUB vai ler em `alcadas_capacidade`.
-- Só cadastra a ação: ninguém recebe a alçada por esta migration (concessão
-- é feita em vpsistema.com/administracao).

insert into public.catalog_actions (system_slug, module_key, action_key, label, choice_group, sort_order) values
  ('cotacao-importacao', 'formularios', 'destravar', 'Destrava formulário/cotação travado', null, 5)
on conflict (system_slug, module_key, action_key) do update set label = excluded.label, choice_group = excluded.choice_group, sort_order = excluded.sort_order;
