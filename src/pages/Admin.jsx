import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logActivity } from '../lib/activityLog'
import {
  ArrowLeft, UserPlus, Search, Loader2, AlertCircle,
  CheckCircle, XCircle, User, X, Send, Shield, Globe, Camera, Pencil,
  ChevronRight, ChevronDown, Star, KeyRound, Lock, LockOpen, Puzzle, Repeat
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

// Topo da árvore de permissões (migration 20261009120000_poderes_e_valores).
// As regras de quem altera o quê valem no banco; aqui a tela só as reflete.
const POWER_LEVELS = [
  { value: 'plenos', label: 'Plenos', hint: 'Igual ao Gelson e ao Diego, inclusive dar poderes a si mesmo.' },
  { value: 'medios', label: 'Médios', hint: 'Dá poderes a quem está abaixo, mas nunca a si mesmo.' },
  { value: 'baixos', label: 'Baixos', hint: 'Não abre valores e não dá poderes. Ajusta só departamento e status.' },
  { value: '',       label: 'Nenhum', hint: 'Não abre a Administração.' },
]
const POWER_LABEL = { plenos: 'Plenos', medios: 'Médios', baixos: 'Baixos' }

// Inativação: 1ª pergunta é o motivo. Só "Demissão" abre o checklist de
// devolução de ativos. "Suspensão de acesso" cobre afastamento, licença ou
// motivo ainda não definido (decisão do Gelson, 09/10/2026).
const INACTIVATION_REASONS = [
  { value: 'demissao',  label: 'Demissão',            hint: 'Desligamento da empresa. Abre o checklist de devolução.' },
  { value: 'suspensao', label: 'Suspensão de acesso', hint: 'Afastamento, licença ou motivo ainda não definido. Reversível.' },
]
const REASON_LABEL = { demissao: 'Demissão', suspensao: 'Suspensão de acesso' }
const RETURN_ITEMS = ['Crachá', 'Celular corporativo', 'Notebook']
const RETURN_STATUS = [
  { value: 'devolvido',   label: 'Devolvido' },
  { value: 'pendente',    label: 'Pendente' },
  { value: 'nao_possuia', label: 'Não possuía' },
]

// Nome de departamento → id utilizável em HTML (o aria-controls do botão de
// expandir precisa casar com o id do <tbody> do grupo).
function slugifyDept(dept) {
  return dept
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// celular é guardado só com dígitos — formata (DD) 9DDDD-DDDD pra exibição;
// número fora do padrão de 11 dígitos (DDD + celular) cai pro valor cru.
function formatCelular(celular) {
  if (!celular) return null
  const digits = celular.replace(/\D/g, '')
  if (digits.length !== 11) return celular
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
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
  const [permPower,     setPermPower]     = useState('')     // nível de poder em edição ('' = nenhum)
  // Árvore de alçadas por sistema (catálogo + o que a pessoa pode em cada módulo)
  const [catalog,       setCatalog]       = useState({ modules: [], actions: [], tags: [] })
  const [permGrants,    setPermGrants]    = useState(new Set())  // "sistema|módulo|ação"
  const [permValEx,     setPermValEx]     = useState(new Map())  // "sistema|módulo|etiqueta" → allow
  const [origGrants,    setOrigGrants]    = useState(new Set())
  const [origValEx,     setOrigValEx]     = useState(new Map())
  const [openSystems,   setOpenSystems]   = useState(new Set())  // sistemas com a árvore aberta
  const [openModules,   setOpenModules]   = useState(new Set())  // "sistema|módulo" abertos
  // Substituição temporária (férias): ciência/aprovação do titular passam a outra pessoa
  const [substs,        setSubsts]        = useState([])
  const emptySub = { system_slug: '', tipo: 'ciencia', substituto_id: '', inicio: '', fim: '', motivo: '', titular_mantem: true, herda_nivel: true }
  const [newSub,        setNewSub]        = useState(emptySub)
  const [subMsg,        setSubMsg]        = useState(null)
  const [permValues,    setPermValues]    = useState('nenhum') // valores R$: 'nenhum' | 'todos'
  const [permSlugs,     setPermSlugs]     = useState([])     // slugs marcados ([] = acesso pleno)
  const [permFull,      setPermFull]      = useState(true)   // toggle "acesso total"
  const [permLoading,   setPermLoading]   = useState(false)
  const [permSaving,    setPermSaving]    = useState(false)
  const [permMsg,       setPermMsg]       = useState(null)

  // Modal inativação
  const [toggleUser,    setToggleUser]    = useState(null)
  const [inactReason,   setInactReason]   = useState('')   // 'demissao' | 'suspensao'
  const [inactReturns,  setInactReturns]  = useState({})   // { [item]: status }
  const [inactOther,    setInactOther]    = useState('')   // outro item devolvido/pendente
  const [inactNote,     setInactNote]     = useState('')
  const [lastInact,     setLastInact]     = useState(null) // mini-relatório da última inativação (reativar)

  // Modal exclusão
  const [deleteUser,    setDeleteUser]    = useState(null)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteMsg,     setDeleteMsg]     = useState(null)

  // Modal editar colaborador (nome, função, celular)
  const [editNameUser,  setEditNameUser]  = useState(null)   // usuário sendo editado
  const [editNameValue, setEditNameValue] = useState('')
  const [editFuncaoValue, setEditFuncaoValue] = useState('')
  const [editCorpValue,    setEditCorpValue]    = useState('')   // celular corporativo
  const [editPessValue,    setEditPessValue]    = useState('')   // celular pessoal
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

  // Quem está usando a tela — define o que ela pode alterar em cada pessoa
  const [myId, setMyId] = useState(null)
  const myPower = users.find(u => u.id === myId)?.power_level || null

  // ── Árvore de alçadas (catálogo por sistema) ─────────────────────────────
  const catalogSystems = new Set(catalog.modules.map(m => m.system_slug))
  function treeFor(slug) {
    const groups = []
    for (const m of catalog.modules.filter(x => x.system_slug === slug)) {
      let g = groups.find(x => x.label === m.group_label)
      if (!g) { g = { label: m.group_label, modules: [] }; groups.push(g) }
      g.modules.push({
        ...m,
        actions: catalog.actions.filter(a => a.system_slug === slug && a.module_key === m.module_key),
        tags:    catalog.tags.filter(t => t.system_slug === slug && t.module_key === m.module_key),
      })
    }
    return groups
  }
  const gkey = (sys, mod, act) => `${sys}|${mod}|${act}`
  function grantCount(slug, mod) {
    const prefix = mod ? `${slug}|${mod}|` : `${slug}|`
    let n = 0; permGrants.forEach(k => { if (k.startsWith(prefix)) n++ }); return n
  }
  function toggleGrant(sys, mod, act, choiceGroup, actionsOfModule) {
    setPermGrants(prev => {
      const next = new Set(prev)
      const k = gkey(sys, mod, act)
      if (next.has(k)) { next.delete(k); return next }
      if (choiceGroup) actionsOfModule.filter(a => a.choice_group === choiceGroup).forEach(a => next.delete(gkey(sys, mod, a.action_key)))
      next.add(k); return next
    })
  }
  function setGroupAll(sys, group, on) {
    setPermGrants(prev => {
      const next = new Set(prev)
      group.modules.forEach(m => m.actions.forEach(a => {
        const k = gkey(sys, m.module_key, a.action_key)
        if (on && !a.choice_group) next.add(k); if (!on) next.delete(k)
      }))
      return next
    })
  }
  function toggleValueEx(sys, mod, tag) {
    const k = gkey(sys, mod, tag)
    const allow = permValues !== 'todos'      // 🔒 → exceção libera · 🔓 → exceção esconde
    setPermValEx(prev => { const next = new Map(prev); if (next.has(k)) next.delete(k); else next.set(k, allow); return next })
  }
  function toggleOpen(setter, key) { setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n }) }

  // ── Substituição temporária ──────────────────────────────────────────────
  // Sistemas que têm ciência/aprovação no catálogo (hoje: VPRequisições)
  const substSystems = [...new Set(catalog.modules.filter(m => m.module_key === 'ciencia' || m.module_key === 'aprovacao').map(m => m.system_slug))]
  async function loadSubsts(titularId) {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('alcada_substitutions').select('*')
      .eq('titular_id', titularId).is('cancelado_em', null).gte('fim', today).order('inicio')
    setSubsts(data || [])
  }
  async function addSubst() {
    setSubMsg(null)
    const n = newSub
    if (!n.system_slug || !n.substituto_id || !n.inicio || !n.fim) {
      setSubMsg({ type: 'error', text: 'Preencha sistema, quem assume, início e fim.' }); return
    }
    const { error } = await supabase.from('alcada_substitutions').insert({
      titular_id: permUser.id, substituto_id: n.substituto_id, system_slug: n.system_slug, tipo: n.tipo,
      inicio: n.inicio, fim: n.fim, motivo: n.motivo.trim() || null,
      titular_mantem: n.titular_mantem, herda_nivel: n.herda_nivel, criado_por: myId,
    })
    if (error) { setSubMsg({ type: 'error', text: error.message }); return }
    logActivity({
      action: 'add_substitution', target: permUser.name || permUser.email,
      details: {
        substituto: users.find(x => x.id === n.substituto_id)?.name || '—',
        tipo: n.tipo === 'ciencia' ? 'Ciência' : 'Aprovação financeira',
        periodo: `${n.inicio} → ${n.fim}`, titular_continua: n.titular_mantem, herda_nivel: n.herda_nivel,
      },
    })
    setNewSub(emptySub); setSubMsg({ type: 'success', text: 'Substituição cadastrada.' })
    loadSubsts(permUser.id)
  }
  async function cancelSubst(sub) {
    const { error } = await supabase.from('alcada_substitutions')
      .update({ cancelado_em: new Date().toISOString(), cancelado_por: myId }).eq('id', sub.id)
    if (error) { setSubMsg({ type: 'error', text: error.message }); return }
    logActivity({ action: 'cancel_substitution', target: permUser.name || permUser.email, details: { tipo: sub.tipo, periodo: `${sub.inicio} → ${sub.fim}` } })
    loadSubsts(permUser.id)
  }

  /** Pode alterar os PODERES (cargo, liderança, valores, sistemas) de `u`? */
  function canGrantTo(u) {
    if (!u) return false
    if (myPower === 'plenos') return true
    if (myPower === 'medios') return u.id !== myId && (!u.power_level || u.power_level === 'baixos')
    return false
  }
  /** Pode alterar departamento/status de `u`? (baixos: só de quem não tem poder) */
  function canEditDeptOf(u) {
    if (!u) return false
    if (canGrantTo(u)) return true
    return myPower === 'baixos' && u.id !== myId && !u.power_level
  }
  /** Por que não pode — exibido no topo da janela. */
  function grantBlockReason(u) {
    if (canGrantTo(u)) return null
    if (u.id === myId) return 'Você não pode alterar os seus próprios poderes. Só quem tem poderes plenos pode.'
    if (myPower === 'medios') return 'Com poderes médios você só altera quem está abaixo de você (poder baixo ou nenhum).'
    return 'Com poderes baixos você não dá poderes nem libera valores.'
  }

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    supabase.auth.getUser().then(({ data }) => setMyId(data?.user?.id ?? null))
    const [{ data: u }, { data: m }, { data: allPerms }] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('modules').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('module_permissions').select('user_id, module_slug, can_access'),
    ])
    Promise.all([
      supabase.from('catalog_modules').select('*').order('sort_order'),
      supabase.from('catalog_actions').select('*').order('sort_order'),
      supabase.from('catalog_value_tags').select('*').order('sort_order'),
    ]).then(([cm, ca, ct]) => setCatalog({ modules: cm.data || [], actions: ca.data || [], tags: ct.data || [] }))
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
  async function requestToggleActive(u) {
    setInactReason(''); setInactReturns({}); setInactOther(''); setInactNote(''); setLastInact(null)
    if (!u.is_active) {
      const { data } = await supabase
        .from('profile_inactivations')
        .select('*')
        .eq('user_id', u.id)
        .is('reativado_em', null)
        .order('inativado_em', { ascending: false })
        .limit(1)
        .maybeSingle()
      setLastInact(data || null)
    }
    setToggleUser(u)
  }

  async function toggleActive(u) {
    const newStatus = !u.is_active
    const devolucoes = inactReason === 'demissao'
      ? [
          ...RETURN_ITEMS.map(item => ({ item, status: inactReturns[item] || 'pendente' })),
          ...(inactOther.trim() ? [{ item: inactOther.trim(), status: inactReturns.__outro || 'pendente' }] : []),
        ]
      : []
    setToggleUser(null)
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newStatus })
      .eq('id', u.id)

    if (error) {
      setActionMsg({ type: 'error', text: error.message || `Erro ao atualizar ${u.name}.` })
    } else {
      // Mini-relatório: abre na inativação, fecha na reativação
      if (!newStatus) {
        await supabase.from('profile_inactivations').insert({
          user_id: u.id,
          motivo: inactReason,
          observacao: inactNote.trim() || null,
          devolucoes,
          inativado_por: myId,
        })
      } else if (lastInact) {
        await supabase.from('profile_inactivations')
          .update({ reativado_em: new Date().toISOString(), reativado_por: myId })
          .eq('id', lastInact.id)
      }
      setUsers(prev => prev.map(p => p.id === u.id ? { ...p, is_active: newStatus } : p))
      const pendentes = devolucoes.filter(d => d.status === 'pendente').map(d => d.item)
      logActivity({
        action: newStatus ? 'reactivate_user' : 'deactivate_user',
        target: u.email || u.name,
        details: newStatus
          ? { nome: u.name, motivo_anterior: REASON_LABEL[lastInact?.motivo] || '—' }
          : {
              nome: u.name,
              motivo: REASON_LABEL[inactReason],
              ...(inactReason === 'demissao' ? { devolucoes_pendentes: pendentes.length ? pendentes.join(', ') : 'nenhuma' } : {}),
              ...(inactNote.trim() ? { observacao: inactNote.trim() } : {}),
            },
      })
      setActionMsg({
        type: 'success',
        text: `${u.name} foi ${newStatus ? 'reativado' : 'desativado'}.`
      })
    }
    setTimeout(() => setActionMsg(null), 3500)
  }

  function openEditProfile(u) {
    setEditNameUser(u)
    setEditNameValue(u.name || '')
    setEditFuncaoValue(u.job_title || '')
    setEditCorpValue(u.celular_corporativo || '')
    setEditPessValue(u.celular_pessoal || '')
    setEditNameMsg(null)
  }

  async function saveEditProfile() {
    const newName = editNameValue.trim()
    if (!newName) {
      setEditNameMsg({ type: 'error', text: 'O nome não pode ficar em branco.' })
      return
    }
    const newFuncao  = editFuncaoValue.trim() || null
    const newCorp    = editCorpValue.replace(/\D/g, '') || null
    const newPess    = editPessValue.replace(/\D/g, '') || null

    const oldName    = editNameUser.name
    const oldFuncao  = editNameUser.job_title || null
    const oldCorp    = editNameUser.celular_corporativo || null
    const oldPess    = editNameUser.celular_pessoal || null
    const nothingChanged = newName === oldName && newFuncao === oldFuncao && newCorp === oldCorp && newPess === oldPess
    if (nothingChanged) {
      setEditNameUser(null)
      return
    }

    setEditNameSaving(true)
    setEditNameMsg(null)

    const { error } = await supabase
      .from('profiles')
      // `celular` (número de notificação) é recalculado pelo banco:
      // corporativo se houver, senão pessoal.
      .update({ name: newName, job_title: newFuncao, celular_corporativo: newCorp, celular_pessoal: newPess })
      .eq('id', editNameUser.id)

    if (error) {
      setEditNameMsg({ type: 'error', text: 'Erro ao atualizar o colaborador.' })
      setEditNameSaving(false)
      return
    }

    setUsers(prev => prev.map(p => p.id === editNameUser.id
      ? { ...p, name: newName, job_title: newFuncao, celular_corporativo: newCorp, celular_pessoal: newPess, celular: newCorp || newPess }
      : p))
    // ActivityLog renderiza cada valor de `details` como string (`${k}: ${v}`)
    // — objetos aninhados tipo { de, para } viram "[object Object]" na tela,
    // por isso a mudança já vai achatada em "de → para".
    const changes = {}
    if (newName !== oldName) changes.nome = `${oldName || '—'} → ${newName}`
    if (newFuncao !== oldFuncao) changes.funcao = `${oldFuncao || '—'} → ${newFuncao || '—'}`
    if (newCorp !== oldCorp) changes.celular_corporativo = `${oldCorp || '—'} → ${newCorp || '—'}`
    if (newPess !== oldPess) changes.celular_pessoal = `${oldPess || '—'} → ${newPess || '—'}`
    logActivity({
      action: 'edit_profile',
      target: editNameUser.email,
      details: changes,
    })
    setEditNameMsg({ type: 'success', text: 'Colaborador atualizado com sucesso!' })
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
    setPermPower(u.power_level || '')
    setPermValues(u.values_access || 'nenhum')
    setOpenSystems(new Set()); setOpenModules(new Set())
    const [{ data: grants }, { data: valex }] = await Promise.all([
      supabase.from('user_grants').select('system_slug, module_key, action_key').eq('user_id', u.id),
      supabase.from('user_value_exceptions').select('system_slug, module_key, tag_key, allow').eq('user_id', u.id),
    ])
    const g = new Set((grants || []).map(r => `${r.system_slug}|${r.module_key}|${r.action_key}`))
    const v = new Map((valex || []).map(r => [`${r.system_slug}|${r.module_key}|${r.tag_key}`, r.allow]))
    setPermGrants(g); setOrigGrants(new Set(g))
    setPermValEx(v); setOrigValEx(new Map(v))
    setNewSub(emptySub); setSubMsg(null)
    loadSubsts(u.id)
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

    const canGrant = canGrantTo(permUser)
    const canDept  = canEditDeptOf(permUser)

    // 1. Atualiza só o que esta pessoa tem alçada para mudar (o banco confere
    //    de novo e recusa o resto). department/is_department_lead disparam o
    //    trigger auto_assign_manager_id, que recalcula o organograma.
    const changes = {}
    if (canGrant) {
      changes.level              = permLevel
      changes.is_department_lead = permIsLead
      changes.values_access      = permValues
    }
    if (canDept) changes.department = permDept || null
    if (myPower === 'plenos') changes.power_level = permPower || null

    if (Object.keys(changes).length > 0) {
      const { error: levelErr } = await supabase
        .from('profiles')
        .update(changes)
        .eq('id', permUser.id)

      if (levelErr) {
        setPermMsg({ type: 'error', text: levelErr.message || 'Erro ao salvar cargo.' })
        setPermSaving(false)
        return
      }
    }

    // 2. Sincroniza module_permissions — que guarda só BLOQUEIOS. Acesso a
    //    sistemas é poder: só regrava se tiver alçada sobre esta pessoa.
    const blockedSlugs = permFull
      ? []
      : modules.map(m => m.slug).filter(s => !permSlugs.includes(s))

    if (canGrant) {
      const { error: delErr } = await supabase
        .from('module_permissions')
        .delete()
        .eq('user_id', permUser.id)

      if (delErr) {
        setPermMsg({ type: 'error', text: delErr.message || 'Erro ao salvar permissões de módulos.' })
        setPermSaving(false)
        return
      }

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
          setPermMsg({ type: 'error', text: insertErr.message || 'Erro ao salvar permissões de módulos.' })
          setPermSaving(false)
          return
        }
      }
    }

    // 3. Árvore de alçadas: grava só o que mudou (o banco confere a alçada de novo)
    if (canGrant) {
      const split = k => { const [system_slug, module_key, key] = k.split('|'); return { system_slug, module_key, key } }
      const added   = [...permGrants].filter(k => !origGrants.has(k))
      const removed = [...origGrants].filter(k => !permGrants.has(k))
      if (removed.length) {
        const byMod = {}
        removed.forEach(k => { const r = split(k); (byMod[`${r.system_slug}|${r.module_key}`] ||= []).push(r.key) })
        for (const [sm, keys] of Object.entries(byMod)) {
          const [system_slug, module_key] = sm.split('|')
          const { error } = await supabase.from('user_grants').delete()
            .eq('user_id', permUser.id).eq('system_slug', system_slug).eq('module_key', module_key).in('action_key', keys)
          if (error) { setPermMsg({ type: 'error', text: error.message }); setPermSaving(false); return }
        }
      }
      if (added.length) {
        const rows = added.map(k => { const r = split(k); return { user_id: permUser.id, system_slug: r.system_slug, module_key: r.module_key, action_key: r.key, granted_by: myId } })
        const { error } = await supabase.from('user_grants').insert(rows)
        if (error) { setPermMsg({ type: 'error', text: error.message }); setPermSaving(false); return }
      }
      const vRemoved = [...origValEx.keys()].filter(k => !permValEx.has(k))
      for (const k of vRemoved) {
        const r = split(k)
        await supabase.from('user_value_exceptions').delete()
          .eq('user_id', permUser.id).eq('system_slug', r.system_slug).eq('module_key', r.module_key).eq('tag_key', r.key)
      }
      const vChanged = [...permValEx.entries()].filter(([k, allow]) => origValEx.get(k) !== allow)
      if (vChanged.length) {
        const rows = vChanged.map(([k, allow]) => { const r = split(k); return { user_id: permUser.id, system_slug: r.system_slug, module_key: r.module_key, tag_key: r.key, allow, granted_by: myId } })
        const { error } = await supabase.from('user_value_exceptions').upsert(rows)
        if (error) { setPermMsg({ type: 'error', text: error.message }); setPermSaving(false); return }
      }
    }

    // Atualiza lista local de usuários com nível, departamento e liderança
    setUsers(prev => prev.map(p =>
      p.id === permUser.id ? { ...p, ...changes } : p
    ))

    // Atualiza o mapa local de bloqueios para refletir na tabela imediatamente
    if (canGrant) setBlocksMap(prev => {
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
        poder: POWER_LABEL[permPower] || 'nenhum',
        alcadas: `${permGrants.size} (+${[...permGrants].filter(k => !origGrants.has(k)).length} / -${[...origGrants].filter(k => !permGrants.has(k)).length})`,
        valores: permValues === 'todos' ? 'vê todos' : 'não vê',
        acesso: !canGrant ? '(sem alteração)'
          : blockedSlugs.length === 0 ? 'pleno' : `bloqueado: ${blockedSlugs.join(', ')}`,
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
      // Exclusão virou inativação para não órfão dados de negócio já
      // gravados: transações em algum satélite, ou vínculos em Gente &
      // Gestão (avaliações, vagas, treinamentos) que impedem apagar o profile.
      const linkedRecords = data?.reason === 'linked_records'
      logActivity({
        action: 'delete_user',
        target: deleteUser.email,
        details: { resultado: linkedRecords ? 'inativado_por_vinculos' : 'inativado_por_transacoes' },
      })
      setUsers(prev => prev.map(p => p.id === deleteUser.id ? { ...p, is_active: false } : p))
      setDeleteUser(null)
      setDeleting(false)
      setActionMsg({
        type: 'success',
        text: linkedRecords
          ? `${name} possui vínculos em Gente & Gestão (avaliações, vagas, treinamentos) — foi apenas inativado, não excluído.`
          : `${name} possui transações registradas em algum sistema — foi apenas inativado, não excluído.`
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
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden md:table-cell">Função</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden md:table-cell">Celular</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4">Status</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-4 py-4 hidden lg:table-cell">Acessos</th>
                    <th className="text-right text-xs text-slate-500 uppercase tracking-wider px-6 py-4">Ações</th>
                  </tr>
                </thead>
                {filtered.length === 0 && (
                  <tbody className="divide-y divide-surface-border">
                    <tr>
                      <td colSpan={7} className="text-center text-slate-500 py-12 text-sm">
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
                        <td colSpan={7} className="p-0">
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
                                onClick={() => openEditProfile(u)}
                                className="text-white hover:text-brand transition-colors"
                                title="Editar colaborador"
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
                        {u.power_level && (
                          <span title="Nível de poder no vpsistema"
                                className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300">
                            <KeyRound className="w-3 h-3" />{POWER_LABEL[u.power_level]}
                          </span>
                        )}
                        {u.values_access === 'todos' && (
                          <span title="Vê todos os valores R$"
                                className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                            <LockOpen className="w-3 h-3" />R$
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 hidden md:table-cell">
                        {u.job_title
                          ? <span className="text-slate-300 text-xs">{u.job_title}</span>
                          : <span className="text-slate-600 text-xs italic">—</span>}
                      </td>
                      <td className="px-4 py-4 hidden md:table-cell">
                        {u.celular
                          ? <span className="text-slate-300 text-xs whitespace-nowrap">
                              {formatCelular(u.celular)}
                              <span className="ml-1 text-slate-500">({u.celular_corporativo ? 'corp.' : 'pessoal'})</span>
                            </span>
                          : <span className="text-slate-600 text-xs italic">—</span>}
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-8">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-3xl shadow-2xl max-h-full overflow-y-auto">

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

                {/* Por que não pode alterar (a regra vale no banco; aqui só explicamos) */}
                {grantBlockReason(permUser) && (
                  <div className="flex items-start gap-2 rounded-lg px-4 py-3 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{grantBlockReason(permUser)}</span>
                  </div>
                )}

                {/* 🔑 Nível de poder — topo da árvore; só quem tem Plenos altera */}
                <div>
                  <label className="flex items-center gap-2 text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    <KeyRound className="w-3.5 h-3.5 text-brand" />
                    Nível de poder no vpsistema
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {POWER_LEVELS.map(opt => {
                      const selected = permPower === opt.value
                      return (
                        <label
                          key={opt.value || 'nenhum'}
                          title={opt.hint}
                          className={`flex flex-col gap-0.5 p-3 rounded-lg border transition-colors
                            ${myPower === 'plenos' ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}
                            ${selected ? 'border-brand/60 bg-brand/10' : 'border-surface-border'}`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="perm-power"
                              checked={selected}
                              disabled={myPower !== 'plenos'}
                              onChange={() => setPermPower(opt.value)}
                              className="accent-amber-400"
                            />
                            <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-400'}`}>{opt.label}</span>
                          </span>
                          <span className="text-slate-500 text-[11px] leading-snug">{opt.hint}</span>
                        </label>
                      )
                    })}
                  </div>
                  {myPower !== 'plenos' && (
                    <p className="text-slate-500 text-xs mt-2">Só quem tem poderes plenos altera o nível de poder.</p>
                  )}
                </div>

                {/* ⭐ Valores R$ — vale no ecossistema inteiro */}
                <div>
                  <label className="flex items-center gap-2 text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    <span className="text-brand">R$</span>
                    Valores financeiros (todos os sistemas)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'nenhum', label: 'Não vê valores', hint: 'Os R$ aparecem desfocados.', Icon: Lock },
                      { value: 'todos',  label: 'Vê todos',       hint: 'Enxerga todos os valores.',  Icon: LockOpen },
                    ].map(opt => {
                      const selected = permValues === opt.value
                      const enabled  = canGrantTo(permUser)
                      return (
                        <label
                          key={opt.value}
                          className={`flex flex-col gap-0.5 p-3 rounded-lg border transition-colors
                            ${enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}
                            ${selected ? 'border-brand/60 bg-brand/10' : 'border-surface-border'}`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="perm-values"
                              checked={selected}
                              disabled={!enabled}
                              onChange={() => { if (opt.value !== permValues) setPermValEx(new Map()); setPermValues(opt.value) }}
                              className="accent-amber-400"
                            />
                            <opt.Icon className={`w-3.5 h-3.5 ${selected ? 'text-brand' : 'text-slate-500'}`} />
                            <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-400'}`}>{opt.label}</span>
                          </span>
                          <span className="text-slate-500 text-[11px] leading-snug">{opt.hint}</span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-slate-500 text-xs mt-2">
                    Exceções por valor (ex.: só "valores da P.I.") ficam dentro de cada sistema, em ▸ Alçadas.
                  </p>
                </div>

                {/* Cargo */}
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Cargo / Nível
                  </label>
                  <select
                    value={permLevel}
                    onChange={e => setPermLevel(e.target.value)}
                    disabled={!canGrantTo(permUser)}
                    className="w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-3 py-3 text-sm
                               focus:outline-none focus:border-brand transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                    disabled={!canEditDeptOf(permUser)}
                    className="w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-3 py-3 text-sm
                               focus:outline-none focus:border-brand transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                    disabled={!canGrantTo(permUser)}
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
                  <label className="flex items-center gap-2 text-slate-300 text-xs font-semibold uppercase tracking-wider mb-3">
                    <Puzzle className="w-3.5 h-3.5 text-brand" />
                    Sistemas
                  </label>
                  <p className="text-slate-500 text-xs mb-3 leading-relaxed">
                    Desmarque o que este colaborador <strong className="text-slate-400">não</strong> deve acessar.
                    Em ▸ Alçadas você define o que ele pode fazer dentro de cada sistema. Sistemas novos chegam fechados.
                  </p>

                  {/* Toggle acesso total */}
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-brand/40 bg-brand/5 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={permFull}
                      disabled={!canGrantTo(permUser)}
                      onChange={e => toggleFullAccess(e.target.checked)}
                      className="w-4 h-4 accent-amber-400 cursor-pointer"
                    />
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-brand" />
                      <span className="text-brand text-sm font-medium">Acesso total (todos os sistemas)</span>
                    </div>
                  </label>

                  {/* Sistemas — cada um com a sua árvore de alçadas (clique em ▸ Alçadas) */}
                  <div className="space-y-2">
                    {modules.map(mod => {
                      const checked  = permFull || permSlugs.includes(mod.slug)
                      const modColor = mod.color || '#F59E0B'
                      const ModIcon  = getModuleIcon(mod.icon)
                      const hasTree  = catalogSystems.has(mod.slug)
                      const isOpen   = openSystems.has(mod.slug)
                      const editable = canGrantTo(permUser)
                      return (
                        <div key={mod.slug} className="rounded-lg border transition-all"
                             style={checked ? { borderColor: `${modColor}60`, background: `${modColor}0d` } : { borderColor: 'rgba(255,255,255,0.07)' }}>
                          <div className="flex items-center gap-3 p-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!editable}
                              onChange={() => {
                                if (permFull) { setPermFull(false); setPermSlugs(modules.map(m => m.slug).filter(s => s !== mod.slug)) }
                                else toggleSlug(mod.slug)
                              }}
                              className="w-4 h-4 cursor-pointer shrink-0"
                              style={{ accentColor: modColor }}
                            />
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                                 style={{ background: checked ? `${modColor}25` : 'rgba(255,255,255,0.05)' }}>
                              <ModIcon className="w-4 h-4" strokeWidth={1.75} style={{ color: checked ? modColor : '#64748b' }} />
                            </div>
                            <span className="text-sm font-medium flex-1" style={{ color: checked ? '#e2e8f0' : '#64748b' }}>{mod.name}</span>
                            {hasTree && checked && (
                              <button type="button" onClick={() => toggleOpen(setOpenSystems, mod.slug)}
                                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-surface-border text-slate-300 hover:text-white hover:border-slate-500">
                                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                Alçadas
                                <span className="ml-1 text-slate-500">({grantCount(mod.slug)})</span>
                              </button>
                            )}
                          </div>

                          {hasTree && checked && isOpen && (
                            <div className="border-t border-surface-border px-3 pb-3 pt-2 space-y-3">
                              {treeFor(mod.slug).map(group => {
                                const total = group.modules.reduce((n, m) => n + m.actions.filter(a => !a.choice_group).length, 0)
                                const marked = group.modules.reduce((n, m) => n + grantCount(mod.slug, m.module_key), 0)
                                return (
                                  <div key={group.label}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</span>
                                      {editable && total > 0 && (
                                        <button type="button" onClick={() => setGroupAll(mod.slug, group, marked < total)}
                                                className="text-[11px] text-brand hover:underline">
                                          {marked < total ? 'Marcar grupo inteiro' : 'Desmarcar grupo'}
                                        </button>
                                      )}
                                    </div>
                                    <div className="space-y-1">
                                      {group.modules.map(m => {
                                        const mk = `${mod.slug}|${m.module_key}`
                                        const mOpen = openModules.has(mk)
                                        const n = grantCount(mod.slug, m.module_key)
                                        const choiceGroups = [...new Set(m.actions.filter(a => a.choice_group).map(a => a.choice_group))]
                                        return (
                                          <div key={m.module_key} className="rounded-md border border-surface-border">
                                            <button type="button" onClick={() => toggleOpen(setOpenModules, mk)}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-left">
                                              {mOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                                              <span className={`text-sm flex-1 ${n ? 'text-white' : 'text-slate-400'}`}>{m.label}</span>
                                              {m.tags.length > 0 && <span className="text-[10px] text-emerald-400 font-semibold">R$</span>}
                                              <span className="text-[11px] text-slate-500">{n}/{m.actions.filter(a => !a.choice_group).length + choiceGroups.length}</span>
                                            </button>
                                            {mOpen && (
                                              <div className="px-3 pb-3 space-y-2">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                                  {m.actions.filter(a => !a.choice_group).map(a => (
                                                    <label key={a.action_key} className={`flex items-start gap-2 text-xs ${editable ? 'cursor-pointer' : 'opacity-60'}`}>
                                                      <input type="checkbox" className="mt-0.5 accent-amber-400" disabled={!editable}
                                                             checked={permGrants.has(gkey(mod.slug, m.module_key, a.action_key))}
                                                             onChange={() => toggleGrant(mod.slug, m.module_key, a.action_key, null, m.actions)} />
                                                      <span className="text-slate-300">{a.label}</span>
                                                    </label>
                                                  ))}
                                                </div>
                                                {choiceGroups.map(cg => (
                                                  <div key={cg} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                                    {[{ action_key: '', label: 'Nenhum' }, ...m.actions.filter(a => a.choice_group === cg)].map(a => {
                                                      const sel = a.action_key
                                                        ? permGrants.has(gkey(mod.slug, m.module_key, a.action_key))
                                                        : !m.actions.some(x => x.choice_group === cg && permGrants.has(gkey(mod.slug, m.module_key, x.action_key)))
                                                      return (
                                                        <label key={a.action_key || 'nenhum'} className={`flex items-center gap-2 text-xs ${editable ? 'cursor-pointer' : 'opacity-60'}`}>
                                                          <input type="radio" name={`${mk}|${cg}`} className="accent-amber-400" disabled={!editable} checked={sel}
                                                                 onChange={() => {
                                                                   if (!a.action_key) setPermGrants(prev => { const nx = new Set(prev); m.actions.filter(x => x.choice_group === cg).forEach(x => nx.delete(gkey(mod.slug, m.module_key, x.action_key))); return nx })
                                                                   else toggleGrant(mod.slug, m.module_key, a.action_key, cg, m.actions)
                                                                 }} />
                                                          <span className="text-slate-300">{a.label}</span>
                                                        </label>
                                                      )
                                                    })}
                                                  </div>
                                                ))}
                                                {m.tags.length > 0 && (
                                                  <div className="pt-2 border-t border-surface-border">
                                                    <p className="text-[11px] text-emerald-400 font-semibold mb-1">
                                                      R$ {permValues === 'todos' ? 'Esconder só estes valores' : 'Liberar ver só estes valores'}
                                                    </p>
                                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                                      {m.tags.map(t => (
                                                        <label key={t.tag_key} className={`flex items-center gap-2 text-xs ${editable ? 'cursor-pointer' : 'opacity-60'}`}>
                                                          <input type="checkbox" className="accent-emerald-400" disabled={!editable}
                                                                 checked={permValEx.has(gkey(mod.slug, m.module_key, t.tag_key))}
                                                                 onChange={() => toggleValueEx(mod.slug, m.module_key, t.tag_key)} />
                                                          <span className="text-slate-300">{t.label}</span>
                                                        </label>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            )}
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
                    })}
                  </div>

                  {!permFull && permSlugs.length === 0 && (
                    <p className="text-red-400 text-xs mt-2 italic">
                      Nenhum sistema marcado — o colaborador ficará bloqueado em todos os sistemas.
                    </p>
                  )}
                </div>

                {/* 🔁 Substituição temporária (férias) — só quem tem poder */}
                {(myPower === 'plenos' || myPower === 'medios') && substSystems.length > 0 && (
                  <div>
                    <label className="flex items-center gap-2 text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                      <Repeat className="w-3.5 h-3.5 text-brand" />
                      Substituição temporária (férias)
                    </label>
                    <p className="text-slate-500 text-xs mb-3">
                      Passa a ciência ou o nível de aprovação de {permUser.name?.split(' ')[0] || 'esta pessoa'} para outra pessoa por um período — nada fica parado.
                      Aprovação financeira: só poderes plenos.
                    </p>

                    {substs.length > 0 && (
                      <div className="space-y-1.5 mb-3">
                        {substs.map(sb => (
                          <div key={sb.id} className="flex items-center justify-between gap-3 rounded-md border border-surface-border px-3 py-2 text-xs">
                            <span className="text-slate-300">
                              <strong className="text-white">{sb.tipo === 'ciencia' ? 'Ciência' : 'Aprovação financeira'}</strong>
                              {' → '}{users.find(x => x.id === sb.substituto_id)?.name || '—'}
                              <span className="text-slate-500"> · {sb.inicio.split('-').reverse().join('/')} a {sb.fim.split('-').reverse().join('/')}</span>
                              {!sb.titular_mantem && <span className="text-amber-400"> · titular fora</span>}
                              {sb.tipo === 'aprovacao' && !sb.herda_nivel && <span className="text-amber-400"> · sem herdar nível</span>}
                              {sb.motivo && <span className="text-slate-500 italic"> · {sb.motivo}</span>}
                            </span>
                            {(sb.tipo === 'ciencia' || myPower === 'plenos') && (
                              <button type="button" onClick={() => cancelSubst(sb)} className="text-red-400 hover:underline shrink-0">Cancelar</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border border-surface-border p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select value={newSub.system_slug} onChange={e => setNewSub({ ...newSub, system_slug: e.target.value })}
                                className="bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-2 text-xs">
                          <option value="">Sistema…</option>
                          {substSystems.map(sl => <option key={sl} value={sl}>{modules.find(m => m.slug === sl)?.name || sl}</option>)}
                        </select>
                        <select value={newSub.substituto_id} onChange={e => setNewSub({ ...newSub, substituto_id: e.target.value })}
                                className="bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-2 text-xs">
                          <option value="">Quem assume…</option>
                          {users.filter(x => x.is_active && x.id !== permUser.id && !x.is_placeholder).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="sub-tipo" className="accent-amber-400" checked={newSub.tipo === 'ciencia'}
                                 onChange={() => setNewSub({ ...newSub, tipo: 'ciencia' })} />
                          <span className="text-slate-300">Ciência</span>
                        </label>
                        <label className={`flex items-center gap-2 ${myPower === 'plenos' ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                               title={myPower === 'plenos' ? '' : 'Só poderes plenos'}>
                          <input type="radio" name="sub-tipo" className="accent-amber-400" disabled={myPower !== 'plenos'} checked={newSub.tipo === 'aprovacao'}
                                 onChange={() => setNewSub({ ...newSub, tipo: 'aprovacao' })} />
                          <span className="text-slate-300">Aprovação financeira (nível)</span>
                        </label>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <label className="text-[11px] text-slate-500">Início
                          <input type="date" value={newSub.inicio} onChange={e => setNewSub({ ...newSub, inicio: e.target.value })}
                                 className="mt-0.5 w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-[11px] text-slate-500">Fim
                          <input type="date" value={newSub.fim} onChange={e => setNewSub({ ...newSub, fim: e.target.value })}
                                 className="mt-0.5 w-full bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-[11px] text-slate-500 col-span-2 sm:col-span-1">Motivo
                          <input value={newSub.motivo} onChange={e => setNewSub({ ...newSub, motivo: e.target.value })} placeholder="Ex.: férias"
                                 className="mt-0.5 w-full bg-surface border border-surface-border text-white placeholder-slate-600 rounded-lg px-2 py-1.5 text-xs" />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        <label className={`flex items-center gap-2 ${myPower === 'plenos' ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                          <input type="checkbox" className="accent-amber-400" disabled={myPower !== 'plenos'} checked={newSub.titular_mantem}
                                 onChange={e => setNewSub({ ...newSub, titular_mantem: e.target.checked })} />
                          <span className="text-slate-300">Titular continua podendo agir</span>
                        </label>
                        {newSub.tipo === 'aprovacao' && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" className="accent-amber-400" checked={newSub.herda_nivel}
                                   onChange={e => setNewSub({ ...newSub, herda_nivel: e.target.checked })} />
                            <span className="text-slate-300">Quem assume herda o nível do titular</span>
                          </label>
                        )}
                      </div>
                      {subMsg && <p className={`text-xs ${subMsg.type === 'error' ? 'text-red-400' : 'text-green-400'}`}>{subMsg.text}</p>}
                      <button type="button" onClick={addSubst}
                              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-brand/40 text-brand hover:bg-brand/10">
                        + Adicionar substituição
                      </button>
                    </div>
                  </div>
                )}

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
                  disabled={permSaving || (!canEditDeptOf(permUser) && myPower !== 'plenos')}
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

      {/* ── Modal: Editar Colaborador (nome, função, celular) ── */}
      {editNameUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-8">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-sm shadow-2xl max-h-full overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold text-lg">Editar Colaborador</h2>
              <button
                type="button"
                onClick={() => { setEditNameUser(null); setEditNameMsg(null) }}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={e => { e.preventDefault(); saveEditProfile() }}
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

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Função</label>
                <input
                  type="text"
                  value={editFuncaoValue}
                  onChange={e => setEditFuncaoValue(e.target.value)}
                  placeholder="Ex: Analista de RH"
                  className="w-full mt-1 bg-surface border border-surface-border text-white placeholder-slate-600
                             rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider">Celular corporativo</label>
                  <input
                    type="tel"
                    value={editCorpValue}
                    onChange={e => setEditCorpValue(e.target.value)}
                    placeholder="Ex: 11999999999"
                    className="w-full mt-1 bg-surface border border-surface-border text-white placeholder-slate-600
                               rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider">Celular pessoal</label>
                  <input
                    type="tel"
                    value={editPessValue}
                    onChange={e => setEditPessValue(e.target.value)}
                    placeholder="Ex: 11999999999"
                    className="w-full mt-1 bg-surface border border-surface-border text-white placeholder-slate-600
                               rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <p className="sm:col-span-2 text-slate-500 text-xs -mt-1">
                  Mensagens vão para o <strong className="text-slate-400">corporativo</strong>; o pessoal só recebe se não houver corporativo.
                </p>
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

      {/* ── Modal: Inativar (motivo + devoluções) / Reativar (mini-relatório) ── */}
      {toggleUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-8">
          <div className="bg-surface-card border border-yellow-600/40 rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-full overflow-y-auto">
            {toggleUser.is_active ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center text-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-yellow-500/15 flex items-center justify-center">
                    <AlertCircle className="w-7 h-7 text-yellow-500" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">Inativar colaborador?</h2>
                    <p className="text-slate-400 text-sm mt-1">
                      <span className="text-white font-semibold">{toggleUser.name || toggleUser.email}</span> perde
                      o acesso ao portal e a <span className="text-yellow-400 font-semibold">todos os sistemas VP</span> imediatamente.
                    </p>
                  </div>
                </div>

                {/* 1ª pergunta: motivo */}
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Motivo</label>
                  <div className="grid grid-cols-1 gap-2">
                    {INACTIVATION_REASONS.map(opt => (
                      <label key={opt.value}
                             className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                               ${inactReason === opt.value ? 'border-yellow-500/60 bg-yellow-500/10' : 'border-surface-border'}`}>
                        <input type="radio" name="inact-reason" className="mt-1 accent-amber-400"
                               checked={inactReason === opt.value} onChange={() => setInactReason(opt.value)} />
                        <span>
                          <span className="block text-white text-sm font-medium">{opt.label}</span>
                          <span className="block text-slate-500 text-xs">{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Só na demissão: devolução de ativos */}
                {inactReason === 'demissao' && (
                  <div>
                    <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Devolução de ativos</label>
                    <div className="space-y-2">
                      {RETURN_ITEMS.map(item => (
                        <div key={item} className="flex items-center justify-between gap-3">
                          <span className="text-slate-300 text-sm">{item}</span>
                          <select value={inactReturns[item] || 'pendente'}
                                  onChange={e => setInactReturns(prev => ({ ...prev, [item]: e.target.value }))}
                                  className="bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-brand">
                            {RETURN_STATUS.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                          </select>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3">
                        <input value={inactOther} onChange={e => setInactOther(e.target.value)}
                               placeholder="Outro item (ex.: chave, uniforme)"
                               className="flex-1 bg-surface border border-surface-border text-white placeholder-slate-600 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-brand" />
                        <select value={inactReturns.__outro || 'pendente'} disabled={!inactOther.trim()}
                                onChange={e => setInactReturns(prev => ({ ...prev, __outro: e.target.value }))}
                                className="bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-brand disabled:opacity-50">
                          {RETURN_STATUS.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {inactReason && (
                  <div>
                    <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Observação (opcional)</label>
                    <textarea value={inactNote} onChange={e => setInactNote(e.target.value)} rows={2}
                              className="w-full bg-surface border border-surface-border text-white placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"
                              placeholder="Ex.: retorno previsto em 30 dias" />
                  </div>
                )}

                <p className="text-slate-500 text-xs text-center">
                  O cadastro não é apagado. Dá para reativar a qualquer momento por este mesmo botão.
                </p>
                <div className="flex gap-3 w-full">
                  <button onClick={() => setToggleUser(null)}
                          className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-surface-border text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
                    Cancelar
                  </button>
                  <button onClick={() => toggleActive(toggleUser)} disabled={!inactReason}
                          className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    Inativar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="text-center">
                  <h2 className="text-white font-bold text-lg">Reativar colaborador?</h2>
                  <p className="text-slate-400 text-sm mt-1">
                    <span className="text-white font-semibold">{toggleUser.name || toggleUser.email}</span> volta a ter acesso ao portal.
                  </p>
                </div>

                {/* Mini-relatório da inativação */}
                {lastInact ? (
                  <div className="rounded-lg border border-surface-border p-4 text-sm space-y-2">
                    <p className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Última inativação</p>
                    <p className="text-slate-400">
                      <span className="text-white font-medium">{REASON_LABEL[lastInact.motivo]}</span>
                      {' · '}{new Date(lastInact.inativado_em).toLocaleDateString('pt-BR')}
                      {lastInact.inativado_por && <> · por {users.find(x => x.id === lastInact.inativado_por)?.name || '—'}</>}
                    </p>
                    {(lastInact.devolucoes || []).length > 0 && (
                      <ul className="space-y-1">
                        {lastInact.devolucoes.map(d => (
                          <li key={d.item} className="flex justify-between text-xs">
                            <span className="text-slate-400">{d.item}</span>
                            <span className={d.status === 'pendente' ? 'text-red-400 font-medium' : 'text-slate-500'}>
                              {RETURN_STATUS.find(st => st.value === d.status)?.label || d.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {lastInact.observacao && <p className="text-slate-500 text-xs italic">{lastInact.observacao}</p>}
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs text-center">Sem registro de motivo (inativado antes deste recurso).</p>
                )}

                <div className="flex gap-3 w-full">
                  <button onClick={() => setToggleUser(null)}
                          className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-surface-border text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
                    Cancelar
                  </button>
                  <button onClick={() => toggleActive(toggleUser)}
                          className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors">
                    Reativar
                  </button>
                </div>
              </div>
            )}
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-8">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-full overflow-y-auto">

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
