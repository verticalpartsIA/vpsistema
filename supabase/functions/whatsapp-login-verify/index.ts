// Passo 2 do login por código: confere o código recebido no WhatsApp e devolve
// a sessão (access_token + refresh_token) para o front fazer setSession().
// Chamada ANTES do login → deploy com verify_jwt = false.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { normalizePhoneBR } from '../_shared/whatsapp.ts'
import {
  CODE_TTL_MS, MAX_VERIFY_FAILS,
  adminClient, clientIp, corsHeaders, findLoginUser, json,
} from '../_shared/whatsapp-login.ts'

const INVALID = 'Código inválido ou expirado. Solicite um novo código.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone: rawPhone, code: rawCode } = await req.json()
    const phone = normalizePhoneBR(rawPhone)
    const code = String(rawCode ?? '').replace(/\D/g, '')
    if (!phone || code.length < 6 || code.length > 8) return json({ error: INVALID }, 400)

    const admin = adminClient()
    const ip = clientIp(req)

    // Reserva a tentativa ANTES de validar o OTP, de forma atômica no banco:
    // exige um código enviado há menos de 5 min, ainda não usado, e no máximo
    // MAX_VERIFY_FAILS tentativas por código — mesmo com palpites concorrentes.
    const { data: state, error: reserveErr } = await admin.rpc('whatsapp_login_reserve_verify', {
      p_phone: phone,
      p_ip: ip,
      p_ttl_seconds: CODE_TTL_MS / 1000,
      p_max_attempts: MAX_VERIFY_FAILS,
    })
    if (reserveErr) throw reserveErr
    if (state === 'locked') return json({ error: 'Muitas tentativas. Solicite um novo código.' }, 429)
    if (state !== 'ok') return json({ error: INVALID }, 401)

    const user = await findLoginUser(admin, phone)
    if (!user) return json({ error: INVALID }, 401)

    // Valida no GoTrue (uso único, expiração própria) com um client anônimo
    // descartável, pra não contaminar nenhuma sessão do servidor.
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await anon.auth.verifyOtp({ email: user.email, token: code, type: 'magiclink' })
    if (error || !data?.session) return json({ error: INVALID }, 401)

    await admin.from('whatsapp_login_attempts').insert({ phone, kind: 'verify_ok', ip })

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  } catch (err) {
    console.error('whatsapp-login-verify:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível validar o código. Tente novamente.' }, 500)
  }
})
