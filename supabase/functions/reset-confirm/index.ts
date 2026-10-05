// Recuperação de senha, passo 2: confere os DOIS códigos (e-mail + WhatsApp), grava a senha
// nova pelo servidor e derruba as sessões abertas. NÃO abre sessão: a pessoa entra depois
// pelo login normal (e-mail + senha + código). verify_jwt = false.
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'

const MAX_ATTEMPTS = 5
const MIN_PASSWORD = 8
const INVALID = 'Códigos inválidos ou expirados. Peça novos códigos.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const challengeId = body?.challenge_id
    const emailCode = String(body?.email_code ?? '').replace(/\D/g, '')
    const wppCode = String(body?.whatsapp_code ?? '').replace(/\D/g, '')
    const password = body?.new_password

    if (typeof challengeId !== 'string' || !UUID.test(challengeId) || emailCode.length !== 6 || wppCode.length !== 6) {
      return json({ error: INVALID }, 400)
    }
    // Valida a senha ANTES de consumir uma tentativa.
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200) {
      return json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.` }, 400)
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('password_reset_confirm', {
      p_challenge: challengeId, p_email_code: emailCode, p_wpp_code: wppCode, p_max: MAX_ATTEMPTS,
    })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data

    if (r?.status === 'locked') return json({ error: 'Muitas tentativas. Peça novos códigos.' }, 429)
    if (r?.status !== 'ok') return json({ error: INVALID }, 401)

    const { error: updErr } = await admin.auth.admin.updateUserById(r.user_id, { password })
    if (updErr) {
      console.error('reset-confirm: updateUserById falhou:', updErr.message)
      return json({ error: 'Não foi possível salvar a nova senha. Peça novos códigos e tente de novo.' }, 500)
    }
    await admin.rpc('password_reset_revoke_sessions', { p_user: r.user_id })

    return json({ success: true })
  } catch (err) {
    console.error('reset-confirm:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível redefinir a senha. Tente novamente.' }, 500)
  }
})
