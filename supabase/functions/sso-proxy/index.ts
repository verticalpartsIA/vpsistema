import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type MagicLinkApp = {
  ssoType: 'magiclink'
  url: string
  serviceKeyEnv: string
  redirectTo: string
}

type TokenApp = {
  ssoType: 'token'
  redirectTo: string
}

type AppConfig = MagicLinkApp | TokenApp

const APPS: Record<string, AppConfig> = {
  // Apps com Supabase Auth próprio → magic link
  vprequisicoes: {
    ssoType: 'magiclink',
    url: 'https://vvgcrhtmzvssfdazkkzk.supabase.co',
    serviceKeyEnv: 'VPREQ_SERVICE_KEY',
    redirectTo: 'https://vprequisicoes.vpsistema.com',
  },
  posvenda360: {
    ssoType: 'magiclink',
    url: 'https://jkbklzlbhhfnamaeislb.supabase.co',
    serviceKeyEnv: 'PV360_SERVICE_KEY',
    redirectTo: 'https://posvenda360.vpsistema.com',
  },
  visitas: {
    ssoType: 'magiclink',
    url: 'https://bvvnoapdclxhuygptbza.supabase.co',
    serviceKeyEnv: 'VISITAS_SERVICE_KEY',
    redirectTo: 'https://visitas.vpsistema.com',
  },
  // Apps que validam o JWT do vpsistema via ?sso_token=
  vpclick: {
    ssoType: 'token',
    redirectTo: 'https://vpclick.vpsistema.com',
  },
  catraca: {
    ssoType: 'token',
    redirectTo: 'https://catraca.vpsistema.com',
  },
  propostas: {
    ssoType: 'token',
    redirectTo: 'https://propostas.vpsistema.com',
  },
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

    // Create user in target app if they don't exist
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const exists = existing?.users?.some(u => u.email === user.email)
    if (!exists) {
      await admin.auth.admin.createUser({ email: user.email, email_confirm: true })
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
