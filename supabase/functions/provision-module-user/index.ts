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

    const vpsistema = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Propostas é classificado como "token" (verifica o JWT do vpsistema
    // direto, sem precisar de usuário provisionado) — só que, ao contrário
    // dos outros apps token, ele TEM Supabase Auth próprio (o invite-user já
    // cria a conta lá, replicando pra todas as plataformas) E uma tabela
    // `perfis` própria que o app exige pra aceitar o login. Provisionar só o
    // auth.users nunca foi suficiente: sem a linha em `perfis`, o app rejeita
    // o usuário depois de verificar o token e devolve pro portal — o "dá
    // reload" relatado por vários colaboradores. Achado direto no banco:
    // vários usuários com auth.users órfão (sem perfis) batiam nesse bug —
    // corrigidos manualmente por SQL em 30/07/2026.
    //
    // Resolver o id do usuário tenta dois caminhos: createUser() cria e
    // devolve o id de quem nunca existiu; generateLink() resolve o id de
    // quem já existe. O GoTrue do projeto do Propostas responde
    // AuthRetryableFetchError de forma intermitente em operações que
    // escrevem em auth.users (confirmado testando o mesmo e-mail 3x com
    // resultados inconsistentes) — isso é instabilidade da infraestrutura
    // deles, não deste código; se falhar, tenta de novo no próximo
    // provisionamento (próxima concessão de permissão ou próximo clique
    // no card, via sso-proxy).
    if (moduleSlug === 'propostas') {
      const { data: block } = await vpsistema
        .from('module_permissions')
        .select('user_id')
        .eq('user_id', userId)
        .eq('module_slug', 'propostas')
        .eq('can_access', false)
        .maybeSingle()
      if (block) return json({ ok: true, blocked: true })

      const { data: profile, error: profileErr } = await vpsistema
        .from('profiles')
        .select('email, name, level, is_active')
        .eq('id', userId)
        .single()
      if (profileErr || !profile?.email) return json({ error: 'Perfil não encontrado' }, 404)

      const url = Deno.env.get('SB_PROPOSTAS_URL')
      const key = Deno.env.get('SB_PROPOSTAS_SERVICE_KEY')
      if (!url || !key) return json({ error: 'Propostas não configurado' }, 500)

      const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: profile.email,
        email_confirm: true,
      })
      let authId = created?.user?.id
      if (!authId) {
        if (createErr && !/already.*registered|already.*exists/i.test(createErr.message ?? '')) {
          console.error('propostas createUser error:', createErr.message)
          return json({ error: 'Falha ao provisionar usuário no Propostas (tente novamente)' }, 500)
        }
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'magiclink',
          email: profile.email,
        })
        authId = linkData?.user?.id
        if (linkErr || !authId) {
          console.error('propostas generateLink error:', linkErr?.message)
          return json({ error: 'Não foi possível resolver o id do usuário no Propostas (tente novamente)' }, 500)
        }
      }

      // "Lider" no vpsistema é "Gestor" no vocabulário do Propostas — mesmos
      // 3 níveis, nomes diferentes.
      const nivel = profile.level === 'Lider' ? 'Gestor'
        : profile.level === 'Administrador' ? 'Administrador'
        : 'Colaborador'

      const { error: perfilErr } = await admin.from('perfis').upsert({
        id: authId,
        email: profile.email,
        nome: profile.name,
        nivel,
        ativo: profile.is_active !== false,
      })
      if (perfilErr) {
        console.error('propostas perfis upsert error:', perfilErr)
        return json({ error: 'Falha ao gravar perfil no Propostas' }, 500)
      }

      return json({ ok: true, provisioned: 'propostas' })
    }

    // O slug do módulo não é a chave do mapa APPS (que é o hostname), daí a
    // busca por moduleSlug — antes APPS[moduleSlug] não achava "vpposvenda360"
    // nem "cotacao-importacao" e a função saía como "skipped".
    const app = appForModuleSlug(moduleSlug)
    if (!app || app.ssoType !== 'magiclink') {
      // Demais apps token-based (catraca, engenharia, suporte,
      // vpgestaoimportacao) não têm Supabase Auth próprio — nada a provisionar.
      return json({ ok: true, skipped: true })
    }

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
