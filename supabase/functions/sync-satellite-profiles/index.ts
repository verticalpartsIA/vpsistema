/**
 * vpsistema → satélites — Sync de dados de colaborador
 *
 * Propaga nome, departamento, celular e status ativo do profile do
 * vpsistema pros satélites com Auth/perfil próprio, sempre que um profile
 * já existente muda. NÃO cria conta nova — provisionamento inicial continua
 * acontecendo no sso-proxy/provision-module-user/invite-user. Esta function
 * só ATUALIZA quem já existe, então renomear, trocar departamento, adicionar
 * celular ou inativar em vpsistema passa a refletir em todo lugar sem
 * varredura manual.
 *
 * Substitui sync-user-vprequisicoes (cobria só VPRequisições). Cada
 * satélite tem schema próprio — descoberto inspecionando as tabelas reais
 * antes de escrever isto, não por suposição:
 *   - VP Requisições (profiles): email, full_name, department, active,
 *     whatsapp_number.
 *   - Propostas (perfis): email, nome, departamento, ativo — sem coluna de
 *     telefone.
 *   - Pós-Venda 360 (profiles): SEM coluna de email nem de status ativo —
 *     linha é achada via user_id (resolvido pelo e-mail no GoTrue), e
 *     inatividade vira ban no auth.users (não existe flag local).
 *   - Visitas e Brindes (profiles): só name + email — sem departamento nem
 *     celular; inatividade também vira ban no auth.users.
 *   - VP Catraca: NÃO tratado aqui de propósito. Schema (usuarios/cadastros)
 *     é de controle de acesso físico e não documentado o suficiente pra
 *     mexer às cegas (mesma cautela já adotada em delete-user/TRANSACTION_CHECKS
 *     pro mesmo satélite) — ver acompanhamento.
 *
 * Só usa fetch() direto contra REST/GoTrue — de propósito, sem
 * @supabase/supabase-js: o deploy desta function roda com --no-remote (via
 * Management API), que rejeita imports remotos tipo esm.sh em boot
 * ("A remote specifier was requested... but --no-remote is specified").
 *
 * Chamada por trigger Postgres em public.profiles do vpsistema
 * (trg_sync_profile_to_satellites). Autenticação: x-sync-secret validado
 * via RPC public.verify_satellite_sync_secret (Vault) — o segredo nunca
 * fica em texto puro em código/migration versionados.
 */

const VPSISTEMA_URL = Deno.env.get('SUPABASE_URL') ?? 'https://ubdkoqxfwcraftesgmbw.supabase.co'
const VPSISTEMA_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-sync-secret',
}

interface SyncBody {
  email?: string
  name?: string
  department?: string | null
  celular?: string | null
  is_active?: boolean
}

// DDI 55 pro padrão de celular do vpsistema (só dígitos, sem DDI) — cada
// satélite com coluna de telefone guarda o número já com DDI.
function celularComDDI(celular: string | null | undefined): string | null {
  const digits = (celular ?? '').replace(/\D/g, '')
  if (!digits) return null
  return digits.startsWith('55') ? digits : `55${digits}`
}

const PERMANENT_BAN = '876000h' // ~100 anos — "banido" pra satélites sem coluna própria de status ativo

type SyncResult = { platform: string; status: 'ok' | 'skipped' | 'not_found' | 'error'; detail?: string }

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delaysMs = [500, 1500, 4000]): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[i] ?? delaysMs[delaysMs.length - 1]))
      }
    }
  }
  throw lastErr
}

// GoTrue admin não tem "get user by email" direto — pagina listUsers como o
// _shared/platforms.ts findUserByEmail (mesma lógica, via fetch puro aqui).
// Traz banned_until junto: a reconciliação noturna chama isto pra TODO
// profile de uma vez, e sem saber o estado atual ela chamava banAuthUser
// incondicionalmente pra todo mundo — 39 perfis x múltiplas chamadas de
// admin API em paralelo estourou o rate limit do GoTrue dos satélites
// (erro real em produção, 2026-09-21). Sabendo o estado atual, só escreve
// quando precisa mudar.
async function findAuthUserByEmail(
  url: string,
  key: string,
  email: string,
): Promise<{ id: string; banned_until?: string | null } | null> {
  const perPage = 1000
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error(`listUsers falhou: ${await res.text()}`)
    const data = await res.json()
    const users: Array<{ id: string; email?: string; banned_until?: string | null }> = data?.users ?? []
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (users.length < perPage) return null
  }
}

