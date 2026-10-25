/**
 * vpsistema → satélites — Reconciliação noturna
 *
 * Rede de segurança pro sync em tempo real (trigger trg_sync_profile_to_satellites
 * → sync-satellite-profiles): reaplica nome/departamento/celular/status ativo
 * de TODO profile com e-mail contra os 4 satélites, pra pegar qualquer
 * webhook perdido (net.http_post sem retry, deploy de function fora do ar
 * no momento do UPDATE, etc.). Idempotente — reaplicar o mesmo valor não
 * muda nada nos satélites onde já está em dia.
 *
 * Processa perfis ATIVOS e INATIVOS (não só ativos): o caso mais crítico de
 * detectar é justamente uma inativação que não propagou — se só reconciliasse
 * quem está ativo, uma conta que devia estar banida em algum satélite e não
 * foi nunca seria corrigida aqui.
 *
 * NÃO delega mais pra sync-satellite-profiles por perfil (v1 fazia isso).
 * Rodou todo santo dia desde 2026-09-21 e SEMPRE bateu rate limit do GoTrue
 * (10 de 40 perfis falhando ainda hoje, 2026-10-25) — a v2 só cortou
 * escritas de ban desnecessárias, mas cada perfil ainda disparava 1
 * listUsers (Pós-Venda 360) + 1 get-by-id (Visitas) pro GoTrue admin API,
 * e são ESSAS leituras que estouram o limite, não as escritas. A correção
 * de verdade é buscar a lista de usuários de cada satélite UMA VEZ por
 * rodada (não uma vez por colaborador) e resolver tudo em memória — por
 * isso esta function tem sua própria lógica de campo por satélite (mesmo
 * mapeamento de sync-satellite-profiles, só que em lote).
 *
 * Chamada pelo pg_cron job reconcile-satellite-profiles-nightly,
 * diariamente às 03:00 BRT. Mesma autenticação por Vault que
 * sync-satellite-profiles — nunca exposta como endpoint público sem o
 * secret certo.
 */

const VPSISTEMA_URL = Deno.env.get('SUPABASE_URL') ?? 'https://ubdkoqxfwcraftesgmbw.supabase.co'
const VPSISTEMA_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-sync-secret',
}

interface VpProfile {
  email: string
  name: string | null
  department: string | null
  celular: string | null
  is_active: boolean | null
}

type SatResult = { ok: number; skipped: number; error: number; errors: string[] }

function newResult(): SatResult {
  return { ok: 0, skipped: 0, error: 0, errors: [] }
}

function celularComDDI(celular: string | null | undefined): string | null {
  const digits = (celular ?? '').replace(/\D/g, '')
  if (!digits) return null
  return digits.startsWith('55') ? digits : `55${digits}`
}

const PERMANENT_BAN = '876000h'

function isCurrentlyBanned(bannedUntil?: string | null): boolean {
  if (!bannedUntil) return false
  return new Date(bannedUntil).getTime() > Date.now()
}

// Busca TODOS os usuários do GoTrue de um satélite de uma vez (paginado,
// mas em geral 1 página só — nenhum destes projetos tem >1000 contas).
// Chamada 1x por satélite por rodada, nunca 1x por perfil — é exatamente
// isso que evita o rate limit que as versões anteriores batiam todo dia.
async function fetchAllAuthUsers(
  url: string,
  key: string,
): Promise<Map<string, { id: string; banned_until?: string | null }>> {
  const map = new Map<string, { id: string; banned_until?: string | null }>()
  const perPage = 1000
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error(`listUsers falhou: ${await res.text()}`)
    const data = await res.json()
    const users: Array<{ id: string; email?: string; banned_until?: string | null }> = data?.users ?? []
    for (const u of users) {
      if (u.email) map.set(u.email.toLowerCase(), { id: u.id, banned_until: u.banned_until })
    }
    if (users.length < perPage) break
  }
  return map
}

async function banAuthUser(url: string, key: string, userId: string, isActive: boolean): Promise<void> {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ban_duration: isActive ? 'none' : PERMANENT_BAN }),
  })
  if (!res.ok) throw new Error(`ban/unban falhou: ${await res.text()}`)
}

