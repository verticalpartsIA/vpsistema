import { useEffect, useState, useCallback } from 'react'
import { supabase as sbPortal } from '../lib/supabase'
import { DEPARTMENTS } from './Admin'
import {
  ArrowLeft, Loader2, BarChart2, Clock, LogIn, LogOut, Monitor,
  UserPlus, Shield, ClipboardList, Activity as ActivityIcon, RefreshCw,
  ChevronRight, ChevronDown, Star, AlertTriangle
} from 'lucide-react'

const LEVEL_RANK = { Administrador: 0, Lider: 1, Colaborador: 2 }

// Antes a tela buscava só os últimos 300 registros de cada tabela, sem
// filtro de data — com o volume atual isso cobria ~49h (pouco mais de 2
// dias) de um histórico de 4 meses, sem avisar. Um departamento sumia da
// lista e não dava para saber se ele não acessou nada ou se caiu fora da
// janela. Agora o período é explícito e a busca filtra por data no banco,
// não por "os N mais recentes" — a cobertura real fica visível sempre.
const PERIODS = [
  { key: 'hoje',  label: 'Hoje',    days: 1  },
  { key: '7d',    label: '7 dias',  days: 7  },
  { key: '30d',   label: '30 dias', days: 30 },
]
// Teto de segurança por tabela — não é "os N mais recentes" (isso escondia
// a janela real); é só um limite superior para não travar o navegador se
// um período muito longo trouxer volume anormal. 30 dias hoje traz ~5 mil
// linhas por tabela, então 8 mil dá folga sem risco de silenciar dados.
const SAFETY_CAP = 8000

