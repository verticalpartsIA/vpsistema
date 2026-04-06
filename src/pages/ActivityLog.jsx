import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Activity, LogIn, LogOut, Monitor, UserPlus,
  Shield, BarChart2, Search, Loader2, RefreshCw, ClipboardList,
  ChevronDown
} from 'lucide-react'

const ACTION_META = {
  login:               { label: 'Login',              icon: LogIn,       color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  logout:              { label: 'Logout',             icon: LogOut,      color: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/20' },
  module_access:       { label: 'Acesso a módulo',    icon: Monitor,     color: 'text-brand',      bg: 'bg-brand/10',      border: 'border-brand/20' },
  invite_user:         { label: 'Convite enviado',    icon: UserPlus,    color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  change_permissions:  { label: 'Permissões editadas',icon: Shield,      color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  admin_access:        { label: 'Painel Admin',       icon: Shield,      color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  ceo_access:          { label: 'Painel Executivo',   icon: BarChart2,   color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  log_access:          { label: 'Activity Log',       icon: ClipboardList,color:'text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/20' },
}

const PAGE_SIZE = 50

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

function groupByDate(logs) {
  const groups = []
  let currentDate = null
  for (const log of logs) {
    const dateKey = new Date(log.criado_em).toDateString()
    if (dateKey !== currentDate) {
      currentDate = dateKey
      groups.push({ date: log.criado_em, label: formatDateGroup(log.criado_em), logs: [] })
    }
    groups[groups.length - 1].logs.push(log)
  }
  return groups
}

function Initials({ name, email }) {
  const src = (name || email || '?').slice(0, 2).toUpperCase()
  return (
    <div className="w-8 h-8 rounded-full bg-brand/20 ring-2 ring-brand/30 flex items-center justify-center flex-shrink-0">
      <span className="text-brand font-bold text-xs">{src}</span>
    </div>
  )
}

function LogEntry({ log }) {
  const meta = ACTION_META[log.action] || {
    label: log.action, icon: Activity,
    color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20'
  }
  const Icon = meta.icon

  return (
    <div className="flex items-start gap-3 py-3 px-4 rounded-xl hover:bg-white/5 transition-colors group">
      <Initials name={log.user_name} email={log.user_email} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white text-sm font-medium truncate">{log.user_name || log.user_email}</span>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${meta.bg} ${meta.border} ${meta.color} font-medium`}>
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
          {log.target && (
            <span className="text-slate-400 text-xs truncate">{log.target}</span>
          )}
        </div>
        {log.details && Object.keys(log.details).length > 0 && (
          <p className="text-slate-500 text-xs mt-0.5">
            {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </p>
        )}
      </div>

      <span className="text-slate-600 text-xs flex-shrink-0 group-hover:text-slate-400 transition-colors">
        {formatTime(log.criado_em)}
      </span>
    </div>
  )
}

export default function ActivityLog({ onBack }) {
  const [logs,       setLogs]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [loadingMore,setLoadingMore]= useState(false)
  const [hasMore,    setHasMore]    = useState(false)
  const [offset,     setOffset]     = useState(0)

  // Filtros
  const [search,     setSearch]     = useState('')
  const [filterAction,setFilterAction] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [users,      setUsers]      = useState([])

  const load = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setOffset(0)
    } else {
      setLoadingMore(true)
    }

    const start = reset ? 0 : offset

    let q = supabase
      .from('activity_logs')
      .select('*')
      .order('criado_em', { ascending: false })
      .range(start, start + PAGE_SIZE - 1)

    if (filterAction) q = q.eq('action', filterAction)
    if (filterUser)   q = q.eq('user_id', filterUser)
    if (search)       q = q.or(`user_name.ilike.%${search}%,user_email.ilike.%${search}%,target.ilike.%${search}%`)

    const { data, error } = await q

    if (!error) {
      if (reset) {
        setLogs(data || [])
      } else {
        setLogs(prev => [...prev, ...(data || [])])
      }
      setHasMore((data || []).length === PAGE_SIZE)
      setOffset(start + PAGE_SIZE)
    }

    if (reset) setLoading(false)
    else setLoadingMore(false)
  }, [filterAction, filterUser, search, offset])

  useEffect(() => {
    // Carrega lista de usuários para o filtro
    supabase.from('profiles').select('id, name, email').order('name').then(({ data }) => {
      setUsers(data || [])
    })
  }, [])

  useEffect(() => {
    load(true)
  }, [filterAction, filterUser, search])  // eslint-disable-line

  const groups = groupByDate(logs)

  return (
    <div className="min-h-screen bg-surface flex flex-col">

      {/* Header */}
      <header className="bg-surface-card border-b border-surface-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-sky-400" />
              <h1 className="text-white font-bold text-lg">Activity Log</h1>
            </div>
          </div>
          <button
            onClick={() => load(true)}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          {/* Busca */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por usuário ou alvo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-surface-card border border-surface-border text-white placeholder-slate-500
                         rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-brand/50"
            />
          </div>

          {/* Filtro por tipo */}
          <div className="relative">
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className="appearance-none bg-surface-card border border-surface-border text-slate-300
                         rounded-lg px-4 py-2 pr-8 text-sm focus:outline-none focus:border-brand/50 w-full sm:w-auto"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(ACTION_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>

          {/* Filtro por usuário */}
          <div className="relative">
            <select
              value={filterUser}
              onChange={e => setFilterUser(e.target.value)}
              className="appearance-none bg-surface-card border border-surface-border text-slate-300
                         rounded-lg px-4 py-2 pr-8 text-sm focus:outline-none focus:border-brand/50 w-full sm:w-auto"
            >
              <option value="">Todos os usuários</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Conteúdo */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Activity className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Nenhum evento encontrado.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(group => (
              <div key={group.date}>
                {/* Separador de data */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-surface-border" />
                  <span className="text-slate-600 text-xs">{group.logs.length} evento{group.logs.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Eventos do dia */}
                <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden divide-y divide-surface-border">
                  {group.logs.map(log => (
                    <LogEntry key={log.id} log={log} />
                  ))}
                </div>
              </div>
            ))}

            {/* Carregar mais */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => load(false)}
                  disabled={loadingMore}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-white
                             border border-surface-border hover:border-brand/40 rounded-lg px-5 py-2
                             transition-colors disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                  Carregar mais
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
