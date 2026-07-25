-- Permite cadastrar colaboradores "somente nome" (Cadastro Simples), sem
-- conta de login no Supabase Auth, para gente que ainda não usa nenhum
-- sistema (ex.: equipe de campo/produção) mas precisa aparecer na lista de
-- Gestão de Colaboradores. Quando o site de RH entrar no ar e cada um tiver
-- um e-mail real, essas linhas podem ser promovidas a contas de verdade.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column email drop not null;
alter table public.profiles add column if not exists is_placeholder boolean not null default false;

-- Diego Maeno (CEO) vira sua própria seção no topo da lista, acima de
-- todos os departamentos.
update public.profiles set department = 'Diretoria', is_department_lead = true
where email = 'diego@verticalparts.com.br';

insert into public.profiles (id, email, name, department, level, is_active, is_placeholder)
values
  (gen_random_uuid(), null, 'Aurélio Carvalho', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Juciê Santos', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Gustavo da Silva', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Marco Antonio', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Franklin Costa', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Tiago Acácio', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Nailson Cruz', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Edmilson Jesus', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Gesse Batista', 'Logística/Almoxarifado/Produção', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Silvio Elias', 'Engenharia', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Brayan Souza', 'Engenharia', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Maximira Ribeiro', 'Adm/Financeiro', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Joice Ribeiro', 'Adm/Financeiro', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Denilda Tavares', 'Gente & Gestão', 'Colaborador', true, true),
  (gen_random_uuid(), null, 'Maria Fernanda', 'Gente & Gestão', 'Colaborador', true, true);