async function reconcileVPRequisicoes(vpProfiles: VpProfile[]): Promise<SatResult> {
  const result = newResult()
  const url = Deno.env.get('SB_VPREQUISICAO_URL')
  const key = Deno.env.get('VPREQ_SERVICE_KEY')
  if (!url || !key) return result

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const res = await fetch(
    `${url}/rest/v1/profiles?select=id,email,full_name,department,active,whatsapp_number`,
    { headers },
  )
  if (!res.ok) throw new Error(`listar profiles falhou: ${await res.text()}`)
  const rows: Array<{ id: string; email: string; full_name: string | null; department: string | null; active: boolean | null; whatsapp_number: string | null }> =
    await res.json()
  const byEmail = new Map(rows.map((r) => [r.email?.toLowerCase(), r]))

  for (const profile of vpProfiles) {
    const row = byEmail.get(profile.email.toLowerCase())
    if (!row) { result.skipped++; continue }

    const desiredCelular = celularComDDI(profile.celular)
    const desiredActive = profile.is_active ?? true
    const patch: Record<string, unknown> = {}
    if (profile.name !== row.full_name) patch.full_name = profile.name
    if (profile.department !== row.department) patch.department = profile.department
    if (desiredActive !== row.active) patch.active = desiredActive
    if (desiredCelular !== row.whatsapp_number) patch.whatsapp_number = desiredCelular
    if (Object.keys(patch).length === 0) { result.skipped++; continue }

    try {
      const upd = await fetch(`${url}/rest/v1/profiles?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      })
      if (!upd.ok) throw new Error(await upd.text())
      result.ok++
    } catch (e) {
      result.error++
      result.errors.push(`${profile.email}: ${e?.message || e}`)
    }
  }
  return result
}

async function reconcilePropostas(vpProfiles: VpProfile[]): Promise<SatResult> {
  const result = newResult()
  const url = Deno.env.get('SB_PROPOSTAS_URL')
  const key = Deno.env.get('PROPOSTAS_SERVICE_KEY') ?? Deno.env.get('SB_PROPOSTAS_SERVICE_KEY')
  if (!url || !key) return result

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const res = await fetch(`${url}/rest/v1/perfis?select=id,email,nome,departamento,ativo`, { headers })
  if (!res.ok) throw new Error(`listar perfis falhou: ${await res.text()}`)
  const rows: Array<{ id: string; email: string; nome: string | null; departamento: string | null; ativo: boolean | null }> =
    await res.json()
  const byEmail = new Map(rows.map((r) => [r.email?.toLowerCase(), r]))

  for (const profile of vpProfiles) {
    const row = byEmail.get(profile.email.toLowerCase())
    if (!row) { result.skipped++; continue }

    const desiredActive = profile.is_active ?? true
    const patch: Record<string, unknown> = {}
    if (profile.name !== row.nome) patch.nome = profile.name
    if (profile.department !== row.departamento) patch.departamento = profile.department
    if (desiredActive !== row.ativo) patch.ativo = desiredActive
    if (Object.keys(patch).length === 0) { result.skipped++; continue }

    try {
      const upd = await fetch(`${url}/rest/v1/perfis?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      })
      if (!upd.ok) throw new Error(await upd.text())
      result.ok++
    } catch (e) {
      result.error++
      result.errors.push(`${profile.email}: ${e?.message || e}`)
    }
  }
  return result
}

