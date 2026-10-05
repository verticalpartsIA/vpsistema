import { createClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from './whatsapp-login.ts'

/**
 * Cria a sessão de um usuário já autenticado pelo servidor (senha + código, ou conta
 * isenta): gera um magiclink pelo Admin e valida o OTP com um client anônimo
 * descartável. Nunca devolve nada ao cliente além dos tokens.
 */
export async function mintSession(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ access_token: string; refresh_token: string } | null> {
  const { data: profile } = await admin.from('profiles').select('is_active').eq('id', userId).maybeSingle()
  if (!profile || profile.is_active === false) return null

  const { data: authUser } = await admin.auth.admin.getUserById(userId)
  const email = authUser?.user?.email
  if (!email) return null

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const otp = link?.properties?.email_otp
  if (linkErr || !otp) {
    console.error('two-factor: generateLink falhou:', linkErr?.message || 'email_otp ausente')
    return null
  }

  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await anon.auth.verifyOtp({ email, token: otp, type: 'magiclink' })
  if (error || !data?.session) return null
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
}
