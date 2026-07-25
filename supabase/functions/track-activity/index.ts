import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Endpoint público chamado pelos apps satélites (cada um com seu próprio
// Supabase Auth, sem JWT do vpsistema) para registrar entrada/saída real do
// usuário na timeline do Painel Executivo. Sem verify_jwt: autenticação é por
// track_key no corpo (não header) porque o evento de saída usa
// navigator.sendBeacon, que não permite headers customizados — só chave
// compartilhada, não secreta de verdade (client-side nos satélites), mas
// suficiente pra filtrar ruído de fora. O valor gravado é só telemetria de
// navegação, não concede nenhuma permissão.
const KNOWN_APPS = new Set([
  'vprequisicoes', 'posvenda360', 'vpclick', 'visitas',
  'catraca', 'propostas', 'vpgestaoimportacao',
])

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { app, event_type, user_email, user_name, target, session_id, details, track_key } = await req.json()

    const expectedKey = Deno.env.get('TRACK_ACTIVITY_KEY')
    if (!expectedKey || track_key !== expectedKey) {
      return json({ error: 'Unauthorized' }, 401)
    }

    if (!KNOWN_APPS.has(app)) return json({ error: 'Unknown app' }, 400)
    if (event_type !== 'enter' && event_type !== 'exit') return json({ error: 'Invalid event_type' }, 400)
    if (!user_email) return json({ error: 'user_email is required' }, 400)

    const vpsistema = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { error } = await vpsistema.from('activity_events').insert({
      app,
      event_type,
      user_email,
      user_name: user_name || null,
      target: target || null,
      session_id: session_id || null,
      details: details || null,
    })
    if (error) {
      console.error('track-activity insert error:', error)
      return json({ error: 'Failed to record event' }, 500)
    }

    return json({ ok: true })
  } catch (err) {
    console.error('track-activity error:', err)
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