function isCurrentlyBanned(bannedUntil?: string | null): boolean {
  if (!bannedUntil) return false
  return new Date(bannedUntil).getTime() > Date.now()
}

// Só chama a admin API de fato quando o estado atual diverge do desejado —
// ver comentário em findAuthUserByEmail sobre o rate limit que isto evita.
async function banAuthUser(
  url: string,
  key: string,
  userId: string,
  isActive: boolean,
  currentlyBanned: boolean,
): Promise<void> {
  if (isActive === !currentlyBanned) return
  await withRetry(async () => {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ban_duration: isActive ? 'none' : PERMANENT_BAN }),
    })
    if (!res.ok) throw new Error(`ban/unban falhou: ${await res.text()}`)
  })
}

async function syncVPRequisicoes(body: SyncBody): Promise<SyncResult> {
  const url = Deno.env.get('SB_VPREQUISICAO_URL')
  const key = Deno.env.get('VPREQ_SERVICE_KEY')
  if (!url || !key) return { platform: 'VP Requisições', status: 'skipped' }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const findRes = await fetch(
    `${url}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(body.email!)}&limit=1`,
    { headers },
  )
  if (!findRes.ok) return { platform: 'VP Requisições', status: 'error', detail: await findRes.text() }
  const existing = (await findRes.json())?.[0]
  if (!existing) return { platform: 'VP Requisições', status: 'not_found' }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.full_name = body.name
  if (body.department !== undefined) patch.department = body.department
  if (body.is_active !== undefined) patch.active = body.is_active
  if (body.celular !== undefined) patch.whatsapp_number = celularComDDI(body.celular)
  if (Object.keys(patch).length === 0) return { platform: 'VP Requisições', status: 'skipped' }

  const upd = await fetch(`${url}/rest/v1/profiles?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!upd.ok) return { platform: 'VP Requisições', status: 'error', detail: await upd.text() }
  return { platform: 'VP Requisições', status: 'ok' }
}

async function syncPropostas(body: SyncBody): Promise<SyncResult> {
  const url = Deno.env.get('SB_PROPOSTAS_URL')
  const key = Deno.env.get('PROPOSTAS_SERVICE_KEY') ?? Deno.env.get('SB_PROPOSTAS_SERVICE_KEY')
  if (!url || !key) return { platform: 'Propostas', status: 'skipped' }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const findRes = await fetch(
    `${url}/rest/v1/perfis?select=id&email=eq.${encodeURIComponent(body.email!)}&limit=1`,
    { headers },
  )
  if (!findRes.ok) return { platform: 'Propostas', status: 'error', detail: await findRes.text() }
  const existing = (await findRes.json())?.[0]
  if (!existing) return { platform: 'Propostas', status: 'not_found' }

  // Sem coluna de celular neste satélite — não há o que mapear além destes.
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.nome = body.name
  if (body.department !== undefined) patch.departamento = body.department
  if (body.is_active !== undefined) patch.ativo = body.is_active
  if (Object.keys(patch).length === 0) return { platform: 'Propostas', status: 'skipped' }

  const upd = await fetch(`${url}/rest/v1/perfis?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!upd.ok) return { platform: 'Propostas', status: 'error', detail: await upd.text() }
  return { platform: 'Propostas', status: 'ok' }
}

