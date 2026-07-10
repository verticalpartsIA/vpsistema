import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── Servidor MCP remoto do VP Sistema ─────────────────────────────────────
// Expõe o portal central (módulos, usuários, permissões, logs) como
// ferramentas MCP para que o Claude (claude.ai / Claude Code) possa
// consultar e administrar o portal via um "conector personalizado".
//
// Autenticação: chave compartilhada, aceita via header Authorization: Bearer
// <token> OU via query string ?key=<token>. O modo query permite embutir a
// credencial direto na URL do conector do claude.ai — necessário porque o
// domínio compartilhado *.supabase.co aplica CSP sandbox em HTML servido por
// Edge Functions, o que impede qualquer tela de login OAuth de funcionar
// (aprendido ao integrar o VPRequisições). Sem tela de login, sem OAuth: a
// primeira requisição já chega autenticada e o claude.ai nunca tenta
// descoberta OAuth.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "vpsistema-mcp", version: "1.0.0" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

function jsonResponse(body: unknown, status = 200) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(new TextEncoder().encode(JSON.stringify(body)), { status, headers });
}

// ─── Acesso a dados (PostgREST via service_role) ───────────────────────────

async function supabaseRest<T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD"; body?: unknown; headers?: Record<string, string> },
): Promise<{ data: T; count: number }> {
  const method = options?.method || "GET";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Supabase respondeu com status ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // texto simples, mantém message
    }
    throw new Error(message);
  }

  const contentRange = response.headers.get("content-range");
  const count = contentRange ? Number(contentRange.split("/")[1]) || 0 : 0;

  if (method === "HEAD" || response.status === 204) {
    return { data: null as T, count };
  }

  const text = await response.text();
  if (!text) return { data: null as T, count };
  return { data: JSON.parse(text) as T, count };
}

