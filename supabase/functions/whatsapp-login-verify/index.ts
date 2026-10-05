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

    // Estado do último envio: precisa existir, estar dentro dos 5 minutos e
    // não ter sido usado nem estourado o limite de tentativas.
    const { data: lastSend } = await admin
      .from('whatsapp_login_attempts')
      .select('created_at')
      .eq('phone', phone).eq('kind', 'send')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (!lastSend || Date.now() - new Date(lastSend.created_at).getTime() > CODE_TTL_MS) {
      return json({ error: INVALID }, 401)
    }

    const { data: after } = await admin
      .from('whatsapp_login_attempts')
      .select('kind')
      .eq('phone', phone).gt('created_at', lastSend.created_at)
      .in('kind', ['verify_fail', 'verify_ok'])
    if (after?.some(r => r.kind === 'verify_ok')) return json({ error: INVALID }, 401)
    if ((after?.filter(r => r.kind === 'verify_fail').length ?? 0) >= MAX_VERIFY_FAILS) {
      return json({ error: 'Muitas tentativas. Solicite um novo código.' }, 429)
    }

    const fail = async () => {
      await admin.from('whatsapp_login_attempts').insert({ phone, kind: 'verify_fail', ip })
      return json({ error: INVALID }, 401)
    }

    const user = await findLoginUser(admin, phone)
    if (!user) return await fail()

    // Valida no GoTrue (uso único, expiração própria) com um client anônimo
    // descartável, pra não contaminar nenhuma sessão do servidor.
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await anon.auth.verifyOtp({ email: user.email, token: code, type: 'magiclink' })
    if (error || !data?.session) return await fail()

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
