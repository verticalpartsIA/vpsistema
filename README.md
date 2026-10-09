# VP Sistema — Portal Central VerticalParts

> **Portal de entrada unificado** para todos os sistemas operacionais da VerticalParts.
> Autenticação única (SSO), gestão de usuários e controle de acesso por módulo.

🌐 **Produção:** [https://vpsistema.com](https://vpsistema.com)
📦 **Supabase:** `ubdkoqxfwcraftesgmbw`
🚀 **Deploy:** Hostinger Node.js (branch `main`)

---

## Por que este projeto existe?

A VerticalParts opera múltiplos sistemas internos — cotação de importação, comercial, engenharia, suprimentos, suporte — cada um hospedado em um subdomínio separado. Antes do vpsistema, cada colaborador precisava memorizar URLs diferentes, fazer login individualmente em cada sistema e não havia controle centralizado de quem tinha acesso a quê.

O **vpsistema.com** resolve isso com:

- **Uma única tela de login** — o colaborador entra uma vez e acessa tudo
- **SSO automático** — ao clicar em qualquer card, o token de sessão é injetado na URL do subsistema, que autentica o usuário sem novo login
- **Controle de acesso por módulo** — administradores definem quais sistemas cada colaborador pode ver/acessar
- **Painel executivo (CEO)** — visão consolidada de KPIs de todos os sistemas
- **Log de atividades** — auditoria de logins, acessos a módulos e ações administrativas

---

## Stack Técnico

| Camada        | Tecnologia                              |
|---------------|-----------------------------------------|
| Frontend      | React 18 + Vite + React Router          |
| Estilo        | Tailwind CSS v4 + CSS custom properties |
| Banco         | Supabase (PostgreSQL + Auth + RLS)      |
| Edge Functions| Supabase Edge Functions (Deno)          |
| Deploy        | Hostinger Node.js / Static              |
| Ícones        | Lucide React                            |

---

## Arquitetura — Árvore de Views

Cada tela tem endereço próprio (desde 09/10/2026). Roteador mínimo em
`src/lib/router.js` (History API, sem react-router).

```
vpsistema.com                        ← Login (raiz do site)
│   ├── e-mail + senha (+ código por WhatsApp quando o 2FA estiver ativo)
│   ├── Modo reset                   ← ?type=invite / recovery
│   └── Modo expired                 ← link expirado
│
├── /inicio  (autenticado)           ← Grade de cards
│   ├── Administração                → só quem tem NÍVEL DE PODER (plenos/médios/baixos)
│   ├── Painel Executivo             → só cargo Administrador
│   ├── Histórico                    → só cargo Administrador
│   └── Cards de sistemas (tabela `modules`)
│
├── /administracao                   ← Colaboradores, poderes, valores, sistemas,
│                                       inativação com motivo, dois celulares
├── /painel-executivo                ← KPIs consolidados
└── /historico                       ← Log de atividades (activity_logs)
```

- Sem sessão em qualquer endereço → login em `vpsistema.com`; depois do login a
  pessoa volta para a tela que pediu. F5 exige login de novo (sessão não é
  guardada no navegador, por segurança).
- Endereço desconhecido → `/inicio` (ou login).

---

## Módulos cadastrados no banco

| Slug                 | Nome            | URL                                         |
|----------------------|-----------------|---------------------------------------------|
| `catraca`            | Catraca         | https://catraca.vpsistema.com               |
| `visitas`            | Visitas         | https://visitas.vpsistema.com               |
| `vprequisicoes`      | VPRequisições   | https://vprequisicoes.vpsistema.com         |
| `cotacao-importacao` | **VP HUB**      | https://hub.vpsistema.com (slug antigo mantido) |
| `click`              | VP Click        | https://vpclick.vpsistema.com               |
| `engenharia`         | Engenharia      | https://engenharia.vpsistema.com (⚠️ DNS não resolve em 09/10) |
| `suporte`            | Suporte         | https://suporte.vpsistema.com               |
| `propostas`          | Propostas       | https://propostas.vpsistema.com             |
| `vpposvenda360`      | Pós-Venda 360   | https://posvenda360.vpsistema.com           |
| `gente-gestao`       | Gente & Gestão  | https://gentegestao.vpsistema.com           |
| `asset-manager`      | Asset Manager   | https://assetmanager.vpsistema.com          |

> **Sistema novo nasce fechado** (desde 09/10/2026): ao inserir, reativar ou
> trocar o slug de um módulo, o trigger `trg_close_new_module_for_everyone`
> grava bloqueio para todos, exceto quem tem poderes **plenos**. Quem tem
> alçada libera pela `/administracao`. Antes disso, todo sistema novo abria
> para todo mundo automaticamente.

---

## SSO — Como funciona

```
1. Colaborador faz login em vpsistema.com
2. Clica em um card de módulo (ex: "Cotação Importação | PRD")
3. O Dashboard busca session.access_token + session.refresh_token do Supabase
4. Injeta na URL: https://vpprd.vpsistema.com/?sso_token=ACCESS&sso_refresh=REFRESH
5. Abre em nova aba (_blank, noopener)
6. O subsistema recebe os tokens, chama sb.auth.setSession() e autentica o usuário
7. O subsistema redireciona para ?sso_token no próprio URL (sem expor tokens no histórico)
```

**Domínios com SSO ativo:** `*.vpsistema.com`, `*.verticalparts.com`

Os apps satélites estão mapeados em `supabase/functions/_shared/apps.ts`, com a
chave igual ao primeiro rótulo do hostname do módulo (`posvenda360`, `vpclick`,
`vpgestaoimportacao`…) e o `moduleSlug` correspondente na tabela `modules`:

| Tipo        | Apps                                                                    | Como autentica                                  |
|-------------|-------------------------------------------------------------------------|-------------------------------------------------|
| `token`     | catraca, vpclick, propostas, vpgestaoimportacao, engenharia, suporte     | recebe o JWT do portal em `?sso_token=`         |
| `magiclink` | visitas, vprequisicoes, posvenda360                                     | Auth próprio — usuário é provisionado + magic link |

Módulo sem entrada no mapa não quebra mais: o `sso-proxy` usa a URL cadastrada
em `modules` e anexa o `?sso_token=` (antes respondia `Unknown app` e o portal
abria a URL crua, sem sessão — o "dá reload" relatado pelos colaboradores).

---

## Banco de Dados (Supabase `ubdkoqxfwcraftesgmbw`)

### Tabelas principais

| Tabela               | Descrição                                                  |
|----------------------|------------------------------------------------------------|
| `profiles`           | Dados dos colaboradores (nome, cargo, dept, avatar, level) |
| `modules`            | Cards do dashboard (slug, name, url, icon, color, active)  |
| `module_permissions` | Restrições por usuário (user_id + module_slug)             |
| `activity_logs`      | Log de ações (login, logout, acesso a módulo, admin)       |

### Lógica de permissões — árvore de alçadas

```
👤 PESSOA
├── 🔑 NÍVEL DE PODER (profiles.power_level) — poder DENTRO do vpsistema
│      plenos : igual ao Gelson/Diego, inclusive dar poderes a si mesmo
│      medios : dá poderes só a quem está abaixo (baixos/nenhum), nunca a si mesmo
│      baixos : não dá poderes nem libera valores; ajusta depto/status de quem não tem poder
│      (vazio): não abre a Administração
├── ⭐ VALORES R$ (profiles.values_access) — vale no ecossistema inteiro
│      nenhum (padrão) : R$ desfocado   |   todos : vê todos os valores
│      (exceções por sistema/valor: próximas etapas — piloto VP HUB)
└── 🧩 SISTEMAS (module_permissions) — guarda só BLOQUEIOS (can_access = false)
       └── ▸ Alçadas (catálogo por sistema: catalog_modules / catalog_actions /
              catalog_value_tags) → ações por módulo (user_grants) e exceções de
              valor R$ por etiqueta (user_value_exceptions). Catálogo semeado do
              VP HUB (mesmas chaves de `alcadas_capacidade`) e do VPRequisições
              (M1 Uso e Consumo/Revenda/Estoque, etapas, aprovação N1/N2/N3).
```

**Regras valem no servidor**, não só na tela:
- `enforce_profile_powers` (profiles) e `enforce_module_permission_powers`
  (module_permissions), com RLS por `get_my_power()`.
- Só **plenos** alteram nível de poder. Ninguém além de plenos altera os
  próprios poderes. Médio nunca mexe em outro médio ou em pleno.
- `invite-user` e `delete-user` checam o nível de poder.
- Service role (edge functions/syncs) passa direto.

**Regra de ouro das atualizações:** publicar o site **nunca** altera usuários,
poderes ou bloqueios. O deploy (GitHub Actions) só copia o front. Mudança em
usuários só acontece por migração explícita, revisada e registrada aqui.

> Histórico: até 29/07/2026 `module_permissions` era *allow-list*; passou a
> "libera por padrão, bloqueia por exceção" (backup em
> `module_permissions_backup_20260729`). Desde 09/10/2026 sistema novo nasce
> fechado (ver acima).

### Inativação com motivo
1ª pergunta: **Demissão** ou **Suspensão de acesso** (afastamento, licença ou
motivo ainda não definido). Só a Demissão abre o checklist de devolução
(crachá, celular corporativo, notebook + outro item). Cada inativação é gravada
em `profile_inactivations`; ao reativar, a tela mostra o mini-relatório.

### Celulares
`celular_corporativo` e `celular_pessoal`. `celular` é o **número de
notificação**, calculado no banco (`a_trg_sync_celular_notificacao`):
corporativo se houver, senão pessoal. Quem já lia `celular` segue a regra sem
mudança; escrita antiga direto em `celular` continua funcionando.

---

## Como adicionar um novo card (módulo)

> Nenhum código precisa ser alterado. Basta inserir uma linha no banco.

### Via SQL (Supabase Dashboard ou MCP):

```sql
INSERT INTO modules (slug, name, description, url, icon, color, sort_order, is_active)
VALUES (
  'meu-sistema',                        -- slug único (kebab-case)
  'Meu Sistema',                        -- nome exibido no card
  'Descrição breve do sistema',         -- subtítulo do card (opcional)
  'https://meusistema.vpsistema.com',   -- URL de destino (com SSO automático se for *.vpsistema.com)
  'Package',                            -- nome do ícone Lucide (ver lista abaixo)
  '#6366F1',                            -- cor hex (faixa superior + ícone)
  20,                                   -- sort_order (posição na grade)
  true                                  -- is_active
);
```

### Ícones disponíveis (campo `icon`)

| Ícone            | Visual                         |
|------------------|--------------------------------|
| `ShieldCheck`    | Escudo com check — segurança   |
| `MapPin`         | Pin de localização — visitas   |
| `Package`        | Caixa — suprimentos/estoque    |
| `ClipboardList`  | Prancheta — requisições        |
| `Globe`          | Globo — internacional/web      |
| `MousePointerClick` | Cursor — clique/tarefas     |
| `DraftingCompass`| Compasso — engenharia          |
| `Activity`       | Atividade — operacional        |
| `Bot`            | Robô — IA / suporte            |
| `FileSignature`  | Documento — propostas          |
| `Users`          | Pessoas — administração        |
| `ExternalLink`   | Link externo (fallback)        |

### Imagem de fundo do card

As imagens ficam em `/public/images/` e são mapeadas no arquivo `src/lib/cardImages.js`.
Para adicionar imagem ao novo slug, abra `cardImages.js` e acrescente:

```js
const MODULE_IMAGES = {
  // ... existentes ...
  'meu-sistema': IMAGES[2],  // escolha o índice 0–7
}
```

Se não mapear, o sistema usa uma imagem rotativa pelo índice automaticamente.

---

## Como convidar um novo colaborador

1. Acesse **vpsistema.com** com conta Administrador
2. Clique no card **Administração**
3. Botão **"+ Convidar"** no canto superior direito
4. Preencha: nome, e-mail, departamento e nível (`Colaborador` / `Lider` / `Administrador`)
5. O sistema dispara a **Edge Function `invite-user`** via Supabase
6. O colaborador recebe e-mail com link para definir a senha
7. Após o primeiro login, o Administrador pode ajustar as permissões por módulo no modal de permissões

### Departamentos disponíveis
`CEO` · `Adm/Financeiro` · `Comercial` · `Engenharia` · `Gente & Gestão` ·
`Jurídico/Importação/Suprimentos` · `Logística/Almoxarifado/Produção` · `Marketing`

### Cargo (`level`) × Nível de poder (`power_level`)
| Campo | Para que serve |
|-------|----------------|
| Cargo: `Colaborador` / `Lider` / `Administrador` | Papel nos sistemas satélites e acesso ao Painel Executivo/Histórico |
| Poder: `plenos` / `medios` / `baixos` | Quem pode administrar pessoas, poderes e valores no vpsistema |

---

## Estrutura de Arquivos

```
vpsistema/
├── src/
│   ├── App.jsx                    # Roteador principal (login / dashboard / admin / ceo / logs)
│   ├── pages/
│   │   ├── Login.jsx              # Tela de login + reset de senha + link expirado
│   │   ├── Dashboard.jsx          # Grade de cards + SSO injection
│   │   ├── Admin.jsx              # Gestão de usuários e permissões
│   │   ├── CeoDashboard.jsx       # Painel executivo KPIs
│   │   └── ActivityLog.jsx        # Log de atividades
│   ├── components/
│   │   └── ModuleCard.jsx         # Card visual com imagem de fundo + overlay
│   └── lib/
│       ├── supabase.js            # Client Supabase (anon key)
│       ├── moduleIcons.js         # Mapa nome → componente Lucide
│       ├── cardImages.js          # Mapa slug → imagem de fundo
│       └── activityLog.js         # Helper de log de atividades
├── supabase/
│   └── functions/
│       └── invite-user/           # Edge Function — convite de colaborador
├── public/
│   └── images/                    # Fotos industriais (escadas/elevadores)
├── package.json
├── vite.config.js
└── tailwind.config.js
```

---

## Deploy (Hostinger)

```
Plataforma:   Hostinger Node.js
Branch:       main  (auto-deploy a cada push via GitHub Actions)
Build:        npm run build  (Vite)
Start:        node server.js  (ou serve dist/)
Node:         18.x
```

> A partir de 03/07/2026, o deploy é feito pelo workflow
> `.github/workflows/deploy-hostinger.yml` (build + SCP/SSH), não mais pela
> integração Git nativa do hPanel — que parou de funcionar após o
> repositório ser renomeado para `001_vpsistema` e não pôde ser
> reconectada pela interface.

### Cache — por que ninguém precisa dar Ctrl+Shift+R

`public/.htaccess` (copiado para `dist/` no build) já aplica a estratégia padrão
de SPA:

| Arquivo             | Cache-Control                  | Por quê                                      |
|---------------------|--------------------------------|----------------------------------------------|
| `assets/index-*.js` / `*.css` | 1 ano                | o hash está no nome — build novo, nome novo  |
| `index.html`        | `no-store, must-revalidate`    | é ele que aponta para o hash da vez          |

Ou seja: qualquer **carregamento novo** — F5 comum, abrir o portal, voltar no dia
seguinte — já baixa a versão nova. Recarga forçada nunca é necessária.

O único caso que header nenhum resolve é a **aba que ficou aberta** desde antes
do deploy: aquele JS já está na memória. Para isso, `src/lib/versionWatch.js`
compara o bundle em execução com o que o `index.html` anuncia (a cada 5 min e
sempre que o colaborador volta para a aba) e:

- **nada digitado na tela** → recarrega sozinho, sem avisar
- **formulário em uso** (convite, edição de nome) → mostra o `UpdateToast` com
  o botão "Atualizar", para não jogar fora o que estava sendo preenchido

**Variáveis de ambiente no Hostinger:**
```
VITE_SUPABASE_URL=https://ubdkoqxfwcraftesgmbw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## Histórico de mudanças

| Data | PR | O que mudou |
|------|----|-------------|
| 09/10/2026 | #50 | Endereço próprio por tela: login em `vpsistema.com`; `/inicio`, `/administracao`, `/painel-executivo`, `/historico` |
| 09/10/2026 | #51 | Árvore de alçadas — topo: níveis de poder (Plenos/Médios/Baixos) e Valores R$; travas no servidor; `invite-user`/`delete-user` checam o poder. Inauguração: Gelson e Diego plenos; demais Administradores médios; Juliana vê valores |
| 09/10/2026 | #52 | Inativação com motivo (Demissão / Suspensão de acesso) + mini-relatório; dois celulares (corporativo/pessoal) com número de notificação calculado; acesso às telas de admin não é mais logado em dobro |
| 09/10/2026 | #55 | Árvore de alçadas — catálogo por sistema (VP HUB 59 módulos, VPRequisições 9) e acordeão na `/administracao`: módulos → ações → exceções de valor R$; mesmas travas de poder no servidor |
| 09/10/2026 | #54 | Bug "a cada atualização os usuários ganham poderes": sistema novo/reativado/renomeado nasce fechado; README atualizado. Mutirão de segurança acompanhado na issue #53 |

**Lições de deploy (09/10/2026):** edge function publicada pelo conector MCP
(arquivo único, sem bundler) dá `BOOT_ERROR` com imports `https://esm.sh/...`
— usar `npm:@supabase/supabase-js@2` e testar a função depois do deploy.

---

## Repositório e Credenciais

| Item                | Valor                                          |
|---------------------|------------------------------------------------|
| GitHub              | https://github.com/verticalpartsIA/001_vpsistema |
| GitHub Token (MCP)  | Ver `credenciais_master.md`                    |
| Supabase Projeto    | `ubdkoqxfwcraftesgmbw`                         |
| Supabase Anon Key   | Ver `credenciais_master.md`                    |
| URL Produção        | https://vpsistema.com                          |

---

## Contributors

- Gelson Simões — criador e responsável pelas soluções VerticalParts

---

**Feito por Gelson Simões**