async function syncPosVenda360(body: SyncBody): Promise<SyncResult> {
  const url = Deno.env.get('SB_POSVENDA360_URL')
  const key = Deno.env.get('PV360_SERVICE_KEY') ?? Deno.env.get('SB_POSVENDA360_SERVICE_KEY')
  if (!url || !key) return { platform: 'Pós-Venda 360', status: 'skipped' }

  const authUser = await findAuthUserByEmail(url, key, body.email!)
  if (!authUser) return { platform: 'Pós-Venda 360', status: 'not_found' }

  if (body.is_active !== undefined) {
    await banAuthUser(url, key, authUser.id, body.is_active, isCurrentlyBanned(authUser.banned_until))
  }

  // Sem coluna de e-mail em profiles — a linha é achada por user_id, não
  // por email (diferente de todos os outros satélites).
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.display_name = body.name
  if (body.department !== undefined) patch.departamento = body.department
  if (body.celular !== undefined) patch.telefone = celularComDDI(body.celular)
  if (Object.keys(patch).length > 0) {
    const upd = await fetch(`${url}/rest/v1/profiles?user_id=eq.${authUser.id}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
    if (!upd.ok) return { platform: 'Pós-Venda 360', status: 'error', detail: await upd.text() }
  }
  return { platform: 'Pós-Venda 360', status: 'ok' }
}

async function syncVisitas(body: SyncBody): Promise<SyncResult> {
  const url = Deno.env.get('SB_VISITAS_URL')
  const key = Deno.env.get('VISITAS_SERVICE_KEY') ?? Deno.env.get('SB_VISITAS_SERVICE_KEY')
  if (!url || !key) return { platform: 'Visitas e Brindes', status: 'skipped' }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  // profiles.id aqui é o mesmo uuid do auth.users (padrão do satélite, só
  // uma tabela sem user_id separado) — serve tanto pra achar a linha quanto
  // pra banir/desbanir a conta.
  const findRes = await fetch(
    `${url}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(body.email!)}&limit=1`,
    { headers },
  )
  if (!findRes.ok) return { platform: 'Visitas e Brindes', status: 'error', detail: await findRes.text() }
  const profile = (await findRes.json())?.[0]
  if (!profile) return { platform: 'Visitas e Brindes', status: 'not_found' }

  if (body.is_active !== undefined) {
    // Sem listUsers aqui — já temos o id via profiles, só confere o
    // banned_until atual com um get-by-id (1 chamada, não paginado).
    const authRes = await fetch(`${url}/auth/v1/admin/users/${profile.id}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    const authUser = authRes.ok ? await authRes.json() : null
    const bannedUntil = authUser?.banned_until ?? authUser?.user?.banned_until
    await banAuthUser(url, key, profile.id, body.is_active, isCurrentlyBanned(bannedUntil))
  }

  // Sem coluna de departamento nem celular neste satélite.
  if (body.name !== undefined) {
    const upd = await fetch(`${url}/rest/v1/profiles?id=eq.${profile.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ name: body.name }),
    })
    if (!upd.ok) return { platform: 'Visitas e Brindes', status: 'error', detail: await upd.text() }
  }
  return { platform: 'Visitas e Brindes', status: 'ok' }
}

const SYNC_TARGETS = [syncVPRequisicoes, syncPropostas, syncPosVenda360, syncVisitas]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = req.headers.get('x-sync-secret')
  if (!VPSISTEMA_SERVICE_KEY) {
    console.error('[sync-satellite-profiles] SUPABASE_SERVICE_ROLE_KEY não configurado')
    return json({ error: 'Function not configured' }, 500)
  }

  const rpcRes = await fetch(`${VPSISTEMA_URL}/rest/v1/rpc/verify_satellite_sync_secret`, {
    method: 'POST',
    headers: {
      apikey: VPSISTEMA_SERVICE_KEY,
      Authorization: `Bearer ${VPSISTEMA_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ candidate: secret }),
  })
  const validSecret = rpcRes.ok ? await rpcRes.json() : false
  if (!validSecret) {
    console.warn('[sync-satellite-profiles] secret inválido')
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: SyncBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body.email) return json({ error: 'email obrigatório' }, 400)

  const results = await Promise.all(
    SYNC_TARGETS.map((sync) =>
      sync(body).catch((e) => ({ platform: sync.name, status: 'error' as const, detail: e?.message || String(e) })),
    ),
  )

  console.log(`[sync-satellite-profiles] ${body.email}`, results)
  return json({ ok: true, results }, 200)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
