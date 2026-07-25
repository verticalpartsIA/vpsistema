-- Marca o chefe de cada departamento para a listagem agrupada de
-- colaboradores (Gestão de Colaboradores) exibir o líder primeiro em cada
-- seção de departamento.
alter table public.profiles
  add column if not exists is_department_lead boolean not null default false;

update public.profiles set is_department_lead = true
where email in (
  'marcus.braz@verticalparts.com.br',      -- Comercial
  'giovanna@verticalparts.com.br',          -- Marketing
  'juliana@verticalparts.com.br',           -- Adm/Financeiro
  'karla.silva@verticalparts.com.br',       -- Gente & Gestão
  'arilene.avila@verticalparts.com.br',     -- Engenharia
  'danilo@verticalparts.com.br',            -- Logística/Almoxarifado/Produção
  'bianca@verticalparts.com.br'             -- Jurídico/Importação/Suprimentos
);
