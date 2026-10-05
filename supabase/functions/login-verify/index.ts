// Passo 2 do login com 2FA: confere o código do WhatsApp (atômico, no banco) e devolve a
// sessão. verify_jwt = false (chamada antes do login).
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'
import { mintSession } from '../_shared/two-factor.ts'

const MAX_ATTEMPTS = 5
const INVALID = 'Código inválido ou expirado. Entre novamente para receber um novo código.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { challenge_id, code: rawCode } = await req.json()
    const code = String(rawCode ?? '').replace(/\D/g, '')
    if (typeof challenge_id !== 'string' || !UUID.test(challenge_id) || code.length !== 6) {
      return json({ error: INVALID }, 400)
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('two_factor_verify', {
      p_challenge: challenge_id, p_code: code, p_max: MAX_ATTEMPTS,
    })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data

    if (r?.status === 'locked') return json({ error: 'Muitas tentativas. Entre novamente para receber um novo código.' }, 429)
    if (r?.status !== 'ok') return json({ error: INVALID }, 401)

    const session = await mintSession(admin, r.user_id)
    if (!session) return json({ error: INVALID }, 401)
    return json(session)
  } catch (err) {
    console.error('login-verify:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível validar o código. Tente novamente.' }, 500)
  }
})
