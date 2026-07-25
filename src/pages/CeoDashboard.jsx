import { useEffect, useState, useCallback } from 'react'
import { supabase as sbPortal } from '../lib/supabase'
import {
  ArrowLeft, Loader2, BarChart2, Clock, LogIn, LogOut, Monitor,
  UserPlus, Shield, ClipboardList, Activity as ActivityIcon, RefreshCw
} from 'lucide-react'

const APP_LABELS = {
  vpsistema:          'vpsistema',
  vprequisicoes:      'VPRequisições',
  posvenda360:        'Pós-Venda 360',
  vpclick:            'VP Click',
  visitas:            'Visitas e Brindes',
  catraca:            'Catraca',
  propostas:          'Propostas',
  vpgestaoimportacao: 'Cotação Importação',
}

const LOG_ACTION_META = {
  login:              { verb: 'Entrou no vpsistema',      icon: LogIn,        color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  logout:             { verb: 'Saiu do vpsistema',         icon: LogOut,       color: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/20' },
  module_access:      { verb: 'Acessou',                   icon: Monitor,      color: 'text-brand',      bg: 'bg-brand/10',      border: 'border-brand/20' },
  invite_user:        { verb: 'Convidou um colaborador',   icon: UserPlus,     color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  change_permissions: { verb: 'Editou permissões',         icon: Shield,       color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  admin_access:       { verb: 'Abriu o Painel Admin',      icon: Shield,       color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  ceo_access:         { verb: 'Abriu o Painel Executivo',  icon: BarChart2,    color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  log_access:         { verb: 'Abriu o Activity Log',      icon: ClipboardList,color: 'text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/20' },
}

const EVENT_META = {
  enter: { icon: LogIn,  color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', verb: 'Entrou em' },
  exit:  { icon: LogOut, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', verb: 'Saiu de' },
}

function timelineLabel(item) {
  if (item.kind === 'log') {
    const meta = LOG_ACTION_META[item.action] || { verb: item.action, icon: ActivityIcon, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' }
    const text = item.action === 'module_access' && item.target ? `${meta.verb} ${item.target}` : meta.verb
    return { ...meta, text }
  }
  const meta = EVENT_META[item.event_type] || EVENT_META.enter
  const appLabel = APP_LABELS[item.app] || item.app
  return { ...meta, text: `${meta.verb} ${appLabel}` }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateGroup(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function groupByUserAndDate(items) {
  // Agrupa por usuário, depois por dia dentro de cada usuário, mais recente primeiro.
  const byUser = new Map()
  for (const item of items) {
    const key = item.user_email || item.user_name || '—'
    if (!byUser.has(key)) byUser.set(key, { user_name: item.user_name, user_email: item.user_email, days: [] })
    const bucket = byUser.get(key)
    const dateKey = new Date(item.criado_em).toDateString()
    let day = bucket.days.find(d => d.dateKey === dateKey)
    if (!day) {
      day = { dateKey, label: formatDateGroup(item.criado_em), items: [] }
      bucket.days.push(day)
    }
    day.items.push(item)
  }
  return Array.from(byUser.values())
    .sort((a, b) => new Date(b.days[0]?.items[0]?.criado_em || 0) - new Date(a.days[0]?.items[0]?.criado_em || 0))
}

function Timeline() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [logsRes, eventsRes] = await Promise.all([
      sbPortal.from('activity_logs').select('*').order('criado_em', { ascending: false }).limit(300),
      sbPortal.from('activity_events').select('*').order('criado_em', { ascending: false }).limit(300),
    ])
    const logs   = (logsRes.data   || []).map(l => ({ ...l, kind: 'log' }))
    const events = (eventsRes.data || []).map(e => ({ ...e, kind: 'event' }))
    const merged = [...logs, ...events].sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
    setItems(merged)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const groups = groupByUserAndDate(items)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">Rastro de acesso e navegação entre todos os sistemas, por colaborador.</p>
        <button onClick={load} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5" title="Atualizar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-brand animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Clock className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">Nenhum evento encontrado.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(user => (
            <div key={user.user_email} className="bg-surface-card border border-surface-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-brand/20 ring-2 ring-brand/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-brand font-bold text-xs">{(user.user_name || user.user_email || '?').slice(0, 2).toUpperCase()}</span>
                </div>
                <span className="text-white font-semibold text-sm">{user.user_name || user.user_email}</span>
              </div>

              <div className="space-y-5">
                {user.days.map(day => (
                  <div key={day.dateKey}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{day.label}</span>
                      <div className="flex-1 h-px bg-surface-border" />
                    </div>
                    <div className="space-y-1">
                      {day.items.map(item => {
                        const { icon: Icon, color, bg, border, text } = timelineLabel(item)
                        return (
                          <div key={item.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${bg} ${border} ${color} font-medium`}>
                              <Icon className="w-3 h-3" />
                              {text}
                            </span>
                            <span className="text-slate-600 text-xs ml-auto flex-shrink-0">{formatTime(item.criado_em)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CeoDashboard({ onBack }) {
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
                <p className="text-slate-500 text-xs mt-0.5">Linha do tempo de acesso — todos os sistemas</p>
              </div>
            </div>
          </div>
          <span className="text-slate-600 text-xs hidden sm:block">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <Timeline />
      </main>

      <footer className="text-center py-6 text-slate-700 text-xs border-t border-surface-border">
        © {new Date().getFullYear()} Vertical Parts — Painel Executivo
      </footer>
    </div>
  )
}
