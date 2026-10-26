// Passo 3 da recuperação de senha com 2FA: confere que os dois códigos (e-mail e WhatsApp) já
// foram confirmados para o desafio, troca a senha via Admin API, derruba todas as sessões já
// abertas da conta na hora (FR03) e registra em activity_logs. Nunca abre sessão — a pessoa
// precisa logar pelo fluxo normal (e-mail + senha + 2FA) depois (FR07).
// verify_jwt = false (chamada antes do login).
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'

const MIN_PASSWORD_LENGTH = 8
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INVALID = 'Não foi possível concluir. Peça um novo link de recuperação.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { challenge_id, new_password } = await req.json()
    if (typeof challenge_id !== 'string' || !UUID.test(challenge_id)) {
      return json({ error: INVALID }, 400)
    }
    if (typeof new_password !== 'string' || new_password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400)
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('credential_complete', { p_challenge: challenge_id })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data

    if (r?.status === 'incomplete') {
      return json({ error: 'Confirme os dois códigos (e-mail e WhatsApp) antes de definir a nova senha.' }, 409)
    }
    if (r?.status !== 'ok' || !r.user_id) {
      return json({ error: INVALID }, 401)
    }

    const { error: updError } = await admin.auth.admin.updateUserById(r.user_id, { password: new_password })
    if (updError) {
      console.error('reset-complete: updateUserById falhou:', updError.message)
      return json({ error: 'Não foi possível definir a nova senha agora. Tente novamente.' }, 500)
    }

    await admin.from('profiles').update({ pwd_changed_at: new Date().toISOString() }).eq('id', r.user_id)

    const { error: signOutError } = await admin.auth.admin.signOut(r.user_id, 'global')
    if (signOutError) {
      // Senha já foi trocada — não desfaz. Só registra: pode sobrar uma sessão antiga até expirar.
      console.error('reset-complete: signOut global falhou:', signOutError.message)
    }

    const { data: profile } = await admin.from('profiles').select('name, email').eq('id', r.user_id).maybeSingle()
    await admin.from('activity_logs').insert({
      user_id: r.user_id,
      user_name: profile?.name ?? null,
      user_email: profile?.email ?? null,
      action: 'password_reset',
      target: profile?.email ?? null,
    })

    return json({ ok: true })
  } catch (err) {
    console.error('reset-complete:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível concluir agora. Tente novamente.' }, 500)
  }
})
