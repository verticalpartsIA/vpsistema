/**
 * vpsistema → VPRequisições — Sync de dados de colaborador
 *
 * Propaga nome, departamento, celular (-> whatsapp_number) e status ativo
 * do profile do vpsistema pro profile já existente no VPRequisições.
 *
 * NÃO cria conta nova — provisionamento inicial continua acontecendo no
 * primeiro clique em "Abrir sistema" (sso-proxy) ou na concessão de acesso
 * ao módulo (provision-module-user). Esta função só ATUALIZA quem já
 * existe lá, então mudanças em vpsistema (renomear, trocar departamento,
 * preencher celular, inativar) passam a refletir sem precisar de uma
 * varredura manual.
 *
 * Chamada por trigger Postgres em public.profiles do vpsistema
 * (trg_sync_profile_to_vprequisicoes).
 * Secret: x-sync-secret
 */

const VPREQ_URL = 'https://vvgcrhtmzvssfdazkkzk.supabase.co'
const VPREQ_KEY = Deno.env.get('VPREQ_SERVICE_KEY') ?? ''
const SYNC_SECRET = Deno.env.get('VPREQ_SYNC_SECRET') ?? 'vpreq-sync-2026-secret'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const secret = req.headers.get('x-sync-secret')
  if (secret !== SYNC_SECRET) {
    console.warn('[sync-vprequisicoes] secret inválido')
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!VPREQ_KEY) {
    console.error('[sync-vprequisicoes] VPREQ_SERVICE_KEY não configurado')
    return json({ error: 'App not configured' }, 500)
  }

  let body: SyncBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { email, name, department, celular, is_active } = body
  if (!email) {
    return json({ error: 'email obrigatório' }, 400)
  }

  const headers = {
    apikey: VPREQ_KEY,
    Authorization: `Bearer ${VPREQ_KEY}`,
    'Content-Type': 'application/json',
  }

  // Só atualiza quem já existe lá — criação continua no fluxo de SSO/provisionamento.
  const findRes = await fetch(
    `${VPREQ_URL}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers },
  )
  if (!findRes.ok) {
    console.error('[sync-vprequisicoes] busca falhou:', await findRes.text())
    return json({ error: 'Falha ao buscar perfil' }, 502)
  }
  const rows = await findRes.json()
  const existing = rows?.[0]
  if (!existing) {
    console.log(`[sync-vprequisicoes] ${email} ainda não existe no VPRequisições — pulando`)
    return json({ ok: true, skipped: true }, 200)
  }

  const patch: Record<string, unknown> = {}
  if (name !== undefined) patch.full_name = name
  if (department !== undefined) patch.department = department
  if (is_active !== undefined) patch.active = is_active
  if (celular !== undefined) {
    // vpsistema guarda só dígitos, sem DDI (55); VPRequisições guarda com DDI.
    const digits = (celular ?? '').replace(/\D/g, '')
    patch.whatsapp_number = digits ? (digits.startsWith('55') ? digits : `55${digits}`) : null
  }

  if (Object.keys(patch).length === 0) {
    return json({ ok: true, skipped: true, reason: 'nothing to update' }, 200)
  }

  const updateRes = await fetch(`${VPREQ_URL}/rest/v1/profiles?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!updateRes.ok) {
    console.error('[sync-vprequisicoes] update falhou:', await updateRes.text())
    return json({ error: 'Falha ao atualizar perfil' }, 502)
  }

  console.log(`[sync-vprequisicoes] atualizado: ${email}`, patch)
  return json({ ok: true, updated: Object.keys(patch) }, 200)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
