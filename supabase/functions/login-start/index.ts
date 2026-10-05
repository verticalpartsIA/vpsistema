// Passo 1 do login com 2FA: e-mail + senha conferidos no SERVIDOR; se corretos, envia o
// código por WhatsApp. verify_jwt = false (chamada antes do login).
//
// Respostas:
//   { mode: 'legacy' }                      2FA ainda não ativo para este usuário -> front usa o login direto
//   { mode: 'code', challenge_id, phone_hint } código enviado por WhatsApp
//   { mode: 'session', access_token, ... }  conta isenta de 2FA (senha correta)
//   401 e-mail/senha inválidos | 403 sem celular | 429 muitas tentativas | 502 falha no envio
import { sendWhatsAppText } from '../_shared/whatsapp.ts'
import { adminClient, clientIp, corsHeaders, json } from '../_shared/whatsapp-login.ts'
import { mintSession } from '../_shared/two-factor.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, password } = await req.json()
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password
        || email.length > 254 || password.length > 200) {
      return json({ error: 'E-mail ou senha inválidos.' }, 401)
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('two_factor_start', {
      p_email: email, p_password: password, p_ip: clientIp(req),
    })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data
    const status = r?.status

    if (status === 'legacy') return json({ mode: 'legacy' })
    if (status === 'locked') return json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }, 429)
    if (status === 'no_phone') {
      return json({ error: 'Seu cadastro não tem celular. Fale com o administrador.', code: 'no_phone' }, 403)
    }

    if (status === 'exempt') {
      const session = await mintSession(admin, r.user_id)
      if (!session) return json({ error: 'E-mail ou senha inválidos.' }, 401)
      return json({ mode: 'session', ...session })
    }

    if (status === 'ok') {
      const phone: string = r.phone
      try {
        await sendWhatsAppText(
          phone,
          `*VerticalParts* — seu código de acesso é *${r.code}*.\nVale por 5 minutos. Se não foi você que tentou entrar, troque sua senha e avise o administrador.`,
        )
      } catch (e) {
        // Nunca loga o código. Inutiliza o desafio para não ficar pendente.
        console.error('login-start: falha no envio:', String((e as Error)?.message || e))
        await admin.from('two_factor_challenges').update({ used_at: new Date().toISOString() }).eq('id', r.challenge_id)
        return json({ error: 'Não foi possível enviar o código por WhatsApp. Tente novamente em instantes.' }, 502)
      }
      const ddd = phone.slice(0, 2)
      return json({
        mode: 'code',
        challenge_id: r.challenge_id,
        phone_hint: `(${ddd}) •••••-${phone.slice(-4)}`,
      })
    }

    return json({ error: 'E-mail ou senha inválidos.' }, 401)
  } catch (err) {
    console.error('login-start:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível entrar agora. Tente novamente.' }, 500)
  }
})
