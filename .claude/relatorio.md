# Relatório de Sessão — vpsistema
> Projeto: Portal Central VerticalParts
> Data: 24/05/2026
> Engenheiro: Claude Sonnet 4.6 (sessão com Gelson Simões)

---

## O que foi feito hoje

### 1. Atualização do card "Cotação Importação | PRD"

O card que antes apontava para `https://cotacao-importacao.vpsistema.com` foi atualizado
diretamente no banco de dados (sem alteração de código) para apontar para o sistema real em produção:

```sql
UPDATE modules
SET
  name = 'Cotação Importação | PRD',
  url  = 'https://vpprd.vpsistema.com'
WHERE slug = 'cotacao-importacao';
```

- **Banco:** Supabase `ubdkoqxfwcraftesgmbw`
- **Resultado:** Card renomeado e URL atualizada. O SSO é injetado automaticamente
  porque `vpprd.vpsistema.com` está dentro do domínio `*.vpsistema.com`.

---

### 2. SSO Guard no projeto vpprd (subsistema)

O projeto `vpprd_claudeDesigner` (WMS VerticalParts) não tinha nenhuma proteção de acesso.
Qualquer pessoa que soubesse a URL `https://vpprd.vpsistema.com/` acessava o sistema direto.

Foi implementado um **guard SSO** no arquivo `src/supabase.js` (commit `8e80774`):

**Lógica:**
1. Verifica se `sso_token` e `sso_refresh` estão na URL (vêm do vpsistema.com)
2. Se sim → chama `sb.auth.setSession()` para estabelecer sessão Supabase → guarda flag na `sessionStorage` → limpa URL
3. Se não → verifica se há sessão Supabase salva no `localStorage` OU flag `vpprd_sso_ok` na `sessionStorage`
4. Se nenhum dos anteriores → `window.location.replace('https://vpsistema.com')` (redirect imediato, antes do React montar)

O guard roda como **script puro** (não Babel), então o redirect acontece antes de qualquer
componente React ser carregado.

---

### 3. README portfolio criado no vpsistema

Criado `README.md` na raiz do projeto cobrindo:
- Por que o projeto existe
- Stack técnico
- Árvore completa de views (Login, Dashboard, Admin, CEO, Logs)
- Tabela de todos os módulos com URL e estado ativo
- Como o SSO funciona (fluxo passo a passo)
- Schema do banco (tabelas e lógica de permissões)
- **Instruções para adicionar novo card (sem alterar código)**
- Ícones disponíveis e como mapear imagem de fundo
- Como convidar colaborador
- Estrutura de arquivos
- Instruções de deploy

---

### 4. Atualização de credenciais

Em `C:\Users\gelso\VerticalParts\CredenciaisMD\credenciais_master.md`:
- Token GitHub MCP do vpsistema atualizado (ver `credenciais_master.md` seção GitHub)
- Token "todos os projetos" destacado com ⭐ (ver `credenciais_master.md` seção GitHub)
- MCP config recomendado atualizado para usar o token ⭐

---

## Instruções para o Futuro

### Adicionar um novo card no dashboard

> ⚡ **Não precisa mexer em código.** Só banco.

```sql
INSERT INTO modules (slug, name, description, url, icon, color, sort_order, is_active)
VALUES (
  'slug-do-sistema',
  'Nome Exibido',
  'Descrição curta do sistema',
  'https://slug-do-sistema.vpsistema.com',
  'Package',     -- ícone Lucide (ver lista no README)
  '#6366F1',     -- cor hex
  30,            -- posição na grade (menor = mais à esquerda)
  true
);
```

**Checklist:**
- [ ] `slug` único, kebab-case
- [ ] `icon` deve ser um dos nomes em `src/lib/moduleIcons.js`
- [ ] `sort_order` único (ou próximo ao grupo correto)
- [ ] Se o sistema usa SSO → a URL deve conter `vpsistema.com` ou `verticalparts.com`
- [ ] Se quiser imagem personalizada → adicionar em `src/lib/cardImages.js` e fazer push

---

### Adicionar imagem de fundo para o novo card

Abrir `src/lib/cardImages.js` e adicionar:

```js
const MODULE_IMAGES = {
  // ... linhas existentes ...
  'slug-do-sistema': IMAGES[N],  // N = 0 a 7
}
```

Fazer push → Hostinger faz deploy automático via branch `main`.

---

### Convidar um novo colaborador

1. Acessar vpsistema.com como Administrador
2. Card **Administração** → botão **"+ Convidar"**
3. Preencher nome, e-mail, departamento, nível
4. O sistema usa a **Edge Function `invite-user`** (Supabase) para enviar o e-mail
5. O colaborador define a senha pelo link recebido

Se a Edge Function falhar:
```bash
# Ver logs da função no Supabase Dashboard:
# Supabase → Edge Functions → invite-user → Logs
```

---

### Restringir módulos para um usuário específico

No Supabase, inserir na tabela `module_permissions`:

```sql
-- Dar acesso apenas a 'catraca' e 'visitas' para um usuário
INSERT INTO module_permissions (user_id, module_slug)
VALUES
  ('uuid-do-usuario', 'catraca'),
  ('uuid-do-usuario', 'visitas');

-- Para voltar ao acesso pleno: remover todas as linhas do usuário
DELETE FROM module_permissions WHERE user_id = 'uuid-do-usuario';
```

> Regra: **sem linhas = acesso pleno**. **Com linhas = apenas os slugs listados.**

---

### Desativar um card sem excluir

```sql
UPDATE modules SET is_active = false WHERE slug = 'slug-do-sistema';
-- O card some do dashboard mas os dados são preservados.
-- Para reativar: SET is_active = true
```

---

### SSO — Adicionar novo subsistema compatível

O SSO é injetado automaticamente para URLs que contêm `vpsistema.com` ou `verticalparts.com`.
Se o novo sistema estiver em outro domínio, editar `src/pages/Dashboard.jsx`:

```js
// Linha ~71 (array SSO_DOMAINS):
const SSO_DOMAINS = ['vpsistema.com', 'verticalparts.com', 'novo-dominio.com']
```

No subsistema receptor, implementar o guard (igual ao `vpprd_claudeDesigner/src/supabase.js`):
- Ler `?sso_token` e `?sso_refresh` da URL
- Chamar `sb.auth.setSession({ access_token, refresh_token })`
- Limpar a URL com `history.replaceState`
- Redirecionar ao portal se não houver sessão nem token

---

### Deploy manual (emergência)

```bash
cd C:\Users\gelso\Projetos_Sites\08_VPSISTEMA_PORTAL
git add .
git commit -m "fix: descrição do fix"
git push origin main
# Hostinger faz deploy automático em ~2 min
```

---

## Referências rápidas

| Item                    | Valor                                              |
|-------------------------|----------------------------------------------------|
| URL Produção            | https://vpsistema.com                              |
| Supabase Projeto        | ubdkoqxfwcraftesgmbw                               |
| GitHub                  | https://github.com/verticalpartsIA/vpsistema       |
| GitHub Token MCP        | ver `credenciais_master.md` — seção GitHub [2] vpsistema |
| Token todos os projetos | ver `credenciais_master.md` — linha com ⭐           |
| Credenciais completas   | C:\Users\gelso\VerticalParts\CredenciaisMD\credenciais_master.md |

---

*Relatório gerado em 24/05/2026 — Claude Sonnet 4.6*
