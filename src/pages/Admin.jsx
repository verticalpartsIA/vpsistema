import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logActivity } from '../lib/activityLog'
import {
  ArrowLeft, UserPlus, Search, Loader2, AlertCircle,
  CheckCircle, XCircle, User, X, Send, Shield, Globe
} from 'lucide-react'
import { getModuleIcon } from '../lib/moduleIcons'

const DEPARTMENTS = ['Compras', 'Engenharia', 'Financeiro', 'Logistica', 'MKT', 'Vendas']
const LEVELS      = ['Administrador', 'Lider', 'Colaborador']

export default function Admin({ onBack }) {
  const [users,    setUsers]   = useState([])
  const [modules,  setModules] = useState([])
  const [loading,  setLoading] = useState(true)
  const [search,   setSearch]  = useState('')
  const [filterDept,   setFilterDept]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Modal convite
  const [showInvite, setShowInvite] = useState(false)
  const [invite,     setInvite]     = useState({ name: '', email: '', department: '', level: 'Colaborador', password: '' })
  const [inviting,   setInviting]   = useState(false)
  const [inviteMsg,  setInviteMsg]  = useState(null)

  // Modal permissões
  const [permUser,      setPermUser]      = useState(null)   // usuário sendo editado
  const [permLevel,     setPermLevel]     = useState('')     // nível em edição
  const [permSlugs,     setPermSlugs]     = useState([])     // slugs marcados ([] = acesso pleno)
  const [permFull,      setPermFull]      = useState(true)   // toggle "acesso total"
  const [permLoading,   setPermLoading]   = useState(false)
  const [permSaving,    setPermSaving]    = useState(false)
  const [permMsg,       setPermMsg]       = useState(null)

  // Feedback inline
  const [actionMsg, setActionMsg] = useState(null)

  // Mapa de permissões: { [userId]: string[] | 'full' }
  // 'full' = acesso total (sem linhas no banco)
  const [permsMap, setPermsMap] = useState({})

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: u }, { data: m }, { data: allPerms }] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('modules').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('module_permissions').select('user_id, module_slug'),
    ])
    setUsers(u || [])
    setModules(m || [])

    // Agrupa permissões por user_id
    const map = {}
    for (const p of (allPerms || [])) {
      if (!map[p.user_id]) map[p.user_id] = []
      map[p.user_id].push(p.module_slug)
    }
    setPermsMap(map)
    setLoading(false)
  }

  /** Retorna slugs permitidos para exibição inline.
   *  null  = acesso total (sem entradas no banco)
   *  []    = sem acesso
   *  [...] = slugs restritos */
  function getUserSlugs(userId) {
    return permsMap.hasOwnProperty(userId) ? permsMap[userId] : null
  }

  async function toggleActive(u) {
    const newStatus = !u.is_active
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newStatus })
      .eq('id', u.id)

    if (error) {
      setActionMsg({ type: 'error', text: `Erro ao atualizar ${u.name}.` })
    } else {
      setUsers(prev => prev.map(p => p.id === u.id ? { ...p, is_active: newStatus } : p))
      setActionMsg({
        type: 'success',
        text: `${u.name} foi ${newStatus ? 'reativado' : 'desativado'}.`
      })
    }
    setTimeout(() => setActionMsg(null), 3500)
  }

  async function openPerms(u) {
    setPermUser(u)
    setPermLevel(u.level || 'Colaborador')
    setPermMsg(null)
    setPermLoading(true)

    const { data: perms } = await supabase
      .from('module_permissions')
      .select('module_slug')
      .eq('user_id', u.id)

    if (perms && perms.length > 0) {
      setPermFull(false)
      setPermSlugs(perms.map(p => p.module_slug))
    } else {
      setPermFull(true)
      setPermSlugs([])
    }
    setPermLoading(false)
  }

  function toggleSlug(slug) {
    setPermSlugs(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    )
  }

  function toggleFullAccess(checked) {
    setPermFull(checked)
    if (checked) setPermSlugs([])
  }

  async function savePerms() {
    setPermSaving(true)
    setPermMsg(null)

    // 1. Atualiza o nível/cargo
    const { error: levelErr } = await supabase
      .from('profiles')
      .update({ level: permLevel })
      .eq('id', permUser.id)

    if (levelErr) {
      setPermMsg({ type: 'error', text: 'Erro ao salvar cargo.' })
      setPermSaving(false)
      return
    }

    // 2. Sincroniza module_permissions
    // Apaga todas as permissões existentes do usuário
    await supabase
      .from('module_permissions')
      .delete()
      .eq('user_id', permUser.id)

    // Se não é acesso pleno, insere os slugs marcados
    if (!permFull && permSlugs.length > 0) {
      const rows = permSlugs.map(slug => ({ user_id: permUser.id, module_slug: slug }))
      const { error: insertErr } = await supabase
        .from('module_permissions')
        .insert(rows)

      if (insertErr) {
        setPermMsg({ type: 'error', text: 'Erro ao salvar permissões de módulos.' })
        setPermSaving(false)
        return
      }
    }

    // Atualiza lista local de usuários com o novo nível
    setUsers(prev => prev.map(p =>
      p.id === permUser.id ? { ...p, level: permLevel } : p
    ))

    // Atualiza o permsMap local para refletir na tabela imediatamente
    setPermsMap(prev => {
      const next = { ...prev }
      if (permFull || permSlugs.length === 0) {
        // Acesso pleno: remove entrada do mapa
        delete next[permUser.id]
      } else {
        next[permUser.id] = [...permSlugs]
      }
      return next
    })

    logActivity({ action: 'change_permissions', target: permUser.name || permUser.email, details: { nivel: permLevel, acesso: permFull ? 'pleno' : permSlugs.join(', ') || 'nenhum' } })
    setPermMsg({ type: 'success', text: 'Permissões salvas com sucesso!' })
    setPermSaving(false)
    setTimeout(() => {
      setPermUser(null)
      setPermMsg(null)
    }, 1500)
  }

  async function handleInvite(e) {
    e.preventDefault()
    setInviting(true)
    setInviteMsg(null)

    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        email:      invite.email,
        name:       invite.name,
        level:      invite.level,
        department: invite.department || null,
        password:   invite.password,
      }
    })

    if (error || data?.error) {
      setInviteMsg({ type: 'error', text: error?.message || data?.error || 'Erro ao criar usuário.' })
    } else {
      const ok = data?.platforms?.filter(p => p.status === 'ok').map(p => p.platform) || []
      const extra = ok.length > 0 ? ` Também criado em: ${ok.join(', ')}.` : ''
      setInviteMsg({ type: 'success', text: `Usuário ${invite.email} criado com sucesso!${extra}` })
      logActivity({ action: 'invite_user', target: invite.email, details: { nome: invite.name, nivel: invite.level } })
      setInvite({ name: '', email: '', department: '', level: 'Colaborador', password: '' })
      loadAll()
    }
    setInviting(false)
  }

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
    const matchDept   = !filterDept   || u.department === filterDept
    const matchStatus = !filterStatus ||
      (filterStatus === 'ativo'   &&  u.is_active) ||
      (filterStatus === 'inativo' && !u.is_active)
    return matchSearch && matchDept && matchStatus
  })

  const total    = users.length
  const ativos   = users.filter(u => u.is_active).length
  const inativos = users.filter(u => !u.is_active).length

  return (
    <div className="min-h-screen bg-surface flex flex-col">

      {/* Header */}
      <header className="bg-surface-card border-b border-surface-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <span className="text-surface-border">|</span>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center">
                <span className="text-surface font-black text-sm">VP</span>
              </div>
              <span className="text-white font-semibold">Gestão de Colaboradores</span>
            </div>
          </div>

          <button
            onClick={() => { setShowInvite(true); setInviteMsg(null) }}
            className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-surface
                       font-bold rounded-lg px-4 py-2 text-sm transition-colors shadow-md shadow-brand/20"
          >
            <UserPlus className="w-4 h-4" />
            Convidar
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total',    value: total,    color: 'text-white' },
            { label: 'Ativos',   value: ativos,   color: 'text-green-400' },
            { label: 'Inativos', value: inativos, color: 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="bg-surface-card border border-surface-border rounded-xl p-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-slate-500 text-xs mt-1 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Feedback ação */}
        {actionMsg && (
          <div className={`flex items-center gap-2 rounded-lg px-4 py-3 mb-4 text-sm
            ${actionMsg.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {actionMsg.type === 'success'
              ? <CheckCircle className="w-4 h-4 shrink-0" />
              : <AlertCircle className="w-4 h-4 shrink-0" />}
            {actionMsg.text}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou e-mail..."
              className="w-full bg-surface-card border border-surface-border text-white placeholder-slate-600
                         rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand transition-colors"
            />
          </div>

          <select
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            className="bg-surface-card border border-surface-border text-slate-300 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-brand transition-colors"
          >
            <option value="">Todos os departamentos</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-surface-card border border-surface-border text-slate-300 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-brand transition-colors"
          >
            <option value="">Todos os status</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand animate-spin" />
          </div>
        ) : (
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-border">
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-6 py-4">Colaborador</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden md:table-cell">Departamento</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden sm:table-cell">Nível</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4">Status</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden lg:table-cell">Acessos</th>
                    <th className="text-right text-xs text-slate-500 uppercase tracking-wider px-6 py-4">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-500 py-12 text-sm">
                        Nenhum colaborador encontrado.
                      </td>
                    </tr>
                  ) : filtered.map(u => (
                    <tr key={u.id} className={`transition-colors hover:bg-surface/40 ${!u.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-surface-border flex items-center justify-center overflow-hidden shrink-0">
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt={u.name} className="w-full h-full object-cover"
                                   onError={e => { e.target.style.display = 'none' }} />
                            ) : (
                              <User className="w-4 h-4 text-slate-500" />
                            )}
                          </div>
                          <div>
                            <p className="text-white text-sm font-medium leading-none">{u.name}</p>
                            <p className="text-slate-500 text-xs mt-0.5">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 hidden md:table-cell">
                        <span className="text-slate-400 text-sm">{u.department || '—'}</span>
                      </td>
                      <td className="px-4 py-4 hidden sm:table-cell">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full
                          ${u.level === 'Administrador' ? 'bg-brand/20 text-brand' :
                            u.level === 'Lider' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-slate-500/20 text-slate-400'}`}>
                          {u.level || 'Colaborador'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {u.is_active ? (
                          <span className="flex items-center gap-1.5 text-xs text-green-400">
                            <CheckCircle className="w-3.5 h-3.5" /> Ativo
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> Inativo
                          </span>
                        )}
                      </td>

                      {/* Ícones de acesso inline */}
                      <td className="px-4 py-4 hidden lg:table-cell">
                        {(() => {
                          const slugs = getUserSlugs(u.id)
                          // Acesso total: mostra todos os ícones
                          const visibleMods = slugs === null
                            ? modules
                            : modules.filter(m => slugs.includes(m.slug))

                          if (visibleMods.length === 0) {
                            return (
                              <span className="text-xs text-slate-600 italic">Sem acesso</span>
                            )
                          }
                          return (
                            <div className="flex items-center gap-1 flex-wrap">
                              {visibleMods.map(mod => {
                                const ModIcon = getModuleIcon(mod.icon)
                                const color   = mod.color || '#F59E0B'
                                return (
                                  <div
                                    key={mod.slug}
                                    title={mod.name}
                                    className="w-6 h-6 rounded-md flex items-center justify-center"
                                    style={{ background: `${color}20` }}
                                  >
                                    <ModIcon
                                      className="w-3.5 h-3.5"
                                      strokeWidth={1.75}
                                      style={{ color }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openPerms(u)}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border
                                       border-brand/30 text-brand hover:bg-brand/10 transition-colors"
                            title="Gerenciar cargo e acesso aos sistemas"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            Permissões
                          </button>
                          <button
                            onClick={() => toggleActive(u)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors
                              ${u.is_active
                                ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                                : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}
                          >
                            {u.is_active ? 'Inativar' : 'Reativar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── Modal: Permissões ── */}
      {permUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-lg shadow-2xl">

            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-white font-bold text-lg">Cargo e Acessos</h2>
                <p className="text-slate-500 text-sm mt-0.5">{permUser.name}</p>
              </div>
              <button onClick={() => setPermUser(null)}
                      className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {permLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 text-brand animate-spin" />
              </div>
            ) : (
              <div className="space-y-6">

                {/* Cargo */}
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Cargo / Nível
                  </label>
                  <select
                    value={permLevel}
                    onChange={e => setPermLevel(e.target.value)}
                    className="w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-3 py-3 text-sm
                               focus:outline-none focus:border-brand transition-colors"
                  >
                    {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                {/* Acesso aos sistemas */}
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-3">
                    Acesso aos Sistemas
                  </label>

                  {/* Toggle acesso total */}
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-brand/40 bg-brand/5 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={permFull}
                      onChange={e => toggleFullAccess(e.target.checked)}
                      className="w-4 h-4 accent-amber-400 cursor-pointer"
                    />
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-brand" />
                      <span className="text-brand text-sm font-medium">Acesso total (todos os sistemas)</span>
                    </div>
                  </label>

                  {/* Lista de módulos individuais */}
                  {!permFull && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {modules.map(mod => {
                        const checked  = permSlugs.includes(mod.slug)
                        const modColor = mod.color || '#F59E0B'
                        const ModIcon  = getModuleIcon(mod.icon)
                        return (
                          <label
                            key={mod.slug}
                            className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-150"
                            style={checked ? {
                              borderColor: `${modColor}60`,
                              background:  `${modColor}12`,
                            } : {
                              borderColor: 'rgba(255,255,255,0.07)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSlug(mod.slug)}
                              className="w-4 h-4 cursor-pointer shrink-0"
                              style={{ accentColor: modColor }}
                            />
                            {/* Ícone do módulo */}
                            <div
                              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all"
                              style={{
                                background: checked ? `${modColor}25` : 'rgba(255,255,255,0.05)',
                              }}
                            >
                              <ModIcon
                                className="w-4 h-4"
                                strokeWidth={1.75}
                                style={{ color: checked ? modColor : '#64748b' }}
                              />
                            </div>
                            <span
                              className="text-sm font-medium transition-colors"
                              style={{ color: checked ? '#e2e8f0' : '#64748b' }}
                            >
                              {mod.name}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {!permFull && permSlugs.length === 0 && (
                    <p className="text-slate-500 text-xs mt-2 italic">
                      Nenhum sistema selecionado — o colaborador não terá acesso a nenhum sistema.
                    </p>
                  )}
                </div>

                {/* Feedback */}
                {permMsg && (
                  <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm
                    ${permMsg.type === 'success'
                      ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                      : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                    {permMsg.type === 'success'
                      ? <CheckCircle className="w-4 h-4 shrink-0" />
                      : <AlertCircle className="w-4 h-4 shrink-0" />}
                    {permMsg.text}
                  </div>
                )}

                <button
                  onClick={savePerms}
                  disabled={permSaving}
                  className="w-full bg-brand hover:bg-brand-dark disabled:opacity-60 text-surface
                             font-bold rounded-lg py-3 text-sm flex items-center justify-center gap-2
                             transition-colors"
                >
                  {permSaving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
                    : <><Shield className="w-4 h-4" /> Salvar Permissões</>}
                </button>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Convidar ── */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-md shadow-2xl">

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold text-lg">Convidar Colaborador</h2>
              <button onClick={() => setShowInvite(false)}
                      className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInvite} className="space-y-4">

              <div>
                <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  Nome completo
                </label>
                <input
                  type="text"
                  value={invite.name}
                  onChange={e => setInvite(p => ({ ...p, name: e.target.value }))}
                  placeholder="Nome do colaborador"
                  required
                  className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                             rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                />
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  E-mail corporativo
                </label>
                <input
                  type="email"
                  value={invite.email}
                  onChange={e => setInvite(p => ({ ...p, email: e.target.value }))}
                  placeholder="nome@verticalparts.com.br"
                  required
                  className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                             rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Departamento
                  </label>
                  <select
                    value={invite.department}
                    onChange={e => setInvite(p => ({ ...p, department: e.target.value }))}
                    className="w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-3 py-3 text-sm
                               focus:outline-none focus:border-brand transition-colors"
                  >
                    <option value="">Selecionar</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Cargo / Nível
                  </label>
                  <select
                    value={invite.level}
                    onChange={e => setInvite(p => ({ ...p, level: e.target.value }))}
                    className="w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-3 py-3 text-sm
                               focus:outline-none focus:border-brand transition-colors"
                  >
                    {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  Senha temporária
                </label>
                <input
                  type="password"
                  value={invite.password}
                  onChange={e => setInvite(p => ({ ...p, password: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  required
                  minLength={6}
                  className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                             rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                />
                <p className="text-slate-500 text-xs mt-1">
                  O colaborador poderá trocar via "Esqueci minha senha" após o primeiro acesso.
                </p>
              </div>

              {inviteMsg && (
                <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm
                  ${inviteMsg.type === 'success'
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                  {inviteMsg.type === 'success'
                    ? <CheckCircle className="w-4 h-4 shrink-0" />
                    : <AlertCircle className="w-4 h-4 shrink-0" />}
                  {inviteMsg.text}
                </div>
              )}

              <button
                type="submit"
                disabled={inviting}
                className="w-full bg-brand hover:bg-brand-dark disabled:opacity-60 text-surface
                           font-bold rounded-lg py-3 text-sm flex items-center justify-center gap-2
                           transition-colors mt-2"
              >
                {inviting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
                  : <><Send className="w-4 h-4" /> Enviar Convite</>}
              </button>

            </form>
          </div>
        </div>
      )}
    </div>
  )
}
