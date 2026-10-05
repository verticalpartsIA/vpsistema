import { createClient } from 'npm:@supabase/supabase-js@2'

export const CODE_TTL_MS = 5 * 60 * 1000
export const MAX_VERIFY_FAILS = 5
export const MAX_SENDS_PER_PHONE_HOUR = 3
export const MAX_SENDS_PER_IP_HOUR = 10

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd ? fwd.split(',')[0].trim() : req.headers.get('cf-connecting-ip')) || null
}

/**
 * Resolve o celular (só dígitos) para o usuário do Auth. Devolve null — sem
 * distinguir o motivo, pra não vazar quem é colaborador — quando não há
 * exatamente um perfil ativo com esse número e conta no Auth.
 */
export async function findLoginUser(
  admin: ReturnType<typeof adminClient>,
  phone: string,
): Promise<{ id: string; email: string } | null> {
  const { data: profiles } = await admin
    .from('profiles')
    .select('id')
    .eq('celular', phone)
    .eq('is_active', true)

  const found: { id: string; email: string }[] = []
  for (const p of profiles ?? []) {
    const { data } = await admin.auth.admin.getUserById(p.id)
    if (data?.user?.email) found.push({ id: p.id, email: data.user.email })
  }

  if (found.length > 1) {
    // Mesmo celular em mais de um perfil com conta: ambíguo, não arrisca
    // mandar o código pra conta errada. Corrigir o cadastro resolve.
    console.error('whatsapp-login: celular duplicado em perfis com conta Auth:', phone, found.length)
    return null
  }
  return found[0] ?? null
}
