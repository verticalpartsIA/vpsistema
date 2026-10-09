-- VPRequisições: "Ciência do gestor" no catálogo de alçadas (Gelson, 09/10/2026).
-- Gestores (ex.: Danilo, Gelson, Karla, Bianca, Juliana, Regiane) dão ciência
-- no que o time requisita. Alcance: só os liderados (profiles.approver_id no
-- VPRequisições), o departamento inteiro (department_managers) ou todos.
-- Escolha única, como o nível de aprovação.

insert into public.catalog_modules (system_slug, module_key, label, group_label, sort_order) values
  ('vprequisicoes', 'ciencia', 'Ciência do gestor', 'Fluxo de compras', 7)
on conflict (system_slug, module_key) do update set label = excluded.label, group_label = excluded.group_label, sort_order = excluded.sort_order;

update public.catalog_modules set sort_order = 8 where system_slug = 'vprequisicoes' and module_key = 'etapas';
update public.catalog_modules set sort_order = 9 where system_slug = 'vprequisicoes' and module_key = 'aprovacao';

insert into public.catalog_actions (system_slug, module_key, action_key, label, choice_group, sort_order) values
  ('vprequisicoes', 'ciencia', 'ciencia_liderados',    'Dá ciência das requisições dos seus liderados',   'alcance_ciencia', 0),
  ('vprequisicoes', 'ciencia', 'ciencia_departamento', 'Dá ciência das requisições do departamento',      'alcance_ciencia', 1),
  ('vprequisicoes', 'ciencia', 'ciencia_todos',        'Dá ciência das requisições de todos',             'alcance_ciencia', 2)
on conflict (system_slug, module_key, action_key) do update set label = excluded.label, choice_group = excluded.choice_group, sort_order = excluded.sort_order;
