import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase as sbPortal } from '../lib/supabase'
import {
  ArrowLeft, Loader2, TrendingUp, Users, MapPin, Gift,
  CheckSquare, AlertTriangle, DollarSign, BarChart2
} from 'lucide-react'

const mkClient = (url, key) =>
  url && key ? createClient(url, key) : null

const sbPropostas = mkClient(import.meta.env.VITE_SB_PROPOSTAS_URL, import.meta.env.VITE_SB_PROPOSTAS_KEY)
const sbClick     = mkClient(import.meta.env.VITE_SB_CLICK_URL,     import.meta.env.VITE_SB_CLICK_KEY)
const sbVisitas   = mkClient(import.meta.env.VITE_SB_VISITAS_URL,   import.meta.env.VITE_SB_VISITAS_KEY)

function fmt(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value || 0)
}

function KpiCard({ icon: Icon, label, value, sub, color = 'brand' }) {
  const colors = {
    brand:  'text-brand bg-brand/10',
    green:  'text-green-400 bg-green-400/10',
    red:    'text-red-400 bg-red-400/10',
    blue:   'text-blue-400 bg-blue-400/10',
    purple: 'text-purple-400 bg-purple-400/10',
    orange: 'text-orange-400 bg-orange-400/10',
  }
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-white text-2xl font-bold leading-none">{value}</p>
      {sub && <p className={`text-xs font-medium mt-0.5 ${colors[color].split(' ')[0]}`}>{sub}</p>}
      <p className="text-slate-500 text-xs mt-1">{label}</p>
    </div>
  )
}

const STATUS_COLOR = {
  rascunho:  'bg-slate-500/20 text-slate-400',
  enviada:   'bg-blue-500/20 text-blue-400',
  aprovada:  'bg-green-500/20 text-green-400',
  recusada:  'bg-red-500/20 text-red-400',
  cancelada: 'bg-orange-500/20 text-orange-400',
  PLANEJADA: 'bg-blue-500/20 text-blue-400',
  REALIZADA: 'bg-green-500/20 text-green-400',
  PENDENTE:  'bg-orange-500/20 text-orange-400',
  APROVADO:  'bg-green-500/20 text-green-400',
  RECUSADO:  'bg-red-500/20 text-red-400',
}

