// Confirma o código de WhatsApp de um pedido de recuperação de senha (passo 2b). Mesma mensagem
// genérica para challenge_id inexistente e código errado — nunca diferencia os dois.
// verify_jwt = false (chamada antes do login).
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'

const MAX_ATTEMPTS = 5
const INVALID = 'Código inválido ou expirado. Peça um novo link de recuperação.'
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
    const { data, error } = await admin.rpc('credential_confirm_whatsapp', {
      p_challenge: challenge_id, p_code: code, p_max: MAX_ATTEMPTS,
    })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data

    if (r?.status === 'locked') return json({ error: 'Muitas tentativas. Peça um novo link de recuperação.' }, 429)
    if (r?.status !== 'ok') return json({ error: INVALID }, 401)

    return json({ ok: true })
  } catch (err) {
    console.error('reset-confirm-whatsapp:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível confirmar o código agora. Tente novamente.' }, 500)
  }
})
