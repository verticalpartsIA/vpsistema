-- Árvore de alçadas — 2ª camada: CATÁLOGO por sistema + alçadas por pessoa.
-- Decisões do Gelson (09/10/2026): VP HUB é o piloto; o VPRequisições entra
-- junto no catálogo; só PLENOS veem tudo (sem atalho de Administrador);
-- Inbox/Formulários do HUB começam fechados.
--
--   👤 pessoa → 🧩 sistema (modules) → ▸ módulo (catalog_modules)
--            → ☐ ações (catalog_actions; choice_group = escolha única, ex.: nível de aprovação)
--            → 💲 etiquetas de valor (catalog_value_tags) — exceções ao interruptor de valores do topo
--
-- O catálogo do HUB foi semeado do próprio HUB (CATALOGO_MODULOS); as chaves
-- de módulo/ação são as MESMAS que o HUB já lê em `alcadas_capacidade`, para
-- o vpsistema poder alimentá-lo sem tradução.

create table if not exists public.catalog_modules (
  system_slug text not null references public.modules(slug) on update cascade on delete cascade,
  module_key  text not null,
  label       text not null,
  group_label text not null,
  sort_order  int  not null default 0,
  primary key (system_slug, module_key)
);

create table if not exists public.catalog_actions (
  system_slug  text not null,
  module_key   text not null,
  action_key   text not null,
  label        text not null,
  choice_group text,            -- ações do mesmo grupo são escolha única (radio)
  sort_order   int  not null default 0,
  primary key (system_slug, module_key, action_key),
  foreign key (system_slug, module_key) references public.catalog_modules (system_slug, module_key) on update cascade on delete cascade
);

create table if not exists public.catalog_value_tags (
  system_slug text not null,
  module_key  text not null,
  tag_key     text not null,
  label       text not null,
  sort_order  int  not null default 0,
  primary key (system_slug, module_key, tag_key),
  foreign key (system_slug, module_key) references public.catalog_modules (system_slug, module_key) on update cascade on delete cascade
);

-- Alçadas concedidas (o que a pessoa PODE fazer dentro do sistema)
create table if not exists public.user_grants (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  system_slug text not null,
  module_key  text not null,
  action_key  text not null,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, system_slug, module_key, action_key),
  foreign key (system_slug, module_key, action_key) references public.catalog_actions (system_slug, module_key, action_key) on update cascade on delete cascade
);

-- Exceções de valor R$: allow = true libera para quem está 🔒 (ex.: Andreia vê
-- só "valores da P.I."); allow = false bloqueia para quem está 🔓.
create table if not exists public.user_value_exceptions (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  system_slug text not null,
  module_key  text not null,
  tag_key     text not null,
  allow       boolean not null,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, system_slug, module_key, tag_key),
  foreign key (system_slug, module_key, tag_key) references public.catalog_value_tags (system_slug, module_key, tag_key) on update cascade on delete cascade
);

-- Escolha única dentro de um choice_group (ex.: um só nível de aprovação)
create or replace function public.enforce_single_choice_grant()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  grp text;
begin
  select choice_group into grp from public.catalog_actions
  where system_slug = new.system_slug and module_key = new.module_key and action_key = new.action_key;
  if grp is not null then
    delete from public.user_grants g
    using public.catalog_actions a
    where g.user_id = new.user_id and g.system_slug = new.system_slug and g.module_key = new.module_key
      and a.system_slug = g.system_slug and a.module_key = g.module_key and a.action_key = g.action_key
      and a.choice_group = grp and g.action_key <> new.action_key;
  end if;
  return new;
end;
$$;

-- Mesmas regras de poder do resto da árvore (can_grant_powers_to): Plenos
-- tudo; Médios só em quem está abaixo e nunca em si; Baixos não dão alçadas.
create or replace function public.enforce_grant_powers()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  if not public.can_grant_powers_to(target) then
    if target = auth.uid() then
      raise exception 'Você não pode alterar suas próprias alçadas.';
    end if;
    raise exception 'Você não tem alçada para alterar as alçadas desta pessoa.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_grant_powers on public.user_grants;
create trigger trg_enforce_grant_powers
before insert or update or delete on public.user_grants
for each row execute function public.enforce_grant_powers();

drop trigger if exists trg_single_choice_grant on public.user_grants;
create trigger trg_single_choice_grant
after insert on public.user_grants
for each row execute function public.enforce_single_choice_grant();

drop trigger if exists trg_enforce_value_exception_powers on public.user_value_exceptions;
create trigger trg_enforce_value_exception_powers
before insert or update or delete on public.user_value_exceptions
for each row execute function public.enforce_grant_powers();

-- RLS: catálogo é leitura para todos os logados; alçadas: a própria pessoa
-- lê as suas (os sistemas vão consultar), quem tem poder lê e grava (trigger confere).
alter table public.catalog_modules       enable row level security;
alter table public.catalog_actions       enable row level security;
alter table public.catalog_value_tags    enable row level security;
alter table public.user_grants           enable row level security;
alter table public.user_value_exceptions enable row level security;

