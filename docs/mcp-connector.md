# Conector MCP para o Claude

O VP Sistema expõe um servidor MCP remoto (Streamable HTTP) via Supabase
Edge Function, permitindo que o Claude (claude.ai, Claude Desktop ou Claude
Code) consulte e administre o portal central diretamente em conversa.

## Endpoint

```
https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/mcp-server
```

Código-fonte: `supabase/functions/mcp-server/index.ts`.

## Autenticação: chave na URL (sem OAuth)

Ao integrar o servidor equivalente do VPRequisições, descobrimos que o
domínio compartilhado `*.supabase.co` aplica CSP sandbox em HTML servido por
Edge Functions — isso impede qualquer tela de login OAuth de renderizar ou
submeter formulário. Por isso este servidor não implementa OAuth: a
autenticação é só uma chave compartilhada, aceita via query string `?key=`
(ou header `Authorization: Bearer`, para outros clientes MCP).

O token não é uma variável de ambiente Deno — ele é validado contra o hash
(SHA-256) guardado na tabela `public.mcp_api_keys`
(migration `supabase/migrations/20260710013000_mcp_api_keys.sql`), que tem
RLS habilitado sem policies (só o `service_role`, usado pela própria
function, consegue ler). O valor em texto puro nunca é persistido em lugar
nenhum — nem no banco, nem no repositório.

Para gerar um novo token e revogar o antigo:

```sql
update public.mcp_api_keys set active = false where label = 'claude-web-connector';
insert into public.mcp_api_keys (label, token_hash) values ('novo-label', '<sha256-hex-do-novo-token>');
```

## Como conectar no claude.ai

1. Configurações → Conectores → Adicionar conector → Adicionar conector personalizado.
2. **Nome:** `VP Sistema`
3. **URL do servidor MCP remoto** (a URL inteira, incluindo `?key=`):
   ```
   https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/mcp-server?key=<token-de-acesso>
   ```
4. Deixe os campos de OAuth Client ID/Secret em branco e clique em Adicionar.

Como a chave já vai na URL, o servidor responde autenticado de primeira e o
claude.ai conecta direto, sem tela de login. Trate essa URL como senha — não
compartilhe capturas de tela da configuração do conector.

## Ferramentas disponíveis

**Leitura:** `list_modules`, `list_users`, `get_user`, `list_module_permissions`,
`get_activity_logs`, `dashboard_summary`.

**Escrita:** `toggle_module_active`, `update_module`, `grant_module_permission`,
`revoke_module_permission`, `set_user_level`, `toggle_user_active`.

Todas as ações de escrita usam o `service_role` do Supabase e registram
evento em `activity_logs` com `user_name: "Claude (MCP)"`. Não há
diferenciação de papel por usuário — qualquer portador do token pode
executar qualquer ferramenta. Trate o token com o mesmo cuidado que uma
credencial de administrador do sistema.

## Decisão de escopo: sem criar/excluir contas

Deliberadamente **não** foram expostas `invite-user` e `delete-user` via
MCP. Essas ações criam ou removem contas de login (com senha) em até 6
plataformas simultaneamente (VPRequisições, Pós-Venda 360, Propostas,
Visitas e Brindes, VP Catraca) — o risco de um LLM executar isso por engano
ou má interpretação é alto demais para automatizar sem revisão humana direta
na tela do próprio app. `set_user_level`, `toggle_user_active`,
`grant_module_permission` e `revoke_module_permission` cobrem a maior parte
da administração do dia a dia com risco bem menor (tudo reversível, nada
mexe em credenciais de autenticação).