// ─── Autenticação por chave compartilhada (hash em mcp_api_keys) ──────────

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAuthorized(req: Request, url: URL): Promise<boolean> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const bearerToken = match ? match[1].trim() : "";
  const keyParam = (url.searchParams.get("key") || "").trim();

  for (const token of [bearerToken, keyParam]) {
    if (!token) continue;
    const tokenHash = await sha256Hex(token);
    const { data } = await supabaseRest<Array<{ id: string }>>(
      `mcp_api_keys?select=id&token_hash=eq.${tokenHash}&active=eq.true&limit=1`,
    );
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

// ─── Domínio: helpers ───────────────────────────────────────────────────────

const LEVELS = ["Administrador", "Lider", "Colaborador"] as const;

async function findUserByEmail(email: string) {
  const { data } = await supabaseRest<Array<{ id: string; email: string; name: string; level: string; is_active: boolean }>>(
    `profiles?select=id,email,name,level,is_active&email=eq.${encodeURIComponent(email)}&limit=1`,
  );
  const user = data?.[0];
  if (!user) throw new Error(`Usuário com email ${email} não encontrado.`);
  return user;
}

async function findModuleBySlug(slug: string) {
  const { data } = await supabaseRest<Array<{ slug: string; name: string; is_active: boolean }>>(
    `modules?select=slug,name,is_active&slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  const module_ = data?.[0];
  if (!module_) throw new Error(`Módulo com slug ${slug} não encontrado.`);
  return module_;
}

async function logActivity(action: string, target: string, details: Record<string, unknown>) {
  await supabaseRest("activity_logs", {
    method: "POST",
    body: [
      {
        user_name: "Claude (MCP)",
        user_email: null,
        action,
        target,
        details,
      },
    ],
  });
}

// ─── Ferramentas MCP ────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_modules",
    description: "Lista os módulos (cards) cadastrados no portal, com status ativo/inativo, URL e ordem de exibição.",
    inputSchema: {
      type: "object",
      properties: { active_only: { type: "boolean", description: "Se true, retorna só módulos ativos." } },
    },
    handler: async (args) => {
      const params = new URLSearchParams({
        select: "slug,name,description,url,icon,color,is_active,sort_order,created_at",
        order: "sort_order.asc",
      });
      if (args.active_only) params.set("is_active", "eq.true");
      const { data } = await supabaseRest(`modules?${params.toString()}`);
      return { modules: data };
    },
  },
  {
    name: "list_users",
    description: "Lista colaboradores cadastrados no portal, com filtros opcionais por nível, departamento, status ativo e busca por nome/email.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: LEVELS },
        department: { type: "string" },
        active_only: { type: "boolean" },
        search: { type: "string", description: "Busca por nome ou email." },
        limit: { type: "number", description: "Máximo de resultados (padrão 50, máx 200)." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 50, 200);
      const params = new URLSearchParams({
        select: "id,email,name,department,level,role,is_active,created_at",
        order: "name.asc",
        limit: String(limit),
      });
      if (args.level) params.set("level", `eq.${args.level}`);
      if (args.department) params.set("department", `eq.${args.department}`);
      if (args.active_only) params.set("is_active", "eq.true");
      if (args.search) {
        const term = String(args.search).replace(/[,()]/g, "");
        params.set("or", `(name.ilike.*${term}*,email.ilike.*${term}*)`);
      }
      const { data, count } = await supabaseRest(`profiles?${params.toString()}`, {
        headers: { Prefer: "count=exact" },
      });
      return { total: count, users: data };
    },
  },
  {
    name: "get_user",
    description: "Retorna o detalhe de um colaborador pelo email, incluindo as permissões de módulo concedidas a ele.",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
    },
    handler: async (args) => {
      const email = String(args.email);
      const { data: users } = await supabaseRest<Array<Record<string, unknown>>>(
        `profiles?select=*&email=eq.${encodeURIComponent(email)}&limit=1`,
      );
      const user = users?.[0];
      if (!user) throw new Error(`Usuário com email ${email} não encontrado.`);
      const { data: permissions } = await supabaseRest(
        `module_permissions?select=module_slug,can_access,created_at&user_id=eq.${user.id}`,
      );
      return { user, module_permissions: permissions };
    },
  },
  {
    name: "list_module_permissions",
    description: "Lista permissões de acesso a módulos concedidas explicitamente (tabela module_permissions). Sem linhas para um usuário = acesso pleno por padrão.",
    inputSchema: {
      type: "object",
      properties: {
        module_slug: { type: "string", description: "Filtra por um módulo específico." },
        limit: { type: "number", description: "Máximo de resultados (padrão 100, máx 300)." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 100, 300);
      const params = new URLSearchParams({
        select: "id,module_slug,can_access,created_at,profiles!module_permissions_user_id_fkey(name,email)",
        order: "created_at.desc",
        limit: String(limit),
      });
      if (args.module_slug) params.set("module_slug", `eq.${args.module_slug}`);
      const { data } = await supabaseRest(`module_permissions?${params.toString()}`);
      return { permissions: data };
    },
  },
  {
    name: "get_activity_logs",
    description: "Retorna o log de atividades do portal (login, logout, acesso a módulo, ações administrativas), mais recentes primeiro.",
    inputSchema: {
      type: "object",
      properties: {
        user_email: { type: "string" },
        action: { type: "string" },
        limit: { type: "number", description: "Máximo de resultados (padrão 30, máx 200)." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 30, 200);
      const params = new URLSearchParams({
        select: "user_name,user_email,action,target,details,criado_em",
        order: "criado_em.desc",
        limit: String(limit),
      });
      if (args.user_email) params.set("user_email", `eq.${args.user_email}`);
      if (args.action) params.set("action", `eq.${args.action}`);
      const { data } = await supabaseRest(`activity_logs?${params.toString()}`);
      return { logs: data };
    },
  },
  {
    name: "dashboard_summary",
    description: "Resumo executivo do portal: total de colaboradores, ativos, administradores, módulos ativos, permissões concedidas e atividade de hoje.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const count = async (table: string, filters: Record<string, string>) => {
        const params = new URLSearchParams({ select: "id", ...filters });
        const { count } = await supabaseRest(`${table}?${params.toString()}`, {
          method: "HEAD",
          headers: { Prefer: "count=exact" },
        });
        return count;
      };

      const [totalUsers, activeUsers, admins, activeModules, totalPermissions, activityToday] = await Promise.all([
        count("profiles", {}),
        count("profiles", { is_active: "eq.true" }),
        count("profiles", { level: "eq.Administrador" }),
        count("modules", { is_active: "eq.true" }),
        count("module_permissions", {}),
        count("activity_logs", { criado_em: `gte.${startOfDay.toISOString()}` }),
      ]);

      return {
        total_usuarios: totalUsers,
        usuarios_ativos: activeUsers,
        administradores: admins,
        modulos_ativos: activeModules,
        permissoes_concedidas: totalPermissions,
        atividade_hoje: activityToday,
      };
    },
  },
  {
    name: "toggle_module_active",
    description: "Ativa ou desativa um módulo (card) no dashboard do portal.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, is_active: { type: "boolean" } },
      required: ["slug", "is_active"],
    },
    handler: async (args) => {
      const slug = String(args.slug);
      const module_ = await findModuleBySlug(slug);
      await supabaseRest(`modules?slug=eq.${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: { is_active: Boolean(args.is_active) },
      });
      await logActivity("MCP_MODULE_TOGGLE", slug, { name: module_.name, is_active: args.is_active });
      return { slug, is_active: Boolean(args.is_active) };
    },
  },
  {
    name: "update_module",
    description: "Edita metadados de um módulo já cadastrado (nome, descrição, URL, ícone, cor, ordem de exibição). Não cria módulos novos.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        url: { type: "string" },
        icon: { type: "string" },
        color: { type: "string" },
        sort_order: { type: "number" },
      },
      required: ["slug"],
    },
    handler: async (args) => {
      const slug = String(args.slug);
      await findModuleBySlug(slug);
      const patch: Record<string, unknown> = {};
      for (const field of ["name", "description", "url", "icon", "color", "sort_order"] as const) {
        if (args[field] !== undefined) patch[field] = args[field];
      }
      if (Object.keys(patch).length === 0) throw new Error("Informe ao menos um campo para atualizar.");
      await supabaseRest(`modules?slug=eq.${encodeURIComponent(slug)}`, { method: "PATCH", body: patch });
      await logActivity("MCP_MODULE_UPDATE", slug, patch);
      return { slug, updated: patch };
    },
  },
  {
    name: "grant_module_permission",
    description: "Concede a um colaborador acesso explícito a um módulo. Necessário apenas para usuários que já têm restrições (linhas em module_permissions); sem nenhuma restrição, o acesso já é pleno por padrão.",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" }, module_slug: { type: "string" } },
      required: ["email", "module_slug"],
    },
    handler: async (args) => {
      const email = String(args.email);
      const moduleSlug = String(args.module_slug);
      const user = await findUserByEmail(email);
      await findModuleBySlug(moduleSlug);

      const { data: existing } = await supabaseRest<Array<{ id: string }>>(
        `module_permissions?select=id&user_id=eq.${user.id}&module_slug=eq.${encodeURIComponent(moduleSlug)}&limit=1`,
      );
      if (existing?.length) {
        await supabaseRest(`module_permissions?id=eq.${existing[0].id}`, {
          method: "PATCH",
          body: { can_access: true },
        });
      } else {
        await supabaseRest("module_permissions", {
          method: "POST",
          body: [{ user_id: user.id, module_slug: moduleSlug, can_access: true }],
        });
      }
      await logActivity("MCP_PERMISSION_GRANT", moduleSlug, { email });
      return { email, module_slug: moduleSlug, can_access: true };
    },
  },
  {
    name: "revoke_module_permission",
    description: "Revoga o acesso explícito de um colaborador a um módulo (grava can_access=false; não afeta usuários sem nenhuma restrição cadastrada).",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" }, module_slug: { type: "string" } },
      required: ["email", "module_slug"],
    },
    handler: async (args) => {
      const email = String(args.email);
      const moduleSlug = String(args.module_slug);
      const user = await findUserByEmail(email);
      await findModuleBySlug(moduleSlug);

      const { data: existing } = await supabaseRest<Array<{ id: string }>>(
        `module_permissions?select=id&user_id=eq.${user.id}&module_slug=eq.${encodeURIComponent(moduleSlug)}&limit=1`,
      );
      if (existing?.length) {
        await supabaseRest(`module_permissions?id=eq.${existing[0].id}`, {
          method: "PATCH",
          body: { can_access: false },
        });
      } else {
        await supabaseRest("module_permissions", {
          method: "POST",
          body: [{ user_id: user.id, module_slug: moduleSlug, can_access: false }],
        });
      }
      await logActivity("MCP_PERMISSION_REVOKE", moduleSlug, { email });
      return { email, module_slug: moduleSlug, can_access: false };
    },
  },
  {
    name: "set_user_level",
    description: "Altera o nível de acesso de um colaborador (Administrador / Lider / Colaborador). Cuidado: Administrador dá acesso aos painéis Admin/CEO/Logs.",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" }, level: { type: "string", enum: LEVELS } },
      required: ["email", "level"],
    },
    handler: async (args) => {
      const email = String(args.email);
      const level = String(args.level);
      if (!LEVELS.includes(level as typeof LEVELS[number])) throw new Error(`level inválido: ${level}`);
      const user = await findUserByEmail(email);
      await supabaseRest(`profiles?id=eq.${user.id}`, { method: "PATCH", body: { level } });
      await logActivity("MCP_USER_LEVEL_CHANGE", email, { from: user.level, to: level });
      return { email, level };
    },
  },
  {
    name: "toggle_user_active",
    description: "Ativa ou desativa o acesso de um colaborador ao portal (não exclui a conta, apenas bloqueia/libera login).",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" }, is_active: { type: "boolean" } },
      required: ["email", "is_active"],
    },
    handler: async (args) => {
      const email = String(args.email);
      const user = await findUserByEmail(email);
      await supabaseRest(`profiles?id=eq.${user.id}`, {
        method: "PATCH",
        body: { is_active: Boolean(args.is_active) },
      });
      await logActivity("MCP_USER_ACTIVE_TOGGLE", email, { is_active: args.is_active });
      return { email, is_active: Boolean(args.is_active) };
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ─── JSON-RPC / MCP plumbing (Streamable HTTP, sem estado de sessão) ──────

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg: Record<string, unknown>) {
  const { method, id, params } = msg as { method?: string; id?: unknown; params?: Record<string, unknown> };

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) {
      return rpcResult(id, { content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }], isError: true });
    }
    try {
      const result = await tool.handler((params?.arguments as Record<string, unknown>) ?? {});
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcResult(id, { content: [{ type: "text", text: `Erro: ${message}` }], isError: true });
    }
  }

  if (id === undefined) return null; // notificação desconhecida: ignora
  return rpcError(id, -32601, `Método não suportado: ${method}`);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "not_found" }, 404);
  }

  if (!(await isAuthorized(req, url))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(body)) {
    const results = (await Promise.all(body.map((m) => handleMessage(m as Record<string, unknown>)))).filter(
      (r) => r !== null,
    );
    if (results.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return jsonResponse(results);
  }

  const result = await handleMessage(body as Record<string, unknown>);
  if (result === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return jsonResponse(result);
});