drop policy if exists catalog_modules_read on public.catalog_modules;
create policy catalog_modules_read on public.catalog_modules for select to authenticated using (true);
drop policy if exists catalog_actions_read on public.catalog_actions;
create policy catalog_actions_read on public.catalog_actions for select to authenticated using (true);
drop policy if exists catalog_value_tags_read on public.catalog_value_tags;
create policy catalog_value_tags_read on public.catalog_value_tags for select to authenticated using (true);

drop policy if exists user_grants_read on public.user_grants;
create policy user_grants_read on public.user_grants for select to authenticated
  using (user_id = auth.uid() or public.get_my_power() is not null);
drop policy if exists user_grants_write on public.user_grants;
create policy user_grants_write on public.user_grants for all to authenticated
  using (public.get_my_power() is not null) with check (public.get_my_power() is not null);

drop policy if exists user_value_exceptions_read on public.user_value_exceptions;
create policy user_value_exceptions_read on public.user_value_exceptions for select to authenticated
  using (user_id = auth.uid() or public.get_my_power() is not null);
drop policy if exists user_value_exceptions_write on public.user_value_exceptions;
create policy user_value_exceptions_write on public.user_value_exceptions for all to authenticated
  using (public.get_my_power() is not null) with check (public.get_my_power() is not null);

grant select on public.catalog_modules, public.catalog_actions, public.catalog_value_tags to authenticated;
grant select, insert, update, delete on public.user_grants, public.user_value_exceptions to authenticated;

-- ── Semente do catálogo (gerada por catalogo/gerar.py) ─────────────────────
insert into public.catalog_modules (system_slug, module_key, label, group_label, sort_order) values
  ('cotacao-importacao','dashboard','Dashboard','Geral',0),
  ('cotacao-importacao','notificacoes','Notificações','Geral',1),
  ('cotacao-importacao','decisoes','Central de Decisões','Geral',2),
  ('cotacao-importacao','financeiro','Prazos & Pendências','Geral',3),
  ('cotacao-importacao','inbox','Inbox','Geral',4),
  ('cotacao-importacao','leads','Leads','CRM',5),
  ('cotacao-importacao','cadastro-clientes','Clientes','Cadastros Mestres',6),
  ('cotacao-importacao','cadastro-fornecedores','Fornecedores','Cadastros Mestres',7),
  ('cotacao-importacao','cadastro-materias-primas','Matérias-Primas','Cadastros Mestres',8),
  ('cotacao-importacao','cadastro-produtos','Produtos','Cadastros Mestres',9),
  ('cotacao-importacao','formularios','Formulários / Cotações','Comercial | Pré-venda',10),
  ('cotacao-importacao','controle-cotacoes','Controle de Cotações','Comercial | Pré-venda',11),
  ('cotacao-importacao','cotacoes-fornecedor','Cotações a Fornecedor','Comercial | Pré-venda',12),
  ('cotacao-importacao','propostas','Propostas','Comercial | Pré-venda',13),
  ('cotacao-importacao','contratos-sociais','Contratos Social','Comercial | Pré-venda',14),
  ('cotacao-importacao','cadastro-custos','Atualização de Custos','Financeiro & Preços',15),
  ('cotacao-importacao','precificacao','Precificação','Financeiro & Preços',16),
  ('cotacao-importacao','aval-financeiro','Aval Financeiro','Financeiro & Preços',17),
  ('cotacao-importacao','emissao-nf','Emissão de NF','Financeiro & Preços',18),
  ('cotacao-importacao','contrato-venda-equipamentos','Contrato Venda de Equipamentos','Contratos & Jurídico',19),
  ('cotacao-importacao','aval-juridico','Aval Jurídico','Contratos & Jurídico',20),
  ('cotacao-importacao','juridico','Contratos & Minutas','Contratos & Jurídico',21),
  ('cotacao-importacao','importacao','Importação','Suprimentos & Importação',22),
  ('cotacao-importacao','gi-painel','Painel (Gestão Importação)','Suprimentos & Importação',23),
  ('cotacao-importacao','pi-importacao','P.I. (Proforma Invoice)','Suprimentos & Importação',24),
  ('cotacao-importacao','rfq-importacao','RFQ','Suprimentos & Importação',25),
  ('cotacao-importacao','ims-importacao','IMS','Suprimentos & Importação',26),
  ('cotacao-importacao','embarques-importacao','Embarques','Suprimentos & Importação',27),
  ('cotacao-importacao','gi-analise-precos','Análise de Preços','Suprimentos & Importação',28),
  ('cotacao-importacao','compras','Importação Varejo','Suprimentos & Importação',29),
  ('cotacao-importacao','pedidos-acompanhamento','Pedidos','Suprimentos & Importação',30),
  ('cotacao-importacao','engenharia','Engenharia','Engenharia & Produto',31),
  ('cotacao-importacao','eng-projeto-elevadores','Projeto de Elevadores','Engenharia & Produto',32),
  ('cotacao-importacao','eng-configurador','Projeto de Equipamento','Engenharia & Produto',33),
  ('cotacao-importacao','desenho-tecnico','Projetos ER/Es','Engenharia & Produto',34),
  ('cotacao-importacao','solicitacoes-produto','Solicitações de Produto','Engenharia & Produto',35),
  ('cotacao-importacao','ficha-tecnica','Ficha Técnica','Engenharia & Produto',36),
  ('cotacao-importacao','ncm-catalogo','Catálogo Siscomex / NCM','Engenharia & Produto',37),
  ('cotacao-importacao','linha-do-tempo','Linha do Tempo da Cotação','Engenharia & Produto',38),
  ('cotacao-importacao','status-obras','Status de Obras','Obras & Instalação',39),
  ('cotacao-importacao','vistorias','Vistorias de Obras','Obras & Instalação',40),
  ('cotacao-importacao','instalacao','Instalação em Campo','Obras & Instalação',41),
  ('cotacao-importacao','cronograma','Cronograma','Obras & Instalação',42),
  ('cotacao-importacao','art','ART','Obras & Instalação',43),
  ('cotacao-importacao','databook','Data Book & Termo','Entrega & Documentação',44),
  ('cotacao-importacao','handover','Entrega Final','Entrega & Documentação',45),
  ('cotacao-importacao','cadastro-instaladores','Empresas Instaladoras','Parceiros & Instaladores',46),
  ('cotacao-importacao','rh-homologacao','Homologação de Instaladores','Parceiros & Instaladores',47),
  ('cotacao-importacao','contrato-instalador','Contrato Instalador','Parceiros & Instaladores',48),
  ('cotacao-importacao','almoxarifado','Almoxarifado','Logística Interna',49),
  ('cotacao-importacao','carga-maquina','Carga Máquina','Logística Interna',50),
  ('cotacao-importacao','montagem-produto','Montagem do Produto','Logística Interna',51),
  ('cotacao-importacao','simulacao-producao','Simulação','Logística Interna',52),
  ('cotacao-importacao','pcp','PCP','Logística Interna',53),
  ('cotacao-importacao','mes','MES — Execução da Manufatura','Logística Interna',54),
  ('cotacao-importacao','mes-cadastros','Cadastros do MES','Logística Interna',55),
  ('cotacao-importacao','relatorios-pcp','Relatórios do PCP','Logística Interna',56),
  ('cotacao-importacao','expedicao','Expedição','Logística Interna',57),
  ('cotacao-importacao','logs','Logs de Atividade','Administração',58),
  ('vprequisicoes','m1-produtos','M1 Produtos','Requisições',0),
  ('vprequisicoes','m2-viagens','M2 Viagens','Requisições',1),
  ('vprequisicoes','m3-servicos','M3 Serviços','Requisições',2),
  ('vprequisicoes','m4-manutencao','M4 Manutenção','Requisições',3),
  ('vprequisicoes','m5-frete','M5 Frete','Requisições',4),
  ('vprequisicoes','m6-locacao','M6 Locação','Requisições',5),
  ('vprequisicoes','m7-quadro-comando','M7 Quadro de Comando','Requisições',6),
  ('vprequisicoes','etapas','Etapas do fluxo','Fluxo de compras',7),
  ('vprequisicoes','aprovacao','Aprovação por valor','Fluxo de compras',8)
