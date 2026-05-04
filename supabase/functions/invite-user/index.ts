import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Plataformas que receberão o novo usuário automaticamente
// As chaves são configuradas como secrets no painel Supabase → Edge Functions → Secrets
const PLATFORMS = [
  {
    name: 'VP Requisições',
    url:  Deno.env.get('SB_VPREQUISICAO_URL'),
    key:  Deno.env.get('SB_VPREQUISICAO_SERVICE_KEY'),
  },
  {
    name: 'Pós-Venda 360',
    url:  Deno.env.get('SB_POSVENDA360_URL'),
    key:  Deno.env.get('SB_POSVENDA360_SERVICE_KEY'),
  },
  {
    name: 'Propostas',
    url:  Deno.env.get('SB_PROPOSTAS_URL'),
    key:  Deno.env.get('SB_PROPOSTAS_SERVICE_KEY'),
  },
  {
    name: 'Visitas e Brindes',
    url:  Deno.env.get('SB_VISITAS_URL'),
    key:  Deno.env.get('SB_VISITAS_SERVICE_KEY'),
  },
  {
    name: 'VP Catraca',
    url:  Deno.env.get('SB_CATRACA_URL'),
    key:  Deno.env.get('SB_CATRACA_SERVICE_KEY'),
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Verifica autenticação ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Confirma que o chamador é Administrador ──
    const { data: profile } = await supabaseUser
      .from('profiles')
      .select('level')
      .eq('id', user.id)
      .single()

    if (profile?.level !== 'Administrador') {
      return new Response(JSON.stringify({ error: 'Apenas administradores podem convidar.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { email, name, level, department, password } = await req.json()

    if (!password || password.length < 6) {
      return new Response(JSON.stringify({ error: 'A senha temporária deve ter pelo menos 6 caracteres.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Admin client do vpsistema (plataforma principal) ──
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Cria o usuário no vpsistema com senha definida pelo admin
    const { data: mainData, error: mainError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, level: level || 'Colaborador', department: department || null }
    })

    if (mainError) {
      return new Response(JSON.stringify({ error: mainError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Replica o usuário em todas as outras plataformas
    const platformResults: { platform: string; status: string; error?: string }[] = []

    for (const platform of PLATFORMS) {
      if (!platform.url || !platform.key) {
        platformResults.push({ platform: platform.name, status: 'skipped' })
        continue
      }

      try {
        const adminClient = createClient(platform.url, platform.key)
        const { error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name, department: department || null }
        })
        platformResults.push({
          platform: platform.name,
          status: error ? 'error' : 'ok',
          error: error?.message
        })
      } catch (e) {
        platformResults.push({ platform: platform.name, status: 'error', error: String(e) })
      }
    }

    return new Response(JSON.stringify({
      user: mainData.user,
      platforms: platformResults
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
