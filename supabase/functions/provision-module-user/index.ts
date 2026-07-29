import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { appForModuleSlug } from '../_shared/apps.ts'

// Disparada por um trigger em module_permissions e pelo invite-user —
// provisiona o usuário no app satélite sem depender do primeiro clique em
// "Abrir sistema" (que é quando o sso-proxy faria esse mesmo provisionamento).
//
// Regra de acesso vigente: todo colaborador ativo do portal acessa todos os
// sistemas; a tabela module_permissions guarda apenas BLOQUEIOS explícitos
// (can_access = false). Então aqui provisionamos quando NÃO há bloqueio.
//
// Sem verify_jwt: o Postgres não tem um JWT de usuário para enviar. Em vez
// de um segredo compartilhado, a função reconfirma o estado direto no banco
// antes de agir — só age conforme o que já está gravado em profiles /
// module_permissions, então um payload forjado não libera ninguém.
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  try {
    const { user_id: userId, module_slug: moduleSlug } = await req.json()
    if (!userId || !moduleSlug) {
      return json({ error: 'user_id e module_slug são obrigatórios' }, 400)
    }

    // VP Click (slug "click") tem banco/perfis próprios: encaminha o aviso
    // para a função de provisionamento DO VP CLICK, que reconfirma a
    // permissão aqui (confirm-permission) e cria/reativa ou desativa o
    // usuário lá. Disparado tanto na concessão quanto na revogação.
    if (moduleSlug === 'click') {
      const res = await fetch(
        'https://sfpnjwllcmentoocylow.supabase.co/functions/v1/provision-from-vpsistema',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, module_slug: 'click' }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('provision-from-vpsistema respondeu', res.status, body)
        return json({ error: 'Falha ao provisionar no VP Click' }, 502)
      }
      return json({ ok: true, forwarded: 'vpclick', ...body })
    }

    // O slug do módulo não é a chave do mapa APPS (que é o hostname), daí a
    // busca por moduleSlug — antes APPS[moduleSlug] não achava "vpposvenda360"
    // nem "cotacao-importacao" e a função saía como "skipped".
    const app = appForModuleSlug(moduleSlug)
    if (!app || app.ssoType !== 'magiclink') {
      // Demais apps token-based (catraca, propostas, engenharia, suporte,
      // vpgestaoimportacao) não têm Supabase Auth próprio — nada a provisionar.
      return json({ ok: true, skipped: true })
    }

    const vpsistema = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: block } = await vpsistema
      .from('module_permissions')
      .select('user_id')
      .eq('user_id', userId)
      .eq('module_slug', moduleSlug)
      .eq('can_access', false)
      .maybeSingle()
    if (block) return json({ ok: true, blocked: true })

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