on conflict (system_slug, module_key) do update set label = excluded.label, group_label = excluded.group_label, sort_order = excluded.sort_order;

insert into public.catalog_actions (system_slug, module_key, action_key, label, choice_group, sort_order) values
  ('cotacao-importacao','dashboard','ver','Ver',null,0),
  ('cotacao-importacao','dashboard','criar','Criar',null,1),
  ('cotacao-importacao','dashboard','editar','Editar',null,2),
  ('cotacao-importacao','dashboard','excluir','Excluir',null,3),
  ('cotacao-importacao','notificacoes','ver','Ver',null,0),
  ('cotacao-importacao','notificacoes','criar','Criar',null,1),
  ('cotacao-importacao','notificacoes','editar','Editar',null,2),
  ('cotacao-importacao','notificacoes','excluir','Excluir',null,3),
  ('cotacao-importacao','decisoes','ver','Ver',null,0),
  ('cotacao-importacao','decisoes','criar','Criar',null,1),
  ('cotacao-importacao','decisoes','editar','Editar',null,2),
  ('cotacao-importacao','decisoes','excluir','Excluir',null,3),
  ('cotacao-importacao','decisoes','ceo','Decide como CEO',null,4),
  ('cotacao-importacao','decisoes','gestor_comercial','Decide como Gestor Comercial',null,5),
  ('cotacao-importacao','financeiro','ver','Ver',null,0),
  ('cotacao-importacao','financeiro','criar','Criar',null,1),
  ('cotacao-importacao','financeiro','editar','Editar',null,2),
  ('cotacao-importacao','financeiro','excluir','Excluir',null,3),
  ('cotacao-importacao','inbox','ver','Ver',null,0),
  ('cotacao-importacao','inbox','criar','Criar',null,1),
  ('cotacao-importacao','inbox','editar','Editar',null,2),
  ('cotacao-importacao','inbox','excluir','Excluir',null,3),
  ('cotacao-importacao','inbox','ver_todos','Vê os e-mails de todos (CEO/administração)',null,4),
  ('cotacao-importacao','inbox','ver_equipe','Vê os e-mails de quem responde a ele (equipe)',null,5),
  ('cotacao-importacao','inbox','ver_departamento','Vê os e-mails do próprio departamento',null,6),
  ('cotacao-importacao','inbox','ver_area_comercial','Vê e-mails da área Comercial',null,7),
  ('cotacao-importacao','inbox','ver_area_financeiro','Vê e-mails da área Adm/Financeiro',null,8),
  ('cotacao-importacao','inbox','ver_area_engenharia','Vê e-mails da área Engenharia',null,9),
  ('cotacao-importacao','inbox','ver_area_logistica','Vê e-mails da área Logística/Almoxarifado/Produção',null,10),
  ('cotacao-importacao','inbox','ver_area_juridico_importacao','Vê e-mails da área Jurídico/Importação/Suprimentos',null,11),
  ('cotacao-importacao','inbox','ver_area_gente_gestao','Vê e-mails da área Gente & Gestão',null,12),
  ('cotacao-importacao','inbox','ver_area_marketing','Vê e-mails da área Marketing',null,13),
  ('cotacao-importacao','inbox','triagem','Recebe os e-mails sem dono (triagem)',null,14),
  ('cotacao-importacao','inbox','excluir_de_outros','Exclui e-mails de outras pessoas',null,15),
  ('cotacao-importacao','leads','ver','Ver',null,0),
  ('cotacao-importacao','leads','criar','Criar',null,1),
  ('cotacao-importacao','leads','editar','Editar',null,2),
  ('cotacao-importacao','leads','excluir','Excluir',null,3),
  ('cotacao-importacao','cadastro-clientes','ver','Ver',null,0),
  ('cotacao-importacao','cadastro-clientes','criar','Criar',null,1),
  ('cotacao-importacao','cadastro-clientes','editar','Editar',null,2),
  ('cotacao-importacao','cadastro-clientes','excluir','Excluir',null,3),
  ('cotacao-importacao','cadastro-fornecedores','ver','Ver',null,0),
  ('cotacao-importacao','cadastro-fornecedores','criar','Criar',null,1),
  ('cotacao-importacao','cadastro-fornecedores','editar','Editar',null,2),
  ('cotacao-importacao','cadastro-fornecedores','excluir','Excluir',null,3),
  ('cotacao-importacao','cadastro-materias-primas','ver','Ver',null,0),
  ('cotacao-importacao','cadastro-materias-primas','criar','Criar',null,1),
  ('cotacao-importacao','cadastro-materias-primas','editar','Editar',null,2),
  ('cotacao-importacao','cadastro-materias-primas','excluir','Excluir',null,3),
  ('cotacao-importacao','cadastro-produtos','ver','Ver',null,0),
  ('cotacao-importacao','cadastro-produtos','criar','Criar',null,1),
  ('cotacao-importacao','cadastro-produtos','editar','Editar',null,2),
  ('cotacao-importacao','cadastro-produtos','excluir','Excluir',null,3),
  ('cotacao-importacao','formularios','ver','Ver',null,0),
  ('cotacao-importacao','formularios','criar','Criar',null,1),
  ('cotacao-importacao','formularios','editar','Editar',null,2),
  ('cotacao-importacao','formularios','excluir','Excluir',null,3),
  ('cotacao-importacao','formularios','ver_de_outros','Vê e edita formulários/cotações de outros vendedores',null,4),
  ('cotacao-importacao','controle-cotacoes','ver','Ver',null,0),
  ('cotacao-importacao','controle-cotacoes','criar','Criar',null,1),
  ('cotacao-importacao','controle-cotacoes','editar','Editar',null,2),
  ('cotacao-importacao','controle-cotacoes','excluir','Excluir',null,3),
  ('cotacao-importacao','cotacoes-fornecedor','ver','Ver',null,0),
  ('cotacao-importacao','cotacoes-fornecedor','criar','Criar',null,1),
  ('cotacao-importacao','cotacoes-fornecedor','editar','Editar',null,2),
  ('cotacao-importacao','cotacoes-fornecedor','excluir','Excluir',null,3),
  ('cotacao-importacao','propostas','ver_todas','Vê propostas de outros vendedores',null,0),
  ('cotacao-importacao','propostas','precificar_manual','Precifica manualmente',null,1),
  ('cotacao-importacao','propostas','destravar_aprovada','Destrava proposta aprovada',null,2),
  ('cotacao-importacao','propostas','excluir','Exclui propostas',null,3),
  ('cotacao-importacao','contratos-sociais','ver','Ver',null,0),
  ('cotacao-importacao','contratos-sociais','criar','Criar',null,1),
  ('cotacao-importacao','contratos-sociais','editar','Editar',null,2),
  ('cotacao-importacao','contratos-sociais','excluir','Excluir',null,3),
  ('cotacao-importacao','cadastro-custos','ver','Ver',null,0),
  ('cotacao-importacao','cadastro-custos','criar','Criar',null,1),
  ('cotacao-importacao','cadastro-custos','editar','Editar',null,2),
  ('cotacao-importacao','cadastro-custos','excluir','Excluir',null,3),
  ('cotacao-importacao','precificacao','ver','Ver',null,0),
  ('cotacao-importacao','precificacao','criar','Criar',null,1),
  ('cotacao-importacao','precificacao','editar','Editar',null,2),
  ('cotacao-importacao','precificacao','excluir','Excluir',null,3),
  ('cotacao-importacao','aval-financeiro','ver','Ver',null,0),
  ('cotacao-importacao','aval-financeiro','criar','Criar',null,1),
  ('cotacao-importacao','aval-financeiro','editar','Editar',null,2),
  ('cotacao-importacao','aval-financeiro','excluir','Excluir',null,3),
  ('cotacao-importacao','emissao-nf','ver','Ver',null,0),
  ('cotacao-importacao','emissao-nf','criar','Criar',null,1),
  ('cotacao-importacao','emissao-nf','editar','Editar',null,2),
  ('cotacao-importacao','emissao-nf','excluir','Excluir',null,3),
  ('cotacao-importacao','contrato-venda-equipamentos','ver','Ver',null,0),
  ('cotacao-importacao','contrato-venda-equipamentos','criar','Criar',null,1),
  ('cotacao-importacao','contrato-venda-equipamentos','editar','Editar',null,2),
  ('cotacao-importacao','contrato-venda-equipamentos','excluir','Excluir',null,3),
  ('cotacao-importacao','aval-juridico','ver','Ver',null,0),
  ('cotacao-importacao','aval-juridico','criar','Criar',null,1),
  ('cotacao-importacao','aval-juridico','editar','Editar',null,2),
  ('cotacao-importacao','aval-juridico','excluir','Excluir',null,3),
  ('cotacao-importacao','juridico','ver','Ver',null,0),
  ('cotacao-importacao','juridico','criar','Criar',null,1),
  ('cotacao-importacao','juridico','editar','Editar',null,2),
  ('cotacao-importacao','juridico','excluir','Excluir',null,3),
  ('cotacao-importacao','importacao','ver','Ver',null,0),
  ('cotacao-importacao','importacao','criar','Criar',null,1),
  ('cotacao-importacao','importacao','editar','Editar',null,2),
  ('cotacao-importacao','importacao','excluir','Excluir',null,3),
  ('cotacao-importacao','gi-painel','ver','Ver',null,0),
  ('cotacao-importacao','gi-painel','criar','Criar',null,1),
  ('cotacao-importacao','gi-painel','editar','Editar',null,2),
  ('cotacao-importacao','gi-painel','excluir','Excluir',null,3),
  ('cotacao-importacao','pi-importacao','ver','Ver',null,0),
  ('cotacao-importacao','pi-importacao','criar','Criar',null,1),
  ('cotacao-importacao','pi-importacao','editar','Editar',null,2),
  ('cotacao-importacao','pi-importacao','excluir','Excluir',null,3),
  ('cotacao-importacao','rfq-importacao','ver','Ver',null,0),
  ('cotacao-importacao','rfq-importacao','criar','Criar',null,1),
  ('cotacao-importacao','rfq-importacao','editar','Editar',null,2),
  ('cotacao-importacao','rfq-importacao','excluir','Excluir',null,3),
  ('cotacao-importacao','ims-importacao','ver','Ver',null,0),
  ('cotacao-importacao','ims-importacao','criar','Criar',null,1),
  ('cotacao-importacao','ims-importacao','editar','Editar',null,2),
  ('cotacao-importacao','ims-importacao','excluir','Excluir',null,3),
  ('cotacao-importacao','embarques-importacao','ver','Ver',null,0),
  ('cotacao-importacao','embarques-importacao','criar','Criar',null,1),
  ('cotacao-importacao','embarques-importacao','editar','Editar',null,2),
  ('cotacao-importacao','embarques-importacao','excluir','Excluir',null,3),
  ('cotacao-importacao','gi-analise-precos','ver','Ver',null,0),
  ('cotacao-importacao','gi-analise-precos','criar','Criar',null,1),
  ('cotacao-importacao','gi-analise-precos','editar','Editar',null,2),
  ('cotacao-importacao','gi-analise-precos','excluir','Excluir',null,3),
  ('cotacao-importacao','compras','ver','Ver',null,0),
  ('cotacao-importacao','compras','criar','Criar',null,1),
  ('cotacao-importacao','compras','editar','Editar',null,2),
  ('cotacao-importacao','compras','excluir','Excluir',null,3),
  ('cotacao-importacao','pedidos-acompanhamento','ver','Ver',null,0),
  ('cotacao-importacao','pedidos-acompanhamento','criar','Criar',null,1),
  ('cotacao-importacao','pedidos-acompanhamento','editar','Editar',null,2),
  ('cotacao-importacao','pedidos-acompanhamento','excluir','Excluir',null,3),
  ('cotacao-importacao','engenharia','ver','Ver',null,0),
  ('cotacao-importacao','engenharia','criar','Criar',null,1),
  ('cotacao-importacao','engenharia','editar','Editar',null,2),
  ('cotacao-importacao','engenharia','excluir','Excluir',null,3),
  ('cotacao-importacao','eng-projeto-elevadores','ver','Ver',null,0),
  ('cotacao-importacao','eng-projeto-elevadores','criar','Criar',null,1),
  ('cotacao-importacao','eng-projeto-elevadores','editar','Editar',null,2),
  ('cotacao-importacao','eng-projeto-elevadores','excluir','Excluir',null,3),
  ('cotacao-importacao','eng-configurador','ver','Ver',null,0),
  ('cotacao-importacao','eng-configurador','criar','Criar',null,1),
  ('cotacao-importacao','eng-configurador','editar','Editar',null,2),
  ('cotacao-importacao','eng-configurador','excluir','Excluir',null,3),
  ('cotacao-importacao','desenho-tecnico','ver','Ver',null,0),
  ('cotacao-importacao','desenho-tecnico','criar','Criar',null,1),
  ('cotacao-importacao','desenho-tecnico','editar','Editar',null,2),
  ('cotacao-importacao','desenho-tecnico','excluir','Excluir',null,3),
  ('cotacao-importacao','solicitacoes-produto','ver','Ver',null,0),
  ('cotacao-importacao','solicitacoes-produto','criar','Criar',null,1),
  ('cotacao-importacao','solicitacoes-produto','editar','Editar',null,2),
  ('cotacao-importacao','solicitacoes-produto','excluir','Excluir',null,3),
  ('cotacao-importacao','ficha-tecnica','ver','Ver',null,0),
  ('cotacao-importacao','ficha-tecnica','criar','Criar',null,1),
  ('cotacao-importacao','ficha-tecnica','editar','Editar',null,2),
  ('cotacao-importacao','ficha-tecnica','excluir','Excluir',null,3),
  ('cotacao-importacao','ficha-tecnica','publicar_omie','Publica (ou republica) a ficha no Omie',null,4),
  ('cotacao-importacao','ncm-catalogo','ver','Ver',null,0),
  ('cotacao-importacao','ncm-catalogo','criar','Criar',null,1),
  ('cotacao-importacao','ncm-catalogo','editar','Editar',null,2),
  ('cotacao-importacao','ncm-catalogo','excluir','Excluir',null,3),
  ('cotacao-importacao','linha-do-tempo','ver','Ver',null,0),
  ('cotacao-importacao','linha-do-tempo','criar','Criar',null,1),
  ('cotacao-importacao','linha-do-tempo','editar','Editar',null,2),
  ('cotacao-importacao','linha-do-tempo','excluir','Excluir',null,3),
  ('cotacao-importacao','status-obras','ver','Ver',null,0),
  ('cotacao-importacao','status-obras','criar','Criar',null,1),
  ('cotacao-importacao','status-obras','editar','Editar',null,2),
  ('cotacao-importacao','status-obras','excluir','Excluir',null,3),
  ('cotacao-importacao','vistorias','ver','Ver',null,0),
  ('cotacao-importacao','vistorias','criar','Criar',null,1),
  ('cotacao-importacao','vistorias','editar','Editar',null,2),
  ('cotacao-importacao','vistorias','excluir','Excluir',null,3),
  ('cotacao-importacao','instalacao','ver','Ver',null,0),
  ('cotacao-importacao','instalacao','criar','Criar',null,1),
  ('cotacao-importacao','instalacao','editar','Editar',null,2),
  ('cotacao-importacao','instalacao','excluir','Excluir',null,3),
  ('cotacao-importacao','cronograma','ver','Ver',null,0),
  ('cotacao-importacao','cronograma','criar','Criar',null,1),
  ('cotacao-importacao','cronograma','editar','Editar',null,2),
  ('cotacao-importacao','cronograma','excluir','Excluir',null,3),
  ('cotacao-importacao','art','ver','Ver',null,0),
  ('cotacao-importacao','art','criar','Criar',null,1),
  ('cotacao-importacao','art','editar','Editar',null,2),
  ('cotacao-importacao','art','excluir','Excluir',null,3),
  ('cotacao-importacao','databook','ver','Ver',null,0),
  ('cotacao-importacao','databook','criar','Criar',null,1),
  ('cotacao-importacao','databook','editar','Editar',null,2),
  ('cotacao-importacao','databook','excluir','Excluir',null,3),
  ('cotacao-importacao','handover','ver','Ver',null,0),
  ('cotacao-importacao','handover','criar','Criar',null,1),
  ('cotacao-importacao','handover','editar','Editar',null,2),
  ('cotacao-importacao','handover','excluir','Excluir',null,3),
  ('cotacao-importacao','cadastro-instaladores','ver','Ver',null,0),
  ('cotacao-importacao','cadastro-instaladores','criar','Criar',null,1),
  ('cotacao-importacao','cadastro-instaladores','editar','Editar',null,2),
  ('cotacao-importacao','cadastro-instaladores','excluir','Excluir',null,3),
  ('cotacao-importacao','rh-homologacao','ver','Ver',null,0),
  ('cotacao-importacao','rh-homologacao','criar','Criar',null,1),
  ('cotacao-importacao','rh-homologacao','editar','Editar',null,2),
  ('cotacao-importacao','rh-homologacao','excluir','Excluir',null,3),
  ('cotacao-importacao','contrato-instalador','ver','Ver',null,0),
  ('cotacao-importacao','contrato-instalador','criar','Criar',null,1),
  ('cotacao-importacao','contrato-instalador','editar','Editar',null,2),
  ('cotacao-importacao','contrato-instalador','excluir','Excluir',null,3),
  ('cotacao-importacao','almoxarifado','ver','Ver',null,0),
  ('cotacao-importacao','almoxarifado','criar','Criar',null,1),
  ('cotacao-importacao','almoxarifado','editar','Editar',null,2),
  ('cotacao-importacao','almoxarifado','excluir','Excluir',null,3),
  ('cotacao-importacao','almoxarifado','ver_custo','Vê os preços de custo dos itens do estoque',null,4),
  ('cotacao-importacao','almoxarifado','escrever_omie','Grava no Omie: requisição de compra e movimentos de estoque',null,5),
  ('cotacao-importacao','almoxarifado','custo_manual','Informa custo manual de itens sem custo no Omie',null,6),
  ('cotacao-importacao','almoxarifado','reposicao_config','Define os parâmetros da Reposição',null,7),
  ('cotacao-importacao','carga-maquina','ver','Ver',null,0),
  ('cotacao-importacao','carga-maquina','criar','Criar',null,1),
  ('cotacao-importacao','carga-maquina','editar','Editar',null,2),
  ('cotacao-importacao','carga-maquina','excluir','Excluir',null,3),
  ('cotacao-importacao','montagem-produto','ver','Ver',null,0),
  ('cotacao-importacao','montagem-produto','criar','Criar',null,1),
  ('cotacao-importacao','montagem-produto','editar','Editar',null,2),
  ('cotacao-importacao','montagem-produto','excluir','Excluir',null,3),
  ('cotacao-importacao','simulacao-producao','ver','Ver',null,0),
  ('cotacao-importacao','simulacao-producao','criar','Criar',null,1),
  ('cotacao-importacao','simulacao-producao','editar','Editar',null,2),
  ('cotacao-importacao','simulacao-producao','excluir','Excluir',null,3),
  ('cotacao-importacao','pcp','ver','Ver',null,0),
  ('cotacao-importacao','pcp','criar','Criar',null,1),
  ('cotacao-importacao','pcp','editar','Editar',null,2),
  ('cotacao-importacao','pcp','excluir','Excluir',null,3),
  ('cotacao-importacao','pcp','apontar_hh','Aponta quem trabalhou na OP e as horas',null,4),
  ('cotacao-importacao','pcp','ver_hh','Vê o valor da hora-homem e o custo de mão de obra',null,5),
  ('cotacao-importacao','mes','ver','Ver',null,0),
  ('cotacao-importacao','mes','criar','Criar',null,1),
  ('cotacao-importacao','mes','editar','Editar',null,2),
  ('cotacao-importacao','mes','excluir','Excluir',null,3),
  ('cotacao-importacao','mes-cadastros','ver','Ver',null,0),
  ('cotacao-importacao','mes-cadastros','criar','Criar',null,1),
  ('cotacao-importacao','mes-cadastros','editar','Editar',null,2),
  ('cotacao-importacao','mes-cadastros','excluir','Excluir',null,3),
  ('cotacao-importacao','relatorios-pcp','ver','Ver',null,0),
  ('cotacao-importacao','relatorios-pcp','criar','Criar',null,1),
  ('cotacao-importacao','relatorios-pcp','editar','Editar',null,2),
  ('cotacao-importacao','relatorios-pcp','excluir','Excluir',null,3),
  ('cotacao-importacao','expedicao','ver','Ver',null,0),
  ('cotacao-importacao','expedicao','criar','Criar',null,1),
  ('cotacao-importacao','expedicao','editar','Editar',null,2),
  ('cotacao-importacao','expedicao','excluir','Excluir',null,3),
  ('cotacao-importacao','logs','ver','Ver',null,0),
  ('cotacao-importacao','logs','criar','Criar',null,1),
  ('cotacao-importacao','logs','editar','Editar',null,2),
  ('cotacao-importacao','logs','excluir','Excluir',null,3),
  ('vprequisicoes','m1-produtos','requisitar_consumo','Pode requisitar Uso e Consumo',null,0),
  ('vprequisicoes','m1-produtos','requisitar_revenda','Pode requisitar Revenda',null,1),
  ('vprequisicoes','m1-produtos','requisitar_estoque','Pode requisitar Estoque',null,2),
  ('vprequisicoes','m2-viagens','requisitar','Pode requisitar',null,0),
  ('vprequisicoes','m3-servicos','requisitar','Pode requisitar',null,0),
  ('vprequisicoes','m4-manutencao','requisitar','Pode requisitar',null,0),
  ('vprequisicoes','m5-frete','requisitar','Pode requisitar',null,0),
  ('vprequisicoes','m6-locacao','requisitar','Pode requisitar',null,0),
  ('vprequisicoes','m7-quadro-comando','ver','Ver',null,0),
  ('vprequisicoes','m7-quadro-comando','criar','Criar e enviar ao cliente',null,1),
  ('vprequisicoes','etapas','cotador','Cotador (V2 Cotação)',null,0),
  ('vprequisicoes','etapas','comprador','Comprador (V4 Compra)',null,1),
  ('vprequisicoes','etapas','almoxarife','Almoxarife (V5 Recebimento)',null,2),
  ('vprequisicoes','etapas','expedicao','Expedição (recebe aviso de material chegando)',null,3),
  ('vprequisicoes','etapas','admin','Administrador do VPRequisições',null,4),
  ('vprequisicoes','aprovacao','aprovador_n1','Nível 1 — até R$ 1.500','nivel',0),
  ('vprequisicoes','aprovacao','aprovador_n2','Nível 2 — até R$ 3.500','nivel',1),
  ('vprequisicoes','aprovacao','aprovador_n3','Nível 3 — acima de R$ 3.500','nivel',2)
