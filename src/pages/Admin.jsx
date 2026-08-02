import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logActivity } from '../lib/activityLog'
import {
  ArrowLeft, UserPlus, Search, Loader2, AlertCircle,
  CheckCircle, XCircle, User, X, Send, Shield, Globe, Camera, Pencil,
  ChevronRight, ChevronDown, Star
} from 'lucide-react'
import { getModuleIcon } from '../lib/moduleIcons'

// CEO fica sempre primeiro (não é um departamento, é a liderança geral).
// Os demais ficam em ordem alfabética — assim nenhum departamento parece
// "mais importante" que outro, é só A-Z mesmo.
export const DEPARTMENTS = [
  'CEO',
  'Adm/Financeiro',
  'Comercial',
  'Engenharia',
  'Gente & Gestão',
  'Jurídico/Importação/Suprimentos',
  'Logística/Almoxarifado/Produção',
  'Marketing',
]
const LEVELS = ['Administrador', 'Lider', 'Colaborador']

// Nome de departamento → id utilizável em HTML (o aria-controls do botão de
// expandir precisa casar com o id do <tbody> do grupo).
function slugifyDept(dept) {
  return dept
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function Admin({ onBack }) {
  const [users,    setUsers]   = useState([])
  const [modules,  setModules] = useState([])
  const [loading,  setLoading] = useState(true)
  const [search,   setSearch]  = useState('')
  const [filterDept,   setFilterDept]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Seções de departamento expandidas (a lista some grande demais se tudo
  // ficar aberto de uma vez — cada departamento fica fechado até clicarem)
  const [expandedDepts, setExpandedDepts] = useState(new Set())
  function toggleDept(dept) {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      next.has(dept) ? next.delete(dept) : next.add(dept)
      return next
    })
  }

  // Modal convite
  const [showInvite,    setShowInvite]    = useState(false)
  const [invite,        setInvite]        = useState({ name: '', email: '', department: '', level: 'Colaborador', password: '', is_department_lead: false })
  const [inviting,      setInviting]      = useState(false)
  const [inviteMsg,     setInviteMsg]     = useState(null)
  const [showResend,    setShowResend]    = useState(false)  // e-mail já cadastrado → oferecer reenvio de credenciais
  const [avatarFile,    setAvatarFile]    = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)

  // Modal permissões
  const [permUser,      setPermUser]      = useState(null)   // usuário sendo editado
  const [permLevel,     setPermLevel]     = useState('')     // nível em edição
  const [permDept,      setPermDept]      = useState('')     // departamento em edição
  const [permIsLead,    setPermIsLead]    = useState(false)  // líder de departamento em edição
  const [permSlugs,     setPermSlugs]     = useState([])     // slugs marcados ([] = acesso pleno)
  const [permFull,      setPermFull]      = useState(true)   // toggle "acesso total"
  const [permLoading,   setPermLoading]   = useState(false)
  const [permSaving,    setPermSaving]    = useState(false)
  const [permMsg,       setPermMsg]       = useState(null)

  // Modal inativação
  const [toggleUser,    setToggleUser]    = useState(null)

  // Modal exclusão
  const [deleteUser,    setDeleteUser]    = useState(null)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteMsg,     setDeleteMsg]     = useState(null)

  // Modal editar nome
  const [editNameUser,  setEditNameUser]  = useState(null)   // usuário sendo editado
  const [editNameValue, setEditNameValue] = useState('')
  const [editNameSaving, setEditNameSaving] = useState(false)
  const [editNameMsg,   setEditNameMsg]   = useState(null)

  // Avatar update inline
  const [avatarUploading, setAvatarUploading] = useState({}) // { [userId]: bool }

  // Feedback inline
  const [actionMsg, setActionMsg] = useState(null)

  // Mapa de BLOQUEIOS: { [userId]: string[] }
  // Sem entrada (ou array vazio) = acesso total. O acesso é liberado por
  // padrão para todo colaborador; module_permissions só guarda exceções.
  const [blocksMap, setBlocksMap] = useState({})

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: u }, { data: m }, { data: allPerms }] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('modules').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('module_permissions').select('user_id, module_slug, can_access'),
    ])
    setUsers(u || [])
    setModules(m || [])

    // Agrupa BLOQUEIOS por user_id (linhas can_access = false). Linhas antigas
    // com can_access = true são liberações redundantes — todo mundo já acessa
    // tudo por padrão — e por isso são ignoradas aqui.
    const map = {}
    for (const p of (allPerms || [])) {
      if (p.can_access !== false) continue
      if (!map[p.user_id]) map[p.user_id] = []
      map[p.user_id].push(p.module_slug)
    }
    setBlocksMap(map)
    setLoading(false)
  }

  /** Slugs bloqueados para o colaborador ([] = acesso a todos os sistemas). */
  function getUserBlocked(userId) {
    return blocksMap[userId] || []
  }

  // Inativar tira o acesso da pessoa a todos os sistemas na hora, e o botão
  // fica encostado no "Excluir" — clique errado custa caro. Reativar é inócuo,
  // então só a inativação passa pela confirmação.
  function requestToggleActive(u) {
    if (u.is_active) setToggleUser(u)
    else toggleActive(u)
  }

  async function toggleActive(u) {
    const newStatus = !u.is_active
    setToggleUser(null)
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newStatus })
      .eq('id', u.id)

    if (error) {
      setActionMsg({ type: 'error', text: `Erro ao atualizar ${u.name}.` })
    } else {
      setUsers(prev => prev.map(p => p.id === u.id ? { ...p, is_active: newStatus } : p))
      logActivity({
        action: newStatus ? 'reactivate_user' : 'deactivate_user',
        target: u.email || u.name,
        details: { nome: u.name },
      })
      setActionMsg({
        type: 'success',
        text: `${u.name} foi ${newStatus ? 'reativado' : 'desativado'}.`
      })
    }
    setTimeout(() => setActionMsg(null), 3500)
  }

  function openEditName(u) {
    setEditNameUser(u)
    setEditNameValue(u.name || '')
    setEditNameMsg(null)
  }

  async function saveEditName() {
    const newName = editNameValue.trim()
    if (!newName) {
      setEditNameMsg({ type: 'error', text: 'O nome não pode ficar em branco.' })
      return
    }
    if (newName === editNameUser.name) {
      setEditNameUser(null)
      return
    }

    setEditNameSaving(true)
    setEditNameMsg(null)

    const oldName = editNameUser.name
    const { error } = await supabase
      .from('profiles')
      .update({ name: newName })
      .eq('id', editNameUser.id)

    if (error) {
      setEditNameMsg({ type: 'error', text: 'Erro ao atualizar o nome.' })
      setEditNameSaving(false)
      return
    }

    setUsers(prev => prev.map(p => p.id === editNameUser.id ? { ...p, name: newName } : p))
    logActivity({ action: 'edit_name', target: editNameUser.email, details: { nome_antigo: oldName, nome_novo: newName } })
    setEditNameMsg({ type: 'success', text: 'Nome atualizado com sucesso!' })
    setEditNameSaving(false)
    setTimeout(() => {
      setEditNameUser(null)
      setEditNameMsg(null)
    }, 1000)
  }

  async function openPerms(u) {
    setPermUser(u)
    setPermLevel(u.level || 'Colaborador')
    setPermDept(u.department || '')
    setPermIsLead(Boolean(u.is_department_lead))
    setPermMsg(null)
    setPermLoading(true)

    const { data: blocks } = await supabase
      .from('module_permissions')
      .select('module_slug')
      .eq('user_id', u.id)
      .eq('can_access', false)

    const blockedSlugs = (blocks || []).map(b => b.module_slug)
    const allSlugs = modules.map(m => m.slug)

    // Os checkboxes mostram os sistemas LIBERADOS: tudo marcado, menos os
    // bloqueios explícitos. Sem bloqueio = acesso total.
    setPermFull(blockedSlugs.length === 0)
    setPermSlugs(allSlugs.filter(s => !blockedSlugs.includes(s)))
    setPermLoading(false)
  }

  function toggleSlug(slug) {
    setPermSlugs(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    )
  }

  function toggleFullAccess(checked) {
    setPermFull(checked)
    // Marcar "acesso total" religa todos os sistemas; desmarcar mantém a
    // seleção atual (que começa com tudo liberado) para o admin tirar só o
    // que quiser bloquear.
    if (checked) setPermSlugs(modules.map(m => m.slug))
  }

  async function savePerms() {
    setPermSaving(true)
    setPermMsg(null)

    // 1. Atualiza nível, departamento e liderança (department/is_department_lead
    //    disparam o trigger auto_assign_manager_id no banco, que recalcula
    //    sozinho a posição desta pessoa no organograma do GenteGestão)
    const { error: levelErr } = await supabase
      .from('profiles')
      .update({ level: permLevel, department: permDept || null, is_department_lead: permIsLead })
      .eq('id', permUser.id)

    if (levelErr) {
      setPermMsg({ type: 'error', text: 'Erro ao salvar cargo.' })
      setPermSaving(false)
      return
    }

    // 2. Sincroniza module_permissions — que agora guarda só BLOQUEIOS.
    // Apaga o que existir do usuário e regrava apenas os sistemas desmarcados.
    await supabase
      .from('module_permissions')
      .delete()
      .eq('user_id', permUser.id)

    const blockedSlugs = permFull
      ? []
      : modules.map(m => m.slug).filter(s => !permSlugs.includes(s))

    if (blockedSlugs.length > 0) {
      const rows = blockedSlugs.map(slug => ({
        user_id: permUser.id,
        module_slug: slug,
        can_access: false,
      }))
      const { error: insertErr } = await supabase
        .from('module_permissions')
        .insert(rows)

      if (insertErr) {
        setPermMsg({ type: 'error', text: 'Erro ao salvar permissões de módulos.' })
        setPermSaving(false)
        return
      }
    }

    // Atualiza lista local de usuários com nível, departamento e liderança
    setUsers(prev => prev.map(p =>
      p.id === permUser.id
        ? { ...p, level: permLevel, department: permDept || null, is_department_lead: permIsLead }
        : p
    ))

    // Atualiza o mapa local de bloqueios para refletir na tabela imediatamente
    setBlocksMap(prev => {
      const next = { ...prev }
      if (blockedSlugs.length === 0) delete next[permUser.id]
      else next[permUser.id] = blockedSlugs
      return next
    })

    logActivity({
      action: 'change_permissions',
      target: permUser.name || permUser.email,
      details: {
        nivel: permLevel,
        departamento: permDept || '(nenhum)',
        lider_departamento: permIsLead,
        acesso: blockedSlugs.length === 0 ? 'pleno' : `bloqueado: ${blockedSlugs.join(', ')}`,
      },
    })
    setPermMsg({ type: 'success', text: 'Permissões salvas com sucesso!' })
    setPermSaving(false)
    setTimeout(() => {
      setPermUser(null)
      setPermMsg(null)
    }, 1500)
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  function resetInviteModal() {
    setInvite({ name: '', email: '', department: '', level: 'Colaborador', password: '', is_department_lead: false })
    setAvatarFile(null)
    setShowResend(false)
    if (avatarPreview) { URL.revokeObjectURL(avatarPreview); setAvatarPreview(null) }
  }

  async function handleInvite(e, resend = false) {
    e?.preventDefault()
    setInviting(true)
    setInviteMsg(null)

    // Upload avatar ANTES da edge function (service role fará o update do profile)
    let avatarUrl = null
    if (avatarFile) {
      const ext  = avatarFile.name.split('.').pop() || 'jpg'
      const tempPath = `pending/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(tempPath, avatarFile, { upsert: true, contentType: avatarFile.type })
      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(tempPath)
        avatarUrl = publicUrl
      }
    }

    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        email:      invite.email,
        name:       invite.name,
        level:      invite.level,
        department: invite.department || null,
        is_department_lead: invite.is_department_lead,
        password:   invite.password,
        avatar_url: avatarUrl,
        resend,
      }
    })

    // Em erro 4xx/5xx o supabase-js devolve um FunctionsHttpError genérico —
    // o corpo real (com a mensagem e o flag already_exists) fica em error.context.
    let payload = data
    if (error && !payload) {
      try { payload = await error.context.json() } catch { /* corpo não-JSON */ }
    }

    if (error || payload?.error) {
      const msg = payload?.error || error?.message || 'Erro ao criar usuário.'
      if (payload?.already_exists) {
        setShowResend(true)
        setInviteMsg({
          type: 'error',
          text: 'Este e-mail já tem conta (provável convite antigo sem e-mail). Use "Reenviar credenciais" abaixo: define esta senha temporária e envia o e-mail de acesso.',
        })
      } else {
        setInviteMsg({ type: 'error', text: msg })
      }
      logActivity({ action: 'invite_user_failed', target: invite.email, details: { erro: msg } })
      setInviting(false)
      return
    }

    // Renomear o arquivo do avatar para o userId definitivo
    if (avatarUrl && payload?.user?.id) {
      const userId = payload.user.id
      const ext    = avatarFile.name.split('.').pop() || 'jpg'
      const finalPath = `${userId}.${ext}`
      const tempPath  = avatarUrl.split('/avatars/')[1]
      await supabase.storage.from('avatars').move(tempPath, finalPath)
      const { data: { publicUrl: finalUrl } } = supabase.storage.from('avatars').getPublicUrl(finalPath)
      await supabase.from('profiles').update({ avatar_url: finalUrl }).eq('id', userId)
    }

    const ok     = payload?.platforms?.filter(p => p.status === 'ok').map(p => p.platform) || []
    const failed = payload?.platforms?.filter(p => p.status === 'error').map(p => p.platform) || []
    const extra  = (ok.length > 0 ? ` Também criado em: ${ok.join(', ')}.` : '')
      + (failed.length > 0 ? ` FALHOU em: ${failed.join(', ')}.` : '')

    const verb = resend ? 'Credenciais redefinidas' : 'Usuário criado'
    if (payload?.email_sent) {
      setInviteMsg({ type: 'success', text: `${verb} e e-mail com os dados de acesso enviado para ${invite.email}!${extra}` })
      resetInviteModal()
    } else {
      // Usuário criado/atualizado, mas o e-mail NÃO saiu — o admin precisa saber
      // na hora, senão o colaborador fica sem acesso de novo (caso Regiane).
      setInviteMsg({
        type: 'error',
        text: `${verb}, mas o e-mail NÃO foi enviado (${payload?.email_error || 'erro desconhecido'}). Informe a senha manualmente ou tente "Reenviar credenciais".${extra}`,
      })
      setShowResend(true)
    }
    logActivity({
      action: 'invite_user',
      target: invite.email,
      details: { nome: invite.name, nivel: invite.level, email_enviado: Boolean(payload?.email_sent), reenvio: resend },
    })
    loadAll()
    setInviting(false)
  }

  async function handleDelete() {
    if (!deleteUser) return
    setDeleting(true)
    setDeleteMsg(null)

    // Cadastro Simples (is_placeholder): não existe conta de login em
    // lugar nenhum, então não há o que fazer no delete-user — só remove a
    // linha de profiles direto.
    if (deleteUser.is_placeholder) {
      const { error: delErr } = await supabase.from('profiles').delete().eq('id', deleteUser.id)
      if (delErr) {
        setDeleteMsg({ type: 'error', text: 'Erro ao remover.' })
        setDeleting(false)
        return
      }
      logActivity({ action: 'delete_user', target: deleteUser.name, details: { tipo: 'cadastro_simples' } })
      setUsers(prev => prev.filter(u => u.id !== deleteUser.id))
      setDeleteUser(null)
      setDeleting(false)
      setActionMsg({ type: 'success', text: `${deleteUser.name} foi removido da lista.` })
      setTimeout(() => setActionMsg(null), 4000)
      return
    }

    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { user_id: deleteUser.id, email: deleteUser.email }
    })
    if (error || data?.error) {
      setDeleteMsg({ type: 'error', text: error?.message || data?.error || 'Erro ao excluir.' })
      setDeleting(false)
      return
    }

    const name = deleteUser.name || deleteUser.email

    if (data?.action === 'inactivated') {
      // Usuário tem transações registradas em algum satélite: exclusão
      // vira inativação para não órfão dados de negócio já gravados lá.
      logActivity({ action: 'delete_user', target: deleteUser.email, details: { resultado: 'inativado_por_transacoes' } })
      setUsers(prev => prev.map(p => p.id === deleteUser.id ? { ...p, is_active: false } : p))
      setDeleteUser(null)
      setDeleting(false)
      setActionMsg({
        type: 'success',
        text: `${name} possui transações registradas em algum sistema — foi apenas inativado, não excluído.`
      })
      setTimeout(() => setActionMsg(null), 5000)
      return
    }

    logActivity({ action: 'delete_user', target: deleteUser.email })
    setUsers(prev => prev.filter(u => u.id !== deleteUser.id))
    setDeleteUser(null)
    setDeleting(false)
    setActionMsg({ type: 'success', text: `${name} foi excluído de todos os sistemas.` })
    setTimeout(() => setActionMsg(null), 4000)
  }

  async function handleAvatarUpdate(userId, file) {
    if (!file) return
    setAvatarUploading(prev => ({ ...prev, [userId]: true }))

    const ext  = file.name.split('.').pop() || 'jpg'
    const path = `${userId}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (uploadErr) {
      console.error('Avatar upload error:', uploadErr)
      setActionMsg({ type: 'error', text: `Erro no upload: ${uploadErr.message}` })
      setTimeout(() => setActionMsg(null), 4000)
      setAvatarUploading(prev => ({ ...prev, [userId]: false }))
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    // Força cache-bust para o img atualizar imediatamente
    const urlWithBust = `${publicUrl}?t=${Date.now()}`

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)

    if (updateErr) {
      console.error('Profile update error:', updateErr)
      setActionMsg({ type: 'error', text: `Erro ao salvar perfil: ${updateErr.message}` })
    } else {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, avatar_url: urlWithBust } : u))
      setActionMsg({ type: 'success', text: 'Avatar atualizado com sucesso!' })
    }

    setTimeout(() => setActionMsg(null), 3500)
    setAvatarUploading(prev => ({ ...prev, [userId]: false }))
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

  // Agrupa por departamento (título da seção) com o chefe (is_department_lead)
  // sempre no topo, seguido pelos demais por nível e depois por nome.
  // Inativos saem do departamento de origem e vão todos para uma seção
  // única "Inativos", que fica sempre por último, antes de "Sem departamento".
  const LEVEL_RANK = { Administrador: 0, Lider: 1, Colaborador: 2 }
  const groupsByDept = new Map()
  for (const u of filtered) {
    const dept = !u.is_active ? 'Inativos' : (u.department || 'Sem departamento')
    if (!groupsByDept.has(dept)) groupsByDept.set(dept, [])
    groupsByDept.get(dept).push(u)
  }
  const deptOrder = [...DEPARTMENTS, 'Inativos', 'Sem departamento']
  const grouped = [
    ...deptOrder.filter(d => groupsByDept.has(d)),
    ...[...groupsByDept.keys()].filter(d => !deptOrder.includes(d)),
  ].map(dept => ({
    dept,
    members: groupsByDept.get(dept).sort((a, b) => {
      if (a.is_department_lead !== b.is_department_lead) return a.is_department_lead ? -1 : 1
      const rankDiff = (LEVEL_RANK[a.level] ?? 3) - (LEVEL_RANK[b.level] ?? 3)
      if (rankDiff !== 0) return rankDiff
      return (a.name || '').localeCompare(b.name || '')
    }),
  }))

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
            onClick={() => { setShowInvite(true); setInviteMsg(null); resetInviteModal() }}
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
                         rounded-lg pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:border-brand transition-colors"
            />
            {/* Sem isto, limpar a busca exige selecionar tudo e apagar — e a
                lista parece vazia enquanto o texto continua no campo. */}
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                title="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            )}
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
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden sm:table-cell">Nível</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4">Status</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden lg:table-cell">Acessos</th>
                    <th className="text-right text-xs text-slate-500 uppercase tracking-wider px-6 py-4">Ações</th>
                  </tr>
                </thead>
                {filtered.length === 0 && (
                  <tbody className="divide-y divide-surface-border">
                    <tr>
                      <td colSpan={5} className="text-center text-slate-500 py-12 text-sm">
                        Nenhum colaborador encontrado.
                      </td>
                    </tr>
                  </tbody>
                )}
                {/* Um <tbody> por departamento: dá ao grupo um elemento real
                    para o aria-controls do botão de expandir apontar. */}
                {filtered.length > 0 && grouped.map(group => {
                    const isOpen = Boolean(search.trim()) || expandedDepts.has(group.dept)
                    return (
                    <tbody key={group.dept} id={`dept-${slugifyDept(group.dept)}`}
                           className="divide-y divide-surface-border">
                      {/* O cabeçalho do grupo é um <button> de verdade, não um
                          <tr onClick>: assim chega pelo Tab, responde a Enter
                          e Espaço, e o leitor de tela anuncia o estado pelo
                          aria-expanded. */}
                      <tr className="bg-surface/60">
                        <td colSpan={5} className="p-0">
                          <button
                            type="button"
                            onClick={() => toggleDept(group.dept)}
                            aria-expanded={isOpen}
                            aria-controls={`dept-${slugifyDept(group.dept)}`}
                            className="w-full px-6 py-3 text-left select-none hover:bg-surface/80
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60
                                       focus-visible:ring-inset transition-colors"
                          >
                            <span className="flex items-center gap-2">
                              {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                              <span className="text-xs font-bold uppercase tracking-wider text-brand">{group.dept}</span>
                              <span className="text-slate-500 text-xs">({group.members.length})</span>
                            </span>
                          </button>
                        </td>
                      </tr>
                      {isOpen && group.members.map(u => (
                        <tr key={u.id} className={`transition-colors hover:bg-surface/40 ${!u.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {/* Avatar clicável com overlay "Trocar avatar" */}
                          <label
                            className="relative w-9 h-9 rounded-full overflow-hidden shrink-0 cursor-pointer group"
                            title="Trocar avatar"
                          >
                            <div className="w-full h-full bg-surface-border flex items-center justify-center">
                              {avatarUploading[u.id] ? (
                                <Loader2 className="w-4 h-4 text-brand animate-spin" />
                              ) : u.avatar_url ? (
                                <img src={u.avatar_url} alt={u.name} className="w-full h-full object-cover"
                                     onError={e => { e.target.style.display = 'none' }} />
                              ) : (
                                <User className="w-4 h-4 text-slate-500" />
                              )}
                            </div>
                            {/* Overlay hover */}
                            {!avatarUploading[u.id] && (
                              <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100
                                              transition-opacity flex flex-col items-center justify-center gap-0.5 rounded-full">
                                <Camera className="w-3 h-3 text-white" />
                                <span className="text-[7px] font-bold text-white uppercase tracking-wide leading-none">Trocar</span>
                              </div>
                            )}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="sr-only"
                              onChange={e => {
                                handleAvatarUpdate(u.id, e.target.files?.[0])
                                e.target.value = ''
                              }}
                            />
                          </label>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-white text-sm font-medium leading-none">{u.name}</p>
                              {u.is_department_lead && (
                                <Star
                                  className="w-3.5 h-3.5 text-blue-400 fill-blue-400 shrink-0"
                                  title="Líder do departamento"
                                />
                              )}
                              <button
                                onClick={() => openEditName(u)}
                                className="text-white hover:text-brand transition-colors"
                                title="Editar nome"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                            <p className="text-slate-500 text-xs mt-0.5">
                              {u.email || (u.is_placeholder && <span className="italic">Sem conta de login</span>)}
                            </p>
                          </div>
                        </div>
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
                          const blockedSlugs = getUserBlocked(u.id)

                          // Sem conta de login ainda: o acesso liberado por
                          // padrão não vale de nada até a pessoa ter e-mail/login,
                          // então marca como pendente em vez de listar tudo.
                          if (u.is_placeholder && blockedSlugs.length === 0) {
                            return <span className="text-xs text-slate-600 italic">Sem acesso definido</span>
                          }

                          const visibleMods = modules.filter(m => !blockedSlugs.includes(m.slug))

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
                                    title={u.is_placeholder ? `${mod.name} (pendente — sem login ainda)` : mod.name}
                                    className={`w-6 h-6 rounded-md flex items-center justify-center ${u.is_placeholder ? 'opacity-50' : ''}`}
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
                            title={u.is_placeholder
                              ? 'Definir cargo e acessos com antecedência (valem quando ele tiver login)'
                              : 'Gerenciar cargo e acesso aos sistemas'}
                          >
                            <Shield className="w-3.5 h-3.5" />
                            Permissões
                          </button>
                          <button
                            onClick={() => requestToggleActive(u)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors
                              ${u.is_active
                                ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                                : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}
                          >
                            {u.is_active ? 'Inativar' : 'Reativar'}
                          </button>
                          <button
                            onClick={() => { setDeleteUser(u); setDeleteMsg(null) }}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg border
                                       border-red-700/40 text-red-500 hover:bg-red-700/15 transition-colors"
                            title={u.is_placeholder ? 'Remover da lista' : 'Excluir permanentemente de todos os sistemas'}
                          >
                            {u.is_placeholder ? 'Remover' : 'Excluir'}
                          </button>
                        </div>
                      </td>
                        </tr>
                      ))}
                    </tbody>
                  )})}
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

                {/* Departamento */}
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Departamento
                  </label>
                  <select
                    value={permDept}
                    onChange={e => setPermDept(e.target.value)}
                    className="w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-3 py-3 text-sm
                               focus:outline-none focus:border-brand transition-colors"
                  >
                    <option value="">Selecionar</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {/* Líder de departamento */}
                <label className="flex items-center gap-3 p-3 rounded-lg border border-surface-border cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permIsLead}
                    onChange={e => setPermIsLead(e.target.checked)}
                    className="w-4 h-4 accent-amber-400 cursor-pointer"
                  />
                  <div>
                    <span className="text-slate-300 text-sm font-medium block">É líder do departamento</span>
                    <span className="text-slate-500 text-xs">Define quem os demais colaboradores desse departamento reportam no organograma.</span>
                  </div>
                </label>

                {/* Acesso aos sistemas */}
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-3">
                    Acesso aos Sistemas
                  </label>
                  <p className="text-slate-500 text-xs mb-3 leading-relaxed">
                    Todo colaborador cadastrado entra em todos os sistemas por padrão.
                    Desmarque apenas o que este colaborador <strong className="text-slate-400">não</strong> deve acessar.
                  </p>

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
                    <p className="text-red-400 text-xs mt-2 italic">
                      Nenhum sistema marcado — o colaborador ficará bloqueado em todos os sistemas.
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

      {/* ── Modal: Editar Nome ── */}
      {editNameUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold text-lg">Editar Nome</h2>
              <button
                type="button"
                onClick={() => { setEditNameUser(null); setEditNameMsg(null) }}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={e => { e.preventDefault(); saveEditName() }}
              className="space-y-4"
            >
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Nome</label>
                <input
                  type="text"
                  value={editNameValue}
                  onChange={e => setEditNameValue(e.target.value)}
                  placeholder="Nome do colaborador"
                  autoFocus
                  required
                  className="w-full mt-1 bg-surface border border-surface-border text-white placeholder-slate-600
                             rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                />
                <p className="text-slate-500 text-xs mt-1">{editNameUser.email}</p>
              </div>

              {editNameMsg && (
                <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm
                  ${editNameMsg.type === 'success'
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                  {editNameMsg.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  {editNameMsg.text}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setEditNameUser(null); setEditNameMsg(null) }}
                  disabled={editNameSaving}
                  className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-surface-border
                             text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editNameSaving}
                  className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg
                             bg-brand hover:bg-brand/90 text-black transition-colors
                             flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {editNameSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmar Inativação ── */}
      {toggleUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-yellow-600/40 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-yellow-500/15 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-yellow-500" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">Inativar colaborador?</h2>
                <p className="text-slate-400 text-sm mt-1">
                  <span className="text-white font-semibold">{toggleUser.name || toggleUser.email}</span> perde
                  o acesso ao portal e a <span className="text-yellow-400 font-semibold">todos os sistemas VP</span> imediatamente.
                </p>
                <p className="text-slate-500 text-xs mt-2">
                  O cadastro não é apagado — dá para reativar a qualquer momento por este mesmo botão.
                </p>
              </div>
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => setToggleUser(null)}
                  className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-surface-border
                             text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => toggleActive(toggleUser)}
                  className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg
                             bg-yellow-600 hover:bg-yellow-700 text-white transition-colors"
                >
                  Inativar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmar Exclusão ── */}
      {deleteUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-red-700/40 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
                <XCircle className="w-7 h-7 text-red-500" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">
                  {deleteUser.is_placeholder ? 'Remover da lista?' : 'Excluir colaborador?'}
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  {deleteUser.is_placeholder ? (
                    <>
                      <span className="text-white font-semibold">{deleteUser.name}</span> será
                      removido da lista de colaboradores. Ele não tem conta de login em nenhum sistema VP.
                    </>
                  ) : (
                    <>
                      <span className="text-white font-semibold">{deleteUser.name || deleteUser.email}</span> será
                      removido permanentemente de <span className="text-red-400 font-semibold">todos os sistemas VP</span>,
                      desde que não tenha transações registradas neles. Havendo qualquer transação, o colaborador
                      será apenas <span className="text-yellow-400 font-semibold">inativado</span> em vez de excluído.
                    </>
                  )}
                </p>
              </div>
              {deleteMsg && (
                <div className="w-full flex items-center gap-2 rounded-lg px-4 py-3 text-sm bg-red-500/10 border border-red-500/30 text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {deleteMsg.text}
                </div>
              )}
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => { setDeleteUser(null); setDeleteMsg(null) }}
                  disabled={deleting}
                  className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-surface-border
                             text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg
                             bg-red-600 hover:bg-red-700 text-white transition-colors
                             flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Excluindo...</> : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Convidar ── */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-md shadow-2xl">

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold text-lg">Convidar Colaborador</h2>
              <button type="button" onClick={() => { setShowInvite(false); resetInviteModal(); setInviteMsg(null) }}
                      className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInvite} className="space-y-4">

              {/* Avatar picker */}
              <div className="flex flex-col items-center gap-2 pb-2">
                <label className="cursor-pointer group relative">
                  <div className="w-20 h-20 rounded-full border-2 border-dashed border-surface-border
                                  group-hover:border-brand transition-colors overflow-hidden
                                  flex items-center justify-center bg-surface">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-slate-500 group-hover:text-brand transition-colors">
                        <Camera className="w-6 h-6" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Foto</span>
                      </div>
                    )}
                  </div>
                  {avatarPreview && (
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100
                                    transition-opacity flex items-center justify-center">
                      <Camera className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAvatarChange}
                    className="sr-only"
                  />
                </label>
                <span className="text-slate-500 text-xs">Foto do colaborador (opcional)</span>
              </div>

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

              <label className="flex items-center gap-3 p-3 rounded-lg border border-surface-border cursor-pointer">
                <input
                  type="checkbox"
                  checked={invite.is_department_lead}
                  onChange={e => setInvite(p => ({ ...p, is_department_lead: e.target.checked }))}
                  className="w-4 h-4 accent-amber-400 cursor-pointer"
                />
                <div>
                  <span className="text-slate-300 text-sm font-medium block">É líder do departamento</span>
                  <span className="text-slate-500 text-xs">Define quem os demais colaboradores desse departamento reportam no organograma.</span>
                </div>
              </label>

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
                  Enviada por e-mail ao colaborador junto com o link de acesso. Ele poderá trocar via "Esqueci minha senha".
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

              {showResend && (
                <button
                  type="button"
                  onClick={() => handleInvite(null, true)}
                  disabled={inviting}
                  className="w-full bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40
                             disabled:opacity-60 text-orange-300 font-bold rounded-lg py-3 text-sm
                             flex items-center justify-center gap-2 transition-colors"
                >
                  <Send className="w-4 h-4" /> Reenviar credenciais (redefine a senha e envia o e-mail)
                </button>
              )}

            </form>
          </div>
        </div>
      )}
    </div>
  )
}
