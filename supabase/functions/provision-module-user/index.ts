import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { APPS } from '../_shared/apps.ts'

// Disparada por um trigger em module_permissions (INSERT) — provisiona
// automaticamente o usuário no app satélite assim que um admin concede
// acesso, em vez de depender do primeiro clique em "Abrir sistema"
// (que é quando o sso-proxy faria esse mesmo provisionamento hoje).
//
// Sem verify_jwt: o Postgres não tem um JWT de usuário para enviar. Em vez
// de um segredo compartilhado, a função reconfirma a permissão direto no
// banco antes de agir — só provisiona o que já está de fato gravado em
// module_permissions, então um payload forjado não provisiona ninguém que
// não estivesse mesmo autorizado.
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  try {
    const { user_id: userId, module_slug: moduleSlug } = await req.json()
    if (!userId || !moduleSlug) {
      return json({ error: 'user_id e module_slug são obrigatórios' }, 400)
    }

    const app = APPS[moduleSlug]
    if (!app || app.ssoType !== 'magiclink') {
      // Apps token-based (vpclick, catraca, propostas, vpgestaoimportacao) não têm
      // Supabase Auth próprio — nada a provisionar.
      return json({ ok: true, skipped: true })
    }

    const vpsistema = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: perm } = await vpsistema
      .from('module_permissions')
      .select('user_id')
      .eq('user_id', userId)
      .eq('module_slug', moduleSlug)
      .maybeSingle()
    if (!perm) return json({ error: 'Permissão não encontrada' }, 404)

    const { data: profile, error: profileErr } = await vpsistema
      .from('profiles')
      .select('email, name, department')
      .eq('id', userId)
      .single()
    if (profileErr || !profile?.email) return json({ error: 'Perfil não encontrado' }, 404)

    const serviceKey = Deno.env.get(app.serviceKeyEnv)
    if (!serviceKey) return json({ error: 'App de destino não configurado' }, 500)

    const admin = createClient(app.url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: createErr } = await admin.auth.admin.createUser({
      email: profile.email,
      email_confirm: true,
      user_metadata: { full_name: profile.name, department: profile.department },
    })
    if (createErr && !/already.*registered|already.*exists/i.test(createErr.message ?? '')) {
      console.error('createUser error:', createErr)
      return json({ error: 'Falha ao provisionar usuário no app de destino' }, 500)
    }

    return json({ ok: true })
  } catch (err) {
    console.error('provision-module-user error:', err)
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