on conflict (system_slug, module_key, action_key) do update set label = excluded.label, choice_group = excluded.choice_group, sort_order = excluded.sort_order;

insert into public.catalog_value_tags (system_slug, module_key, tag_key, label, sort_order) values
  ('cotacao-importacao','dashboard','faturamento_kpis','Faturamento e indicadores',0),
  ('cotacao-importacao','financeiro','contas_pagar','Contas a pagar',0),
  ('cotacao-importacao','leads','comissao_lead','Comissão do lead',0),
  ('cotacao-importacao','cadastro-produtos','preco_lista','Preço de lista',0),
  ('cotacao-importacao','cotacoes-fornecedor','preco_fornecedor','Preço do fornecedor e câmbio',0),
  ('cotacao-importacao','propostas','preco_proposta','Preço da proposta (total, itens, desconto)',0),
  ('cotacao-importacao','cadastro-custos','custos','Custos de containers e instalação',0),
  ('cotacao-importacao','precificacao','custos_precificacao','Custos (câmbio, frete, impostos)',0),
  ('cotacao-importacao','precificacao','margem','Margem e markup',1),
  ('cotacao-importacao','precificacao','comissao','Comissões',2),
  ('cotacao-importacao','aval-financeiro','valores_aval','Valor total, custo teto e margem aceita',0),
  ('cotacao-importacao','emissao-nf','faturamento','Valor da NF (faturamento)',0),
  ('cotacao-importacao','contrato-venda-equipamentos','valor_contrato','Valor do contrato',0),
  ('cotacao-importacao','pi-importacao','valores_pi','Valores da P.I. (total, pagamentos, câmbio)',0),
  ('cotacao-importacao','ims-importacao','valor_previsto_ims','Valor total previsto',0),
  ('cotacao-importacao','embarques-importacao','valores_embarque','Valores do embarque (frete, custos, desembaraço)',0),
  ('cotacao-importacao','gi-analise-precos','precos_comparados','Preços comparados',0),
  ('cotacao-importacao','compras','valores_compra','Valores de compra',0),
  ('cotacao-importacao','pedidos-acompanhamento','valor_pedido','Valor do pedido',0),
  ('cotacao-importacao','vistorias','custo_vistoria','Custo da vistoria',0),
  ('cotacao-importacao','instalacao','valores_obra','Valores da obra (andaime, munck, cronograma)',0),
  ('cotacao-importacao','contrato-instalador','pagamento_instaladores','Valor do contrato e pagamentos a instaladores',0),
  ('cotacao-importacao','almoxarifado','custo_estoque','Custo dos itens do estoque',0),
  ('cotacao-importacao','pcp','valor_hh','Valor da hora-homem (dado salarial)',0),
  ('cotacao-importacao','relatorios-pcp','receita_margem','Receita e margem',0),
  ('vprequisicoes','etapas','preco_cotado','Preço cotado',0),
  ('vprequisicoes','etapas','total_aprovacao','Total da aprovação',1),
  ('vprequisicoes','etapas','valor_pago','Valor pago',2),
  ('vprequisicoes','etapas','custo_medio_omie','Custo médio Omie (CMC)',3),
  ('vprequisicoes','etapas','analytics_total','Total comprado (análises)',4)
on conflict (system_slug, module_key, tag_key) do update set label = excluded.label, sort_order = excluded.sort_order;
