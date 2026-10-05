// Troca o link de primeiro acesso (token enviado por WhatsApp) por uma sessão.
// Chamada ANTES do login → deploy com verify_jwt = false.
// O token é de uso único e expira (48h); só o hash fica no banco. A resposta de
// falha é sempre a mesma (inexistente, usado ou expirado).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'

const INVALID = 'Link inválido, expirado ou já utilizado. Informe seu celular para receber um código de acesso.'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token } = await req.json()
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return json({ error: INVALID }, 401)

    const admin = adminClient()

    // Consome o token de forma atômica: só quem marcar used_at primeiro leva.
    const { data: consumed } = await admin
      .from('whatsapp_first_access_links')
      .update({ used_at: new Date().toISOString() })
      .eq('token_hash', await sha256Hex(token))
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('user_id')
    const userId = consumed?.[0]?.user_id
    if (!userId) return json({ error: INVALID }, 401)

    const { data: profile } = await admin.from('profiles').select('is_active').eq('id', userId).maybeSingle()
    if (!profile || profile.is_active === false) return json({ error: INVALID }, 401)

    const { data: authUser } = await admin.auth.admin.getUserById(userId)
    const email = authUser?.user?.email
    if (!email) return json({ error: INVALID }, 401)

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const otp = link?.properties?.email_otp
    if (linkErr || !otp) {
      console.error('whatsapp-first-access: generateLink falhou:', linkErr?.message || 'email_otp ausente')
      return json({ error: INVALID }, 401)
    }

    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await anon.auth.verifyOtp({ email, token: otp, type: 'magiclink' })
    if (error || !data?.session) return json({ error: INVALID }, 401)

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  } catch (err) {
    console.error('whatsapp-first-access:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível validar o link. Tente novamente.' }, 500)
  }
})
