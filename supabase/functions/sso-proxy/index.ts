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
