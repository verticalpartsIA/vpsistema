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

```
vpsistema.com
│
├── /login                          ← Tela de login (email + senha)
│   ├── Modo normal                 ← supabase.auth.signInWithPassword()
│   ├── Modo reset                  ← ?type=invite  (define senha pelo link)
│   └── Modo expired                ← link de convite expirado
│
├── /dashboard  (autenticado)       ← Tela principal — grade de cards
│   │
│   ├── Cards ADMIN (só Administrador)
│   │   ├── Administração           → view: 'admin'
│   │   ├── Painel Executivo        → view: 'ceo'
│   │   └── Logs de Atividade       → view: 'logs'
│   │
│   └── Cards de Módulos (dinâmicos — tabela `modules`)
│       ├── Catraca                 → https://catraca.vpsistema.com
│       ├── Visitas                 → https://visitas.vpsistema.com
│       ├── VPRequisições           → https://vprequisicoes.vpsistema.com
│       ├── Cotação Importação|PRD  → https://vpprd.vpsistema.com        ← SSO
│       ├── VP Click                → https://vpclick.vpsistema.com      ← SSO
│       ├── Engenharia              → https://engenharia.vpsistema.com   ← SSO
│       ├── Suporte                 → https://suporte.vpsistema.com      ← SSO
│       ├── Propostas               → https://propostas.vpsistema.com    ← SSO
│       └── Pós-Venda 360          → https://posvenda360.vpsistema.com  ← SSO
│
├── /admin  (só Administrador)
│   ├── Lista de usuários (profiles)
│   ├── Convidar novo usuário       → Edge Function: invite-user
│   ├── Ativar / Desativar usuário
│   └── Modal de permissões por módulo
│
├── /ceo  (só Administrador)        ← Painel Executivo / KPIs consolidados
│
└── /logs  (só Administrador)       ← Log de atividades (tabela activity_logs)
```

---

## Módulos cadastrados no banco

| sort | Slug                 | Nome                    | URL                                        | Ativo | Cor       |
|------|----------------------|-------------------------|--------------------------------------------|-------|-----------|
| 1    | `catraca`            | Catraca                 | https://catraca.vpsistema.com              | ✅    | `#F59E0B` |
| 2    | `visitas`            | Visitas                 | https://visitas.vpsistema.com              | ✅    | `#10B981` |
| 3    | `vprequisicoes`      | VPRequisições           | https://vprequisicoes.vpsistema.com/login  | ✅    | `#F59E0B` |
| 5    | `cotacao-importacao` | Cotação Importação\|PRD | https://vpprd.vpsistema.com                | ✅    | `#0EA5E9` |
| 6    | `click`              | VP Click                | https://vpclick.vpsistema.com              | ✅    | `#EC4899` |
| 7    | `engenharia`         | Engenharia              | https://engenharia.vpsistema.com           | ✅    | `#F97316` |
| 9    | `suporte`            | Suporte                 | https://suporte.vpsistema.com              | ✅    | `#64748B` |
| 10   | `propostas`          | Propostas               | https://propostas.vpsistema.com/           | ✅    | `#0284C7` |
| 15   | `vpposvenda360`      | Pós-Venda 360           | https://posvenda360.vpsistema.com/login    | ✅    | `#06B6D4` |

> Módulos com `is_active = false` não aparecem no dashboard. Para reativar: `UPDATE modules SET is_active = true WHERE slug = '...'`

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

---

## Banco de Dados (Supabase `ubdkoqxfwcraftesgmbw`)

### Tabelas principais

| Tabela               | Descrição                                                  |
|----------------------|------------------------------------------------------------|
| `profiles`           | Dados dos colaboradores (nome, cargo, dept, avatar, level) |
| `modules`            | Cards do dashboard (slug, name, url, icon, color, active)  |
| `module_permissions` | Restrições por usuário (user_id + module_slug)             |
| `activity_logs`      | Log de ações (login, logout, acesso a módulo, admin)       |

### Lógica de permissões

```
Se não há linhas em module_permissions para o usuário → acesso pleno a todos os módulos
Se há linhas → o usuário vê apenas os slugs listados
```

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
`Compras` · `Engenharia` · `Financeiro` · `Logistica` · `MKT` · `Vendas`

### Níveis de acesso
| Nível           | Acesso ao painel Admin/CEO/Logs |
|-----------------|----------------------------------|
| `Colaborador`   | Não                              |
| `Lider`         | Não                              |
| `Administrador` | Sim (cards extras no dashboard)  |

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

**Variáveis de ambiente no Hostinger:**
```
VITE_SUPABASE_URL=https://ubdkoqxfwcraftesgmbw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

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

*Documentação gerada em 24/05/2026 — Claude Sonnet 4.6*
