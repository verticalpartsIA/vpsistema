import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { APPS } from '../_shared/apps.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Verify caller is authenticated in vpsistema
    const vpsistema = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await vpsistema.auth.getUser()
    if (authErr || !user?.email) return json({ error: 'Invalid session' }, 401)

    const { targetApp } = await req.json()
    const app = APPS[targetApp]
    if (!app) return json({ error: 'Unknown app' }, 400)

    // ── Controle de acesso por módulo (server-side) ──
    // O bloqueio no Dashboard é só de UI: sem esta verificação, qualquer usuário
    // autenticado podia chamar a função direto e obter SSO para qualquer app.
    // Espelha a regra do front: sem linhas em module_permissions = acesso pleno;
    // com linhas, o slug do módulo precisa estar entre elas.
    // O slug da permissão NEM SEMPRE é igual ao targetApp (ex.: vpclick→click,
    // posvenda360→vpposvenda360), então mapeamos pelo hostname da tabela modules.
    const vpAdmin = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: mods } = await vpAdmin
      .from('modules')
      .select('slug, url, is_active')
    const mod = (mods ?? []).find((m) => hostnamePrefix(m.url) === targetApp)
    if (!mod || mod.is_active === false) {
      return json({ error: 'Módulo indisponível' }, 400)
    }

    const { data: perms } = await vpsistema
      .from('module_permissions')
      .select('module_slug')
      .eq('user_id', user.id)

    const hasRestrictions = Array.isArray(perms) && perms.length > 0
    const allowed = !hasRestrictions || perms!.some((p) => p.module_slug === mod.slug)
    if (!allowed) {
      return json({ error: 'Você não tem permissão para acessar este sistema.' }, 403)
    }

    const { data: prof } = await vpsistema
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()
    logEnter(targetApp, user.email, prof?.name)

    // Token-based SSO: pass vpsistema JWT directly as ?sso_token=
    if (app.ssoType === 'token') {
      const token = authHeader.replace('Bearer ', '')
      return json({ actionLink: `${app.redirectTo}?sso_token=${encodeURIComponent(token)}` })
    }

    // Magic link SSO: generate Supabase Auth link for the target app
    const serviceKey = Deno.env.get(app.serviceKeyEnv)
    if (!serviceKey) return json({ error: 'App not configured' }, 500)

    const admin = createClient(app.url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Cria o usuário no app de destino. listUsers() só retorna a primeira página
    // (perPage: 1000) — em projetos com mais usuários isso gera falso-negativo em
    // "exists", tentando criar um e-mail duplicado. createUser() falha com
    // "already registered", o erro sobe sem tratamento e a função inteira retorna
    // 500 — SSO cai no fallback sem sessão e o app de destino redireciona de volta
    // ao portal (reload infinito). Tentar criar direto e ignorar erro de duplicado
    // evita a checagem prévia e a condição de corrida.
    const { error: createErr } = await admin.auth.admin.createUser({
      email: user.email,
      email_confirm: true,
    })
    if (createErr && !/already.*registered|already.*exists/i.test(createErr.message ?? '')) {
      console.error('createUser error:', createErr)
      return json({ error: 'Failed to provision user in target app' }, 500)
    }

    // Generate magic link → user is auto-logged in on the target app
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
      options: { redirectTo: app.redirectTo },
    })

    if (linkErr || !linkData?.properties?.action_link) {
      console.error('generateLink error:', linkErr)
      return json({ error: 'Failed to generate SSO link' }, 500)
    }

    return json({ actionLink: linkData.properties.action_link })
  } catch (err) {
    console.error('sso-proxy error:', err)
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Primeiro rótulo do hostname de uma URL de módulo (ex.: "posvenda360" de
// https://posvenda360.vpsistema.com/login). É a chave usada como targetApp.
function hostnamePrefix(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return ''
  }
}

// Fire-and-forget: nunca deve atrasar ou quebrar o SSO.
function logEnter(targetApp: string, email: string, name?: string | null) {
  try {
    const admin = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    admin.from('activity_events').insert({
      app: targetApp,
      event_type: 'enter',
      user_email: email,
      user_name: name || null,
    }).then(({ error }) => {
      if (error) console.error('logEnter error:', error)
    })
  } catch (_) {
    // silencioso
  }
}