async function reconcilePosVenda360(vpProfiles: VpProfile[]): Promise<SatResult> {
  const result = newResult()
  const url = Deno.env.get('SB_POSVENDA360_URL')
  const key = Deno.env.get('PV360_SERVICE_KEY') ?? Deno.env.get('SB_POSVENDA360_SERVICE_KEY')
  if (!url || !key) return result

  // 1 listUsers pra TODA a rodada, não 1 por perfil — é essa a mudança que
  // tira o rate limit (ver comentário no topo do arquivo).
  const authByEmail = await fetchAllAuthUsers(url, key)

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const res = await fetch(`${url}/rest/v1/profiles?select=id,user_id,display_name,departamento,telefone`, { headers })
  if (!res.ok) throw new Error(`listar profiles falhou: ${await res.text()}`)
  const rows: Array<{ id: string; user_id: string; display_name: string | null; departamento: string | null; telefone: string | null }> =
    await res.json()
  const byUserId = new Map(rows.map((r) => [r.user_id, r]))

  for (const profile of vpProfiles) {
    const authUser = authByEmail.get(profile.email.toLowerCase())
    if (!authUser) { result.skipped++; continue }

    const desiredActive = profile.is_active ?? true
    try {
      if (desiredActive === isCurrentlyBanned(authUser.banned_until)) {
        await banAuthUser(url, key, authUser.id, desiredActive)
      }

      const row = byUserId.get(authUser.id)
      const desiredCelular = celularComDDI(profile.celular)
      const patch: Record<string, unknown> = {}
      if (row) {
        if (profile.name !== row.display_name) patch.display_name = profile.name
        if (profile.department !== row.departamento) patch.departamento = profile.department
        if (desiredCelular !== row.telefone) patch.telefone = desiredCelular
      }
      if (Object.keys(patch).length > 0) {
        const upd = await fetch(`${url}/rest/v1/profiles?user_id=eq.${authUser.id}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        })
        if (!upd.ok) throw new Error(await upd.text())
      }
      result.ok++
    } catch (e) {
      result.error++
      result.errors.push(`${profile.email}: ${e?.message || e}`)
    }
  }
  return result
}

async function reconcileVisitas(vpProfiles: VpProfile[]): Promise<SatResult> {
  const result = newResult()
  const url = Deno.env.get('SB_VISITAS_URL')
  const key = Deno.env.get('VISITAS_SERVICE_KEY') ?? Deno.env.get('SB_VISITAS_SERVICE_KEY')
  if (!url || !key) return result

  // Idem Pós-Venda 360: 1 listUsers pra pegar banned_until de todo mundo.
  const authByEmail = await fetchAllAuthUsers(url, key)

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const res = await fetch(`${url}/rest/v1/profiles?select=id,email,name`, { headers })
  if (!res.ok) throw new Error(`listar profiles falhou: ${await res.text()}`)
  const rows: Array<{ id: string; email: string; name: string | null }> = await res.json()
  const byEmail = new Map(rows.map((r) => [r.email?.toLowerCase(), r]))

  for (const profile of vpProfiles) {
    const row = byEmail.get(profile.email.toLowerCase())
    if (!row) { result.skipped++; continue }

    const desiredActive = profile.is_active ?? true
    const authUser = authByEmail.get(profile.email.toLowerCase())
    try {
      if (authUser && desiredActive === isCurrentlyBanned(authUser.banned_until)) {
        await banAuthUser(url, key, row.id, desiredActive)
      }
      if (profile.name !== row.name) {
        const upd = await fetch(`${url}/rest/v1/profiles?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ name: profile.name }),
        })
        if (!upd.ok) throw new Error(await upd.text())
      }
      result.ok++
    } catch (e) {
      result.error++
      result.errors.push(`${profile.email}: ${e?.message || e}`)
    }
  }
  return result
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = req.headers.get('x-sync-secret')
  if (!VPSISTEMA_SERVICE_KEY) {
    console.error('[reconcile-satellite-profiles] SUPABASE_SERVICE_ROLE_KEY não configurado')
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
    console.warn('[reconcile-satellite-profiles] secret inválido')
    return json({ error: 'Unauthorized' }, 401)
  }

  const profilesRes = await fetch(
    `${VPSISTEMA_URL}/rest/v1/profiles?select=email,name,department,celular,is_active&email=not.is.null`,
    { headers: { apikey: VPSISTEMA_SERVICE_KEY, Authorization: `Bearer ${VPSISTEMA_SERVICE_KEY}` } },
  )
  if (!profilesRes.ok) {
    const detail = await profilesRes.text()
    console.error('[reconcile-satellite-profiles] falha ao listar profiles:', detail)
    return json({ error: 'Falha ao listar profiles', detail }, 502)
  }
  const profiles: VpProfile[] = await profilesRes.json()

  const started = Date.now()
  const SATELLITES: Array<[string, (p: VpProfile[]) => Promise<SatResult>]> = [
    ['VP Requisições', reconcileVPRequisicoes],
    ['Propostas', reconcilePropostas],
    ['Pós-Venda 360', reconcilePosVenda360],
    ['Visitas e Brindes', reconcileVisitas],
  ]

  const bySatellite: Record<string, SatResult | { error: string }> = {}
  for (const [name, fn] of SATELLITES) {
    try {
      bySatellite[name] = await fn(profiles)
    } catch (e) {
      bySatellite[name] = { error: e?.message || String(e) }
    }
  }

  const summary = {
    total_profiles: profiles.length,
    duration_ms: Date.now() - started,
    by_satellite: bySatellite,
  }

  console.log('[reconcile-satellite-profiles] resumo:', JSON.stringify(summary))
  return json({ ok: true, summary }, 200)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
