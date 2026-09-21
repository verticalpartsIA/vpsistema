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
 * Chamada pelo pg_cron job reconcile-satellite-profiles-nightly (ver
 * migration 20260921000200_schedule_reconcile_job.sql), diariamente às 03:00
 * BRT. Mesma autenticação por Vault que sync-satellite-profiles — nunca
 * exposta como endpoint público sem o secret certo.
 *
 * Delega a lógica de campo por satélite pra sync-satellite-profiles (um
 * POST por perfil) em vez de duplicá-la aqui — mesma fonte de verdade pro
 * mapeamento de cada satélite, só isso já foi validado em produção.
 */

const VPSISTEMA_URL = Deno.env.get('SUPABASE_URL') ?? 'https://ubdkoqxfwcraftesgmbw.supabase.co'
const VPSISTEMA_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-sync-secret',
}

interface Profile {
  email: string
  name: string | null
  department: string | null
  celular: string | null
  is_active: boolean | null
}

// Concorrência limitada pra não bombardear os 4 satélites (e o GoTrue
// listUsers paginado de cada um) com dezenas de chamadas simultâneas.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
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
  const profiles: Profile[] = await profilesRes.json()

  const started = Date.now()
  // Concorrência baixa de propósito: sync-satellite-profiles agora só
  // escreve no GoTrue quando o ban/unban realmente precisa mudar (ver
  // isCurrentlyBanned), mas ainda faz 1 listUsers por perfil no Pós-Venda
  // 360 — em paralelo alto isso sozinho já estourou rate limit do GoTrue
  // com 39 perfis (produção, 2026-09-21).
  const perProfile = await mapWithConcurrency(profiles, 3, async (profile) => {
    try {
      const res = await fetch(`${VPSISTEMA_URL}/functions/v1/sync-satellite-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret! },
        body: JSON.stringify({
          email: profile.email,
          name: profile.name,
          department: profile.department,
          celular: profile.celular,
          is_active: profile.is_active ?? true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      return { email: profile.email, ok: res.ok, results: body?.results ?? body }
    } catch (e) {
      return { email: profile.email, ok: false, error: e?.message || String(e) }
    }
  })

  const errors = perProfile.filter((r) => !r.ok)
  const summary = {
    total_profiles: profiles.length,
    with_errors: errors.length,
    duration_ms: Date.now() - started,
  }

  console.log('[reconcile-satellite-profiles] resumo:', summary)
  if (errors.length > 0) {
    console.warn('[reconcile-satellite-profiles] perfis com erro:', JSON.stringify(errors))
  }

  return json({ ok: true, summary, errors }, 200)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
