import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PLATFORMS = [
  { name: 'VP Requisições',   url: Deno.env.get('SB_VPREQUISICAO_URL'),  key: Deno.env.get('SB_VPREQUISICAO_SERVICE_KEY') },
  { name: 'Pós-Venda 360',    url: Deno.env.get('SB_POSVENDA360_URL'),   key: Deno.env.get('SB_POSVENDA360_SERVICE_KEY') },
  { name: 'Propostas',        url: Deno.env.get('SB_PROPOSTAS_URL'),     key: Deno.env.get('SB_PROPOSTAS_SERVICE_KEY') },
  { name: 'Visitas e Brindes',url: Deno.env.get('SB_VISITAS_URL'),       key: Deno.env.get('SB_VISITAS_SERVICE_KEY') },
  { name: 'VP Catraca',       url: Deno.env.get('SB_CATRACA_URL'),       key: Deno.env.get('SB_CATRACA_SERVICE_KEY') },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verifica que quem chama é Administrador
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller } } = await supabaseUser.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Sessão inválida' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { data: callerProfile } = await supabaseUser.from('profiles').select('level').eq('id', caller.id).single()
    if (callerProfile?.level !== 'Administrador') return new Response(JSON.stringify({ error: 'Apenas administradores podem excluir.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { user_id, email } = await req.json()
    if (!user_id) return new Response(JSON.stringify({ error: 'user_id obrigatório' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1. Deleta do vpsistema (cascade deleta profile)
    const { error: mainErr } = await supabaseAdmin.auth.admin.deleteUser(user_id)
    if (mainErr) return new Response(JSON.stringify({ error: mainErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // 2. Deleta em todas as outras plataformas (busca pelo email)
    const platformResults: { platform: string; status: string; error?: string }[] = []

    for (const platform of PLATFORMS) {
      if (!platform.url || !platform.key) { platformResults.push({ platform: platform.name, status: 'skipped' }); continue }
      try {
        const adminClient = createClient(platform.url, platform.key)
        const { data: users } = await adminClient.auth.admin.listUsers()
        const target = users?.users?.find(u => u.email === email)
        if (target) {
          const { error } = await adminClient.auth.admin.deleteUser(target.id)
          platformResults.push({ platform: platform.name, status: error ? 'error' : 'ok', error: error?.message })
        } else {
          platformResults.push({ platform: platform.name, status: 'not_found' })
        }
      } catch (e) {
        platformResults.push({ platform: platform.name, status: 'error', error: String(e) })
      }
    }

    return new Response(JSON.stringify({ success: true, platforms: platformResults }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
