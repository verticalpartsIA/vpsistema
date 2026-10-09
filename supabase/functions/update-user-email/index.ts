import { createClient } from 'npm:@supabase/supabase-js@2'
import { PLATFORMS, findUserByEmail } from '../_shared/platforms.ts'
import { withRetry } from '../_shared/retry.ts'

// Troca o e-mail de um colaborador EM TODO O ECOSSISTEMA (pedido do Gelson,
// 09/10/2026 — antes era preciso excluir e recadastrar a pessoa).
// O e-mail é o LOGIN e a chave que liga a pessoa aos sistemas satélites, então
// não basta mudar o texto em profiles:
//   1. vpsistema: auth.users (login) + profiles.email
//   2. satélites com conta própria (PLATFORMS): acha a conta pelo e-mail antigo
//      e troca para o novo.
// Quem pode: mesma alçada de "departamento/status" na /administracao —
//   plenos: qualquer pessoa (inclusive a si mesmo);
//   médios: só quem está abaixo (baixos / sem poder), nunca a si mesmo;
//   baixos: só quem não tem poder, nunca a si mesmo.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autorizado' }, 401)

    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller } } = await supabaseUser.auth.getUser()
    if (!caller) return json({ error: 'Sessão inválida' }, 401)

    const { user_id, new_email } = await req.json()
    const email = String(new_email || '').trim().toLowerCase()
    if (!user_id || !email) return json({ error: 'user_id e new_email são obrigatórios.' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'E-mail inválido.' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: callerProfile } = await admin.from('profiles').select('power_level').eq('id', caller.id).single()
    const { data: target } = await admin.from('profiles').select('id, email, name, power_level, is_placeholder').eq('id', user_id).single()
    if (!target) return json({ error: 'Colaborador não encontrado.' }, 404)

    const me = callerProfile?.power_level
    const self = target.id === caller.id
    const allowed =
      me === 'plenos' ||
      (me === 'medios' && !self && (!target.power_level || target.power_level === 'baixos')) ||
      (me === 'baixos' && !self && !target.power_level)
    if (!allowed) return json({ error: 'Você não tem alçada para alterar o e-mail desta pessoa.' }, 403)

    const oldEmail = (target.email || '').toLowerCase()
    if (oldEmail === email) return json({ success: true, unchanged: true })

    const { data: clash } = await admin.from('profiles').select('id').ilike('email', email).neq('id', target.id).maybeSingle()
    if (clash) return json({ error: 'Já existe outro colaborador com esse e-mail.' }, 409)

    // 1. vpsistema — login (cadastro "só nome" não tem conta de login)
    if (!target.is_placeholder) {
      const { data: authUser } = await admin.auth.admin.getUserById(target.id)
      if (authUser?.user) {
        const { error } = await admin.auth.admin.updateUserById(target.id, { email, email_confirm: true })
        if (error) return json({ error: `Falha ao trocar o login: ${error.message}` }, 400)
      }
    }
    const { error: profErr } = await admin.from('profiles').update({ email }).eq('id', target.id)
    if (profErr) return json({ error: `Falha ao atualizar o cadastro: ${profErr.message}` }, 400)

    // 2. satélites com conta própria
    const platforms: { platform: string; status: string; error?: string }[] = []
    for (const p of PLATFORMS) {
      if (!p.url || !p.key || !oldEmail) { platforms.push({ platform: p.name, status: 'skipped' }); continue }
      try {
        const client = createClient(p.url, p.key)
        const found = await findUserByEmail(client, oldEmail)
        if (!found) { platforms.push({ platform: p.name, status: 'not_found' }); continue }
        await withRetry(async () => {
          const { error } = await client.auth.admin.updateUserById(found.id, { email, email_confirm: true })
          if (error) throw error
        })
        platforms.push({ platform: p.name, status: 'ok' })
      } catch (e) {
        platforms.push({ platform: p.name, status: 'error', error: (e as Error)?.message || String(e) })
      }
    }

    return json({ success: true, old_email: oldEmail, new_email: email, platforms })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