export default function CeoDashboard({ onBack }) {
  const [loading, setLoading] = useState(true)
  const [d, setD] = useState({
    propostasByStatus: [],
    valorAprovado: 0,
    topVendedores: [],
    visitasByStatus: [],
    ultimasVisitas: [],
    brindesByStatus: [],
    brindesPendentes: [],
    tasksByStatus: [],
    tasksAtrasadas: 0,
    colaboradoresAtivos: 0,
    colaboradoresTotal: 0,
  })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const results = await Promise.allSettled([
      loadPropostas(),
      loadVisitas(),
      loadClick(),
      loadPortal(),
    ])
    const merged = {}
    results.forEach(r => { if (r.status === 'fulfilled') Object.assign(merged, r.value) })
    setD(prev => ({ ...prev, ...merged }))
    setLoading(false)
  }

  async function loadPropostas() {
    const { data } = await sbPropostas.from('propostas').select('status, valor_total, vendedor_id')
    if (!data) return {}

    const byStatus = {}
    data.forEach(p => {
      if (!byStatus[p.status]) byStatus[p.status] = { count: 0, total: 0 }
      byStatus[p.status].count++
      byStatus[p.status].total += parseFloat(p.valor_total || 0)
    })
    const propostasByStatus = Object.entries(byStatus).map(([status, v]) => ({ status, ...v }))
    const valorAprovado = byStatus['aprovada']?.total || 0

    const vMap = {}
    data.filter(p => p.status === 'aprovada').forEach(p => {
      if (!vMap[p.vendedor_id]) vMap[p.vendedor_id] = { count: 0, total: 0 }
      vMap[p.vendedor_id].count++
      vMap[p.vendedor_id].total += parseFloat(p.valor_total || 0)
    })
    const ids = Object.keys(vMap)
    let topVendedores = []
    if (ids.length) {
      const { data: perfis } = await sbPropostas.from('perfis').select('id, nome').in('id', ids)
      topVendedores = ids
        .map(id => ({ id, nome: perfis?.find(p => p.id === id)?.nome || '—', ...vMap[id] }))
        .sort((a, b) => b.total - a.total).slice(0, 5)
    }
    return { propostasByStatus, valorAprovado, topVendedores }
  }

  async function loadVisitas() {
    const { data: visitas } = await sbVisitas
      .from('visits')
      .select('id, status, client_name, created_at')
      .order('created_at', { ascending: false })

    const vsMap = {}
    ;(visitas || []).forEach(v => { vsMap[v.status] = (vsMap[v.status] || 0) + 1 })
    const visitasByStatus = Object.entries(vsMap).map(([status, count]) => ({ status, count }))
    const ultimasVisitas = (visitas || []).slice(0, 6)

    const { data: brindes } = await sbVisitas
      .from('requests')
      .select('id, status, client_name, created_at')
      .order('created_at', { ascending: false })

    const brMap = {}
    ;(brindes || []).forEach(b => { brMap[b.status] = (brMap[b.status] || 0) + 1 })
    const brindesByStatus = Object.entries(brMap).map(([status, count]) => ({ status, count }))
    const brindesPendentes = (brindes || []).filter(b => b.status === 'PENDENTE').slice(0, 5)

    return { visitasByStatus, ultimasVisitas, brindesByStatus, brindesPendentes }
  }

  async function loadClick() {
    const { data: tasks } = await sbClick.from('tasks').select('id, status, due_date')
    if (!tasks) return {}

    const stMap = {}
    tasks.forEach(t => { stMap[t.status] = (stMap[t.status] || 0) + 1 })
    const tasksByStatus = Object.entries(stMap)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    const today = new Date().toISOString().split('T')[0]
    const done = ['done', 'concluida', 'concluído', 'completed', 'finalizada', 'concluido']
    const tasksAtrasadas = tasks.filter(t =>
      t.due_date && t.due_date < today && !done.includes((t.status || '').toLowerCase())
    ).length

    return { tasksByStatus, tasksAtrasadas }
  }

  async function loadPortal() {
    const { data } = await sbPortal.from('profiles').select('is_active')
    if (!data) return {}
    return {
      colaboradoresTotal: data.length,
      colaboradoresAtivos: data.filter(p => p.is_active !== false).length,
    }
  }

  const aprovadas   = d.propostasByStatus.find(p => p.status === 'aprovada')
  const enviadas    = d.propostasByStatus.find(p => p.status === 'enviada')
  const realizadas  = d.visitasByStatus.find(v => v.status === 'REALIZADA')
  const planejadas  = d.visitasByStatus.find(v => v.status === 'PLANEJADA')
  const brPendentes = d.brindesByStatus.find(b => b.status === 'PENDENTE')
  const totalTasks  = d.tasksByStatus.reduce((s, t) => s + t.count, 0)

  return (
    <div className="min-h-screen bg-surface flex flex-col">

      {/* Header */}
      <header className="bg-surface-card border-b border-surface-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </button>
            <span className="text-surface-border">|</span>
            <div className="flex items-center gap-3">
              <img src="/vp-logo.png" alt="VP" className="w-9 h-9 rounded-xl object-cover" />
              <div>
                <p className="text-white font-semibold leading-none">Painel Executivo</p>
                <p className="text-slate-500 text-xs mt-0.5">Visão consolidada — todos os sistemas</p>
              </div>
            </div>
          </div>
          <span className="text-slate-600 text-xs hidden sm:block">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
            <p className="text-slate-400 text-sm">Carregando dados de todos os sistemas...</p>
          </div>
        ) : (
          <div className="space-y-8">

            {/* ── KPIs ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard icon={DollarSign}    color="green"  label="Valor aprovado (propostas)"    value={fmt(d.valorAprovado)} />
              <KpiCard icon={TrendingUp}    color="blue"   label="Propostas aguardando"           value={enviadas?.count || 0}   sub={`${aprovadas?.count || 0} aprovadas`} />
              <KpiCard icon={MapPin}        color="brand"  label="Visitas realizadas"             value={realizadas?.count || 0} sub={`${planejadas?.count || 0} planejadas`} />
              <KpiCard icon={Gift}          color="orange" label="Brindes pendentes"              value={brPendentes?.count || 0} sub="aguardando aprovação" />
              <KpiCard icon={CheckSquare}   color={d.tasksAtrasadas > 0 ? 'red' : 'green'} label="Tarefas VP Click" value={totalTasks} sub={d.tasksAtrasadas > 0 ? `${d.tasksAtrasadas} atrasadas` : 'sem atrasos'} />
              <KpiCard icon={Users}         color="purple" label="Colaboradores ativos"           value={d.colaboradoresAtivos}  sub={`de ${d.colaboradoresTotal}`} />
            </div>

            {/* ── Propostas ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Pipeline */}
              <div className="bg-surface-card border border-surface-border rounded-2xl p-6">
                <h2 className="text-white font-semibold mb-5 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-brand" /> Pipeline de Propostas
                </h2>
                {d.propostasByStatus.length === 0
                  ? <p className="text-slate-500 text-sm">Sem dados</p>
                  : <div className="space-y-4">
                      {d.propostasByStatus.map(({ status, count, total }) => {
                        const tot = d.propostasByStatus.reduce((s, p) => s + p.count, 0)
                        const pct = tot > 0 ? Math.round((count / tot) * 100) : 0
                        return (
                          <div key={status}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[status] || 'bg-slate-500/20 text-slate-400'}`}>
                                  {status}
                                </span>
                                <span className="text-white text-sm font-semibold">{count}</span>
                                <span className="text-slate-500 text-xs">{pct}%</span>
                              </div>
                              <span className="text-slate-300 text-xs font-medium">{fmt(total)}</span>
                            </div>
                            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                              <div className="h-full bg-brand/70 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                }
              </div>

              {/* Top Vendedores */}
              <div className="bg-surface-card border border-surface-border rounded-2xl p-6">
                <h2 className="text-white font-semibold mb-5 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-green-400" /> Top Vendedores — propostas aprovadas
                </h2>
                {d.topVendedores.length === 0
                  ? <p className="text-slate-500 text-sm">Sem propostas aprovadas</p>
                  : <div className="space-y-4">
                      {d.topVendedores.map((v, i) => {
                        const maxVal = d.topVendedores[0]?.total || 1
                        const pct = Math.round((v.total / maxVal) * 100)
                        return (
                          <div key={v.id}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-500 text-xs w-5 text-right">{i + 1}.</span>
                                <span className="text-white text-sm">{v.nome}</span>
                                <span className="text-slate-500 text-xs">{v.count} prop.</span>
                              </div>
                              <span className="text-green-400 text-xs font-semibold">{fmt(v.total)}</span>
                            </div>
                            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                              <div className="h-full bg-green-400/50 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                }
              </div>
            </div>

            {/* ── Visitas + Brindes ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Visitas */}
              <div className="bg-surface-card border border-surface-border rounded-2xl p-6">
                <h2 className="text-white font-semibold mb-5 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-brand" /> Visitas Comerciais
                </h2>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {d.visitasByStatus.map(({ status, count }) => (
                    <div key={status} className={`rounded-xl p-3 text-center ${STATUS_COLOR[status] || 'bg-slate-500/10 text-slate-400'}`}>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs mt-0.5 capitalize">{status.toLowerCase()}</p>
                    </div>
                  ))}
                </div>
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">Últimas visitas</p>
                <div className="space-y-2">
                  {d.ultimasVisitas.map(v => (
                    <div key={v.id} className="flex items-center justify-between py-1.5 border-b border-surface-border/40 last:border-0">
                      <span className="text-slate-300 text-sm truncate mr-2">{v.client_name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded-md ${STATUS_COLOR[v.status] || 'bg-slate-500/20 text-slate-400'}`}>
                          {v.status}
                        </span>
                        <span className="text-slate-600 text-xs">
                          {new Date(v.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Brindes */}
              <div className="bg-surface-card border border-surface-border rounded-2xl p-6">
                <h2 className="text-white font-semibold mb-5 flex items-center gap-2">
                  <Gift className="w-4 h-4 text-orange-400" /> Solicitações de Brindes
                </h2>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {d.brindesByStatus.map(({ status, count }) => (
                    <div key={status} className={`rounded-xl p-3 text-center ${STATUS_COLOR[status] || 'bg-slate-500/10 text-slate-400'}`}>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs mt-0.5 capitalize">{status.toLowerCase()}</p>
                    </div>
                  ))}
                </div>
                {d.brindesPendentes.length > 0 && (
                  <>
                    <p className="text-orange-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Aguardando aprovação
                    </p>
                    <div className="space-y-2">
                      {d.brindesPendentes.map(b => (
                        <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-surface-border/40 last:border-0">
                          <span className="text-slate-300 text-sm truncate">{b.client_name}</span>
                          <span className="text-slate-600 text-xs shrink-0 ml-2">
                            {new Date(b.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {d.brindesPendentes.length === 0 && (
                  <p className="text-green-400 text-sm flex items-center gap-2">
                    <CheckSquare className="w-4 h-4" /> Nenhum brinde aguardando aprovação
                  </p>
                )}
              </div>
            </div>

            {/* ── VP Click ── */}
            <div className="bg-surface-card border border-surface-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-white font-semibold flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-blue-400" /> Tarefas — VP Click
                </h2>
                {d.tasksAtrasadas > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-1 rounded-full">
                    <AlertTriangle className="w-3 h-3" /> {d.tasksAtrasadas} tarefa{d.tasksAtrasadas > 1 ? 's' : ''} atrasada{d.tasksAtrasadas > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {d.tasksByStatus.slice(0, 10).map(({ status, count }) => {
                  const total = totalTasks || 1
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={status} className="bg-surface rounded-xl p-4">
                      <p className="text-white text-2xl font-bold">{count}</p>
                      <p className="text-slate-500 text-xs mt-0.5 truncate capitalize">{status?.toLowerCase() || '—'}</p>
                      <div className="mt-2 h-1 bg-surface-border rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400/50 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        )}
      </main>

      <footer className="text-center py-6 text-slate-700 text-xs border-t border-surface-border">
        © {new Date().getFullYear()} Vertical Parts — Painel Executivo
      </footer>
    </div>
  )
}
