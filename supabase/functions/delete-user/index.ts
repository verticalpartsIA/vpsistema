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

// Satélites cujo schema de negócio conhecemos o suficiente para checar se o
// usuário tem alguma transação registrada (o que impediria a exclusão física
// da conta lá, para não órfão referências como requisitions.created_by).
// "VP Catraca" fica de fora propositalmente: não temos visibilidade do
// schema de negócio dele nesta organização Supabase, então não arriscamos
// afirmar "sem transações" às cegas — ver nota no PR/issue de follow-up.
const TRANSACTION_CHECKS = [
  {
    name: 'VP Requisições',
    url: Deno.env.get('SB_VPREQUISICAO_URL'),
    key: Deno.env.get('SB_VPREQUISICAO_SERVICE_KEY'),
    async hasAny(client: ReturnType<typeof createClient>, userId: string) {
      const checks = [
        client.from('requisitions').select('id', { count: 'exact', head: true })
          .or(`created_by.eq.${userId},requester_profile_id.eq.${userId},approver_id.eq.${userId}`),
        client.from('quotations').select('id', { count: 'exact', head: true }).eq('buyer_id', userId),
        client.from('approvals').select('id', { count: 'exact', head: true }).eq('approver_id', userId),
        client.from('purchases').select('id', { count: 'exact', head: true }).eq('buyer_id', userId),
        client.from('receipts').select('id', { count: 'exact', head: true }).eq('received_by', userId),
        client.from('comando_pedidos').select('id', { count: 'exact', head: true })
          .or(`created_by.eq.${userId},enviado_by.eq.${userId},reaberto_by.eq.${userId}`),
      ]
      const results = await Promise.all(checks)
      return results.some(r => (r.count ?? 0) > 0)
    },
  },
  {
    name: 'Pós-Venda 360',
    url: Deno.env.get('SB_POSVENDA360_URL'),
    key: Deno.env.get('SB_POSVENDA360_SERVICE_KEY'),
    async hasAny(client: ReturnType<typeof createClient>, userId: string) {
      const checks = [
        client.from('tickets').select('id', { count: 'exact', head: true })
          .or(`created_by.eq.${userId},assigned_to.eq.${userId}`),
        client.from('internal_tickets').select('id', { count: 'exact', head: true })
          .or(`opened_by.eq.${userId},assigned_to.eq.${userId}`),
        client.from('ticket_messages').select('id', { count: 'exact', head: true }).eq('author_id', userId),
      ]
      const results = await Promise.all(checks)
      return results.some(r => (r.count ?? 0) > 0)
    },
  },
  {
    name: 'Visitas e Brindes',
    url: Deno.env.get('SB_VISITAS_URL'),
    key: Deno.env.get('SB_VISITAS_SERVICE_KEY'),
    async hasAny(client: ReturnType<typeof createClient>, userId: string) {
      const checks = [
        client.from('requests').select('id', { count: 'exact', head: true })
          .or(`seller_id.eq.${userId},approved_by.eq.${userId}`),
        client.from('visits').select('id', { count: 'exact', head: true }).eq('seller_id', userId),
        client.from('stock_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      ]
      const results = await Promise.all(checks)
      return results.some(r => (r.count ?? 0) > 0)
    },
  },
  {
    // "Propostas" identifica o usuário por perfis.email (não há garantia de
    // que perfis.id == auth.users.id neste satélite), então resolve o id
    // local antes de checar as tabelas de negócio.
    name: 'Propostas',
    url: Deno.env.get('SB_PROPOSTAS_URL'),
    key: Deno.env.get('SB_PROPOSTAS_SERVICE_KEY'),
    async hasAny(client: ReturnType<typeof createClient>, _userId: string, email?: string) {
      if (!email) return false
      const { data: perfil } = await client.from('perfis').select('id').eq('email', email).maybeSingle()
      if (!perfil?.id) return false
      const checks = [
        client.from('propostas').select('id', { count: 'exact', head: true }).eq('vendedor_id', perfil.id),
        client.from('contratos').select('id', { count: 'exact', head: true }).eq('vendedor_id', perfil.id),
        client.from('clientes').select('id', { count: 'exact', head: true }).eq('criado_por', perfil.id),
      ]
      const results = await Promise.all(checks)
      return results.some(r => (r.count ?? 0) > 0)
    },
  },
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

    // 0. Checa se o usuário tem qualquer transação registrada nos satélites
    // com schema de negócio conhecido. Se tiver, exclusão física vira
    // apenas inativação — nunca apagamos identidade que sustenta dados de
    // negócio já gravados (evita órfãos como requisitions.created_by).
    const transactionResults: { platform: string; status: string; error?: string }[] = []
    let hasTransactions = false

    for (const check of TRANSACTION_CHECKS) {
      if (!check.url || !check.key) { transactionResults.push({ platform: check.name, status: 'skipped' }); continue }
      try {
        const client = createClient(check.url, check.key)
        const { data: users } = await client.auth.admin.listUsers()
        const target = users?.users?.find(u => u.email === email)
        const found = await check.hasAny(client, target?.id ?? '', email)
        if (found) hasTransactions = true
        transactionResults.push({ platform: check.name, status: found ? 'has_transactions' : 'clean' })
      } catch (e) {
        // Erro na checagem é tratado como inconclusivo, não como "limpo" —
        // não arriscamos excluir sem confirmação.
        hasTransactions = true
        transactionResults.push({ platform: check.name, status: 'error', error: String(e) })
      }
    }

    if (hasTransactions) {
      // Só inativa: revoga acesso central e apaga module_permissions (o que
      // já dispara o webhook existente de revogação para os satélites com
      // provisionamento automático), sem apagar a conta em lugar nenhum.
      const { error: inactivateErr } = await supabaseAdmin
        .from('profiles')
        .update({ is_active: false })
        .eq('id', user_id)
      if (inactivateErr) return new Response(JSON.stringify({ error: inactivateErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      await supabaseAdmin.from('module_permissions').delete().eq('user_id', user_id)

      return new Response(JSON.stringify({
        success: true,
        action: 'inactivated',
        reason: 'transactions_found',
        checks: transactionResults,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

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

    return new Response(JSON.stringify({ success: true, action: 'deleted', platforms: platformResults }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