// Nome/email → id utilizável em HTML, para o aria-controls dos três níveis
// de grupo (departamento, colaborador, dia) apontarem para um elemento real.
function slugify(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

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

// Assinatura de "mesma coisa aconteceu de novo": mesmo tipo de evento, mesmo
// alvo (módulo/app). Usada para juntar repetições, não para comparar eventos
// diferentes.
function eventSignature(item) {
  return item.kind === 'log' ? `log:${item.action}:${item.target || ''}` : `event:${item.event_type}:${item.app}`
}

// Eventos idênticos e próximos no tempo viram uma linha só ("VP Click — 3
// acessos"), em vez do log bruto evento a evento. "Próximo" é até 30 min do
// evento anterior da mesma assinatura — perto o suficiente para ser a mesma
// sessão de uso, longe o bastante para não juntar acessos em momentos
// diferentes do dia.
const CONSOLIDATE_GAP_MS = 30 * 60 * 1000

function consolidateDayItems(items) {
  const chrono = [...items].sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
  // O gap é medido contra a última ocorrência DA MESMA assinatura, não contra
  // o evento anterior na lista — sem isso, alguém que dá uma passada por outro
  // sistema no meio de vários acessos ao mesmo módulo quebra o grupo em dois,
  // mesmo que as visitas ao módulo original continuem próximas entre si.
  const openBySig = new Map()
  const groups = []
  for (const item of chrono) {
    const sig = eventSignature(item)
    const open = openBySig.get(sig)
    if (open && new Date(item.criado_em) - new Date(open.lastAt) <= CONSOLIDATE_GAP_MS) {
      open.count += 1
      open.lastAt = item.criado_em
    } else {
      const group = { sig, rep: item, firstAt: item.criado_em, lastAt: item.criado_em, count: 1 }
      openBySig.set(sig, group)
      groups.push(group)
    }
  }
  // Mais recente primeiro, pela última ocorrência de cada grupo — mesma
  // convenção do resto da timeline, não pela primeira aparição.
  return groups.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
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

function groupByDeptAndUser(items, profileByEmail) {
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
  const users = Array.from(byUser.values())
    .sort((a, b) => new Date(b.days[0]?.items[0]?.criado_em || 0) - new Date(a.days[0]?.items[0]?.criado_em || 0))

  // Mesma regra da tela de Permissões: agrupa por departamento (chefe primeiro,
  // depois por nível, depois por nome), inativos numa seção própria por último.
  const groupsByDept = new Map()
  for (const u of users) {
    const profile = profileByEmail.get((u.user_email || '').toLowerCase())
    const dept = profile && profile.is_active === false ? 'Inativos' : (profile?.department || 'Sem departamento')
    if (!groupsByDept.has(dept)) groupsByDept.set(dept, [])
    groupsByDept.get(dept).push({ ...u, profile })
  }
  const deptOrder = [...DEPARTMENTS, 'Inativos', 'Sem departamento']
  return [
    ...deptOrder.filter(d => groupsByDept.has(d)),
    ...[...groupsByDept.keys()].filter(d => !deptOrder.includes(d)),
  ].map(dept => ({
    dept,
    members: groupsByDept.get(dept).sort((a, b) => {
      const pa = a.profile, pb = b.profile
      if (Boolean(pa?.is_department_lead) !== Boolean(pb?.is_department_lead)) return pa?.is_department_lead ? -1 : 1
      const rankDiff = (LEVEL_RANK[pa?.level] ?? 3) - (LEVEL_RANK[pb?.level] ?? 3)
      if (rankDiff !== 0) return rankDiff
      return (a.user_name || '').localeCompare(b.user_name || '')
    }),
  }))
}

function Timeline() {
  const [items, setItems] = useState([])
  const [profileByEmail, setProfileByEmail] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('7d')
  // Se algum lado bateu no teto de segurança, a janela pode conter mais
  // eventos do que os carregados — precisa ficar visível, não escondido.
  const [truncated, setTruncated] = useState(false)
  const [expandedDepts, setExpandedDepts] = useState(new Set())
  const [expandedUsers, setExpandedUsers] = useState(new Set())
  const [expandedDates, setExpandedDates] = useState(new Set())
  // Dias em que a pessoa pediu para ver o log bruto em vez da versão
  // consolidada (que é o padrão). Por dia, não global — quem quer auditar um
  // dia específico não precisa abrir mão da leitura rápida no resto.
  const [rawDates, setRawDates] = useState(new Set())

  function toggleDept(dept) {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      next.has(dept) ? next.delete(dept) : next.add(dept)
      return next
    })
  }
  function toggleUser(email) {
    setExpandedUsers(prev => {
      const next = new Set(prev)
      next.has(email) ? next.delete(email) : next.add(email)
      return next
    })
  }
  function toggleDate(key) {
    setExpandedDates(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  function toggleRaw(key) {
    setRawDates(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const days = PERIODS.find(p => p.key === period)?.days ?? 7
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()
    // Filtra por data no banco (.gte), não por "os N mais recentes" — assim a
    // cobertura é o período escolhido, não um corte arbitrário de linhas.
    const [logsRes, eventsRes, profilesRes] = await Promise.all([
      sbPortal.from('activity_logs').select('*').gte('criado_em', cutoff).order('criado_em', { ascending: false }).limit(SAFETY_CAP),
      sbPortal.from('activity_events').select('*').gte('criado_em', cutoff).order('criado_em', { ascending: false }).limit(SAFETY_CAP),
      sbPortal.from('profiles').select('email, name, department, level, is_department_lead, is_active'),
    ])
    const logs   = (logsRes.data   || []).map(l => ({ ...l, kind: 'log' }))
    const events = (eventsRes.data || []).map(e => ({ ...e, kind: 'event' }))
    const merged = [...logs, ...events].sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
    setItems(merged)
    setTruncated(logs.length >= SAFETY_CAP || events.length >= SAFETY_CAP)
    setProfileByEmail(new Map((profilesRes.data || []).map(p => [(p.email || '').toLowerCase(), p])))
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  const groups = groupByDeptAndUser(items, profileByEmail)

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Linha do Tempo</h2>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-slate-400 text-sm">Rastro de acesso e navegação entre todos os sistemas, por departamento e colaborador.</p>
        <div className="flex items-center gap-3">
          {/* Período explícito: antes a tela buscava "os 300 mais recentes"
              sem dizer quanto tempo isso cobria (podia ser só 2 dias de um
              histórico de 4 meses). Agora quem olha escolhe a janela e sabe
              exatamente o que está vendo. */}
          <div className="flex items-center bg-surface-card border border-surface-border rounded-lg p-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  period === p.key ? 'bg-brand text-surface' : 'text-slate-400 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={load} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5" title="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!loading && (
        <p className="text-slate-500 text-xs -mt-4">
          Mostrando <span className="text-slate-300 font-medium">{items.length}</span> evento{items.length === 1 ? '' : 's'} — período: <span className="text-slate-300 font-medium">{PERIODS.find(p => p.key === period)?.label}</span>.
          {' '}Departamento ou colaborador ausente aqui não teve atividade neste período.
        </p>
      )}

      {truncated && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Este período tem mais eventos do que os carregados aqui. Reduza para "Hoje" ou "7 dias" para ver a lista completa.
        </div>
      )}

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
        <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden divide-y divide-surface-border">
          {groups.map(group => {
            const deptOpen = expandedDepts.has(group.dept)
            const deptId = `ceo-dept-${slugify(group.dept)}`
            return (
              <div key={group.dept}>
                {/* h3 envolvendo o botão: padrão de acordeão acessível — dá
                    aos três níveis (departamento/colaborador/dia) uma posição
                    na árvore de headings, sem tirar o <button> como controle
                    real (só ele tem foco, Enter/Espaço e aria-expanded). */}
                <h3 className="contents">
                  <button
                    onClick={() => toggleDept(group.dept)}
                    aria-expanded={deptOpen}
                    aria-controls={deptId}
                    className="w-full flex items-center gap-2 px-5 py-3 bg-surface/60 hover:bg-surface/80 transition-colors text-left
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset"
                  >
                    {deptOpen ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                    <span className="text-xs font-bold uppercase tracking-wider text-brand">{group.dept}</span>
                    <span className="text-slate-500 text-xs">({group.members.length})</span>
                  </button>
                </h3>

                {/* O container sempre existe no DOM (só o conteúdo dentro é
                    condicional): assim o aria-controls dos três níveis aponta
                    sempre para um elemento real, mesmo fechado. */}
                <div id={deptId} className="divide-y divide-surface-border/60">
                  {deptOpen && group.members.map(user => {
                    const userOpen = expandedUsers.has(user.user_email)
                    const userId = `ceo-user-${slugify(user.user_email)}`
                    return (
                      <div key={user.user_email} className="pl-7">
                        <button
                          onClick={() => toggleUser(user.user_email)}
                          aria-expanded={userOpen}
                          aria-controls={userId}
                          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors text-left
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset"
                        >
                          {userOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                          <div className="w-6 h-6 rounded-full bg-brand/20 ring-1 ring-brand/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-brand font-bold text-[10px]">{(user.user_name || user.user_email || '?').slice(0, 2).toUpperCase()}</span>
                          </div>
                          <span className="text-white font-medium text-sm">{user.user_name || user.user_email}</span>
                          {user.profile?.is_department_lead && (
                            <Star className="w-3 h-3 text-blue-400 fill-blue-400 shrink-0" title="Líder do departamento" />
                          )}
                        </button>

                        <div id={userId} className="pl-9 pb-3 space-y-1">
                          {userOpen && user.days.map(day => {
                            const dateKey = `${user.user_email}::${day.dateKey}`
                            const dateOpen = expandedDates.has(dateKey)
                            const dateId = `ceo-date-${slugify(user.user_email)}-${slugify(day.dateKey)}`
                            return (
                              <div key={day.dateKey}>
                                <button
                                  onClick={() => toggleDate(dateKey)}
                                  aria-expanded={dateOpen}
                                  aria-controls={dateId}
                                  className="w-full flex items-center gap-2 py-2 hover:bg-white/5 rounded-lg transition-colors text-left
                                             focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                                >
                                  {dateOpen ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
                                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{day.label}</span>
                                  <span className="text-slate-600 text-xs">({day.items.length})</span>
                                  <div className="flex-1 h-px bg-surface-border" />
                                </button>

                                <div id={dateId} className="pl-5 pb-3 space-y-1">
                                  {dateOpen && (() => {
                                    const raw = rawDates.has(dateKey)
                                    const groups = raw ? null : consolidateDayItems(day.items)
                                    // Só vale mostrar o alternador quando a consolidação
                                    // realmente juntou algo — se não há repetição, os dois
                                    // modos são idênticos e o botão seria ruído.
                                    const hasRepeats = !raw && groups.some(g => g.count > 1)
                                    return (
                                      <>
                                        {(raw || hasRepeats) && (
                                          <button
                                            onClick={() => toggleRaw(dateKey)}
                                            className="text-[11px] text-slate-500 hover:text-slate-300 underline decoration-dotted
                                                       underline-offset-2 mb-1 transition-colors"
                                          >
                                            {raw ? 'Ver consolidado' : 'Ver eventos brutos'}
                                          </button>
                                        )}
                                        {raw
                                          ? day.items.map(item => {
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
                                            })
                                          : groups.map(g => {
                                              const { icon: Icon, color, bg, border, text } = timelineLabel(g.rep)
                                              const t1 = formatTime(g.firstAt)
                                              const t2 = formatTime(g.lastAt)
                                              const timeLabel = g.count === 1 ? t2 : (t1 === t2 ? t2 : `${t1}–${t2}`)
                                              return (
                                                <div key={`${g.sig}-${g.lastAt}`} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                                                  <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${bg} ${border} ${color} font-medium`}>
                                                    <Icon className="w-3 h-3" />
                                                    {text}
                                                    {g.count > 1 && (
                                                      <span className="ml-0.5 px-1 rounded bg-black/20 text-[10px] font-bold">×{g.count}</span>
                                                    )}
                                                  </span>
                                                  <span className="text-slate-600 text-xs ml-auto flex-shrink-0">{timeLabel}</span>
                                                </div>
                                              )
                                            })}
                                      </>
                                    )
                                  })()}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
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
                {/* Página sem nenhum heading até aqui — leitor de tela não
                    tinha por onde navegar a estrutura. h1 (só um por página). */}
                <h1 className="text-white font-semibold leading-none text-base">Painel Executivo</h1>
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
