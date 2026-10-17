import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROUTES, navigate, subrota } from '../lib/router'
import { CATALOGO_INICIAL, SISTEMAS } from '../lib/eventosCatalogo'
import { Aviso, Campo, Carregando, Chip, INPUT, Modal, Vazio } from './eventosUi'
import RegrasETemplates from './EventosRegras'
import {
  ArrowLeft, LayoutDashboard, Activity, ListTree, Workflow, Users, Plug,
  Inbox, AlertTriangle, ShieldCheck, RefreshCw, RotateCcw, MessageSquare,
} from 'lucide-react'

// Central de Eventos (/eventos). Lê o schema `eventos` do Supabase. Enquanto o
// banco da Central não estiver ativo, a tela mostra o catálogo levantado no
// inventário (src/lib/eventosCatalogo.js) e avisa que os demais dados ainda não existem.

const eventos = () => supabase.schema('eventos')

// Cada aba tem o seu endereço: vpsistema.com/eventos/<slug>
const TABS = [
  { id: 'painel',        slug: 'painel-geral',          label: 'Painel Geral',          icon: LayoutDashboard },
  { id: 'monitor',       slug: 'monitor-de-eventos',    label: 'Monitor de Eventos',    icon: Activity },
  { id: 'catalogo',      slug: 'catalogo-de-gatilhos',  label: 'Catálogo de Gatilhos',  icon: ListTree },
  { id: 'regras',        slug: 'regras-de-comunicacao', label: 'Regras de Comunicação', icon: Workflow },
  { id: 'destinatarios', slug: 'destinatarios',         label: 'Destinatários',         icon: Users },
  { id: 'canais',        slug: 'canais',                label: 'Canais',                icon: Plug },
  { id: 'fila',          slug: 'fila-de-envios',        label: 'Fila de Envios',        icon: Inbox },
  { id: 'mensagens',     slug: 'mensagens-enviadas',    label: 'Mensagens Enviadas',    icon: MessageSquare },
  { id: 'falhas',        slug: 'falhas-e-reenvios',     label: 'Falhas e Reenvios',     icon: AlertTriangle },
  { id: 'auditoria',     slug: 'auditoria',             label: 'Auditoria',             icon: ShieldCheck },
]

// Aba e filtro de sistema lidos do endereço (Voltar/Avançar e link colado funcionam)
function lerEndereco() {
  const [slug, sistema] = subrota(ROUTES.eventos)
  const tab = TABS.find(t => t.slug === slug)
  return { aba: tab ? tab.id : 'painel', sistema: tab && tab.id === 'catalogo' ? (sistema || '') : '', valido: !!tab }
}

function useAbaNoEndereco() {
  const [estado, setEstado] = useState(lerEndereco)
  useEffect(() => {
    // /eventos sozinho (ou aba desconhecida) vira /eventos/painel-geral, sem criar entrada no histórico
    if (!lerEndereco().valido) navigate(`${ROUTES.eventos}/painel-geral`, { replace: true })
    const sync = () => setEstado(lerEndereco())
    window.addEventListener('popstate', sync)
    window.addEventListener('vp:navigate', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('vp:navigate', sync)
    }
  }, [])
  const abrir = useCallback((id, sistema = '') => {
    const tab = TABS.find(t => t.id === id) || TABS[0]
    navigate(`${ROUTES.eventos}/${tab.slug}${id === 'catalogo' && sistema ? '/' + encodeURIComponent(sistema) : ''}`)
  }, [])
  return [estado, abrir]
}

const MODO = {
  sombra:     { label: 'Sombra',     cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  ativo:      { label: 'Ativo',      cls: 'bg-green-500/10 text-green-400 border-green-500/20' },
  desligado:  { label: 'Desligado',  cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  legado:     { label: 'Só no legado', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
}

const STATUS_ENVIO = {
  pendente:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  processando: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  enviado:     'bg-green-500/10 text-green-400 border-green-500/20',
  falha:       'bg-red-500/10 text-red-400 border-red-500/20',
  descartado:  'bg-red-500/10 text-red-400 border-red-500/20',
  cancelado:   'bg-slate-500/10 text-slate-400 border-slate-500/20',
  simulado:    'bg-violet-500/10 text-violet-400 border-violet-500/20',
}

const fmtData = (iso) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'

// Telefone nunca aparece inteiro na tela
const mascara = (tel) => {
  const d = String(tel ?? '').replace(/\D/g, '')
  return d.length >= 6 ? `${d.slice(0, 2)}•••••${d.slice(-4)}` : '—'
}

function Tabela({ colunas, linhas, vazio }) {
  if (!linhas.length) return <Vazio texto={vazio} />
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 text-xs uppercase tracking-wider border-b border-surface-border">
            {colunas.map(c => <th key={c.k} className="px-4 py-3 font-semibold whitespace-nowrap">{c.t}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {linhas.map((l, i) => (
            <tr key={l.id ?? i} className="hover:bg-white/5 transition-colors">
              {colunas.map(c => (
                <td key={c.k} className="px-4 py-3 text-slate-300 align-top">{c.r ? c.r(l) : (l[c.k] ?? '—')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Lê uma tabela do schema `eventos`. `indisponivel` = o banco da Central ainda não responde.
function useTabela(tabela, { select = '*', ordem, filtro, limite = 100, versao } = {}) {
  const [estado, setEstado] = useState({ carregando: true, dados: [], indisponivel: false })
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      let q = eventos().from(tabela).select(select).limit(limite)
      if (ordem) q = q.order(ordem, { ascending: false })
      if (filtro) q = filtro(q)
      const { data, error } = await q
      if (!cancelado) setEstado({ carregando: false, dados: data ?? [], indisponivel: !!error })
    })()
    return () => { cancelado = true }
  }, [tabela, select, ordem, limite, versao]) // eslint-disable-line react-hooks/exhaustive-deps
  return estado
}

const AVISO_BANCO = (
  <Aviso>
    O banco da Central de Eventos ainda não foi ativado neste ambiente. Quando for, esta tela passa a mostrar os dados reais automaticamente.
  </Aviso>
)

/* ---------------------------------------------------------------- Painel */
// Contagem exata feita pelo banco (head: não traz linhas), sem depender de um recorte de 1.000.
async function contarNoBanco(tabela, filtro) {
  let q = eventos().from(tabela).select('id', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  const { count, error } = await q
  return error ? null : count
}

function Painel({ onAbrir }) {
  const [dados, setDados] = useState({ carregando: true, banco: false, eventosHoje: 0, fila: 0, falhas: 0, catalogo: CATALOGO_INICIAL })

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const inicioDoDia = new Date(); inicioDoDia.setHours(0, 0, 0, 0)
      const [eventosHoje, fila, falhas, cat] = await Promise.all([
        contarNoBanco('eventos', q => q.gte('recebido_em', inicioDoDia.toISOString())),
        contarNoBanco('envios', q => q.in('status', ['pendente', 'processando'])),
        contarNoBanco('envios', q => q.in('status', ['falha', 'descartado'])),
        eventos().from('catalogo_gatilhos').select('modo,ativo,origens(slug)').limit(1000),
      ])
      if (cancelado) return
      const banco = eventosHoje !== null && fila !== null && falhas !== null
      // Catálogo vivo quando o banco responde; senão, o levantamento do inventário.
      const vivo = !cat.error && (cat.data ?? []).length > 0
        ? cat.data.map(d => ({ sistema: d.origens?.slug, modo: d.ativo ? d.modo : 'desligado' }))
        : CATALOGO_INICIAL
      setDados({ carregando: false, banco, eventosHoje, fila, falhas, catalogo: vivo })
    })()
    return () => { cancelado = true }
  }, [])

  const porSistema = useMemo(() => {
    const m = {}
    for (const c of dados.catalogo) {
      m[c.sistema] ??= { total: 0, sombra: 0, legado: 0 }
      m[c.sistema].total++
      if (c.modo === 'legado') m[c.sistema].legado++
      else m[c.sistema].sombra++
    }
    return m
  }, [dados.catalogo])

  const { banco } = dados
  if (dados.carregando) return <Carregando />

  const Kpi = ({ titulo, valor, destaque }) => (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <p className="text-slate-500 text-xs uppercase tracking-wider">{titulo}</p>
      <p className={`text-3xl font-semibold mt-2 ${destaque ?? 'text-white'}`}>{valor}</p>
    </div>
  )

  return (
    <div>
      {!banco && AVISO_BANCO}
      {banco && <InterruptorGeral />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Kpi titulo="Eventos hoje"        valor={banco ? dados.eventosHoje : '—'} />
        <Kpi titulo="Envios na fila"      valor={banco ? dados.fila : '—'} />
        <Kpi titulo="Falhas"              valor={banco ? dados.falhas : '—'} destaque={banco ? 'text-red-400' : undefined} />
        <Kpi titulo="Gatilhos catalogados" valor={dados.catalogo.length} destaque="text-violet-400" />
      </div>

      <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Gatilhos por sistema</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(SISTEMAS).map(([slug, nome]) => {
          const r = porSistema[slug] ?? { total: 0, sombra: 0, legado: 0 }
          return (
            <button key={slug} onClick={() => onAbrir('catalogo', slug)}
              className="text-left bg-surface-card border border-surface-border hover:border-violet-500/40 rounded-2xl p-5 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-semibold">{nome}</span>
                <span className="text-slate-500 text-xs">{r.total} gatilhos</span>
              </div>
              <div className="flex gap-2 flex-wrap text-xs">
                <Chip cls={MODO.sombra.cls}>{r.sombra} com evento previsto</Chip>
                {r.legado > 0 && <Chip cls={MODO.legado.cls}>{r.legado} só no legado</Chip>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- Catálogo */
function Catalogo({ sistemaInicial }) {
  const [sistema, setSistema] = useState(sistemaInicial || '')
  const [versao, setVersao] = useState(0)
  const db = useTabela('catalogo_gatilhos', { select: 'id,tipo,descricao,ativo,modo,legado_ref,origens(slug)', versao })

  const usandoBanco = !db.indisponivel && db.dados.length > 0
  const linhas = useMemo(() => {
    const base = usandoBanco
      ? db.dados.map(d => ({ id: d.id, sistema: d.origens?.slug, tipo: d.tipo, descricao: d.descricao,
          legado: d.legado_ref, modo: d.ativo ? d.modo : 'desligado', daBase: true }))
      : CATALOGO_INICIAL
    return sistema ? base.filter(l => l.sistema === sistema) : base
  }, [usandoBanco, db.dados, sistema])

  async function mudarModo(l, modo) {
    const { error } = await eventos().from('catalogo_gatilhos')
      .update({ modo, ativo: modo !== 'desligado' }).eq('id', l.id)
    if (error) window.alert('Não foi possível alterar o gatilho: ' + error.message)
    else setVersao(v => v + 1)
  }

  const colunas = [
    { k: 'sistema', t: 'Sistema', r: l => SISTEMAS[l.sistema] ?? l.sistema },
    { k: 'tipo', t: 'Evento', r: l => <code className="text-violet-300 text-xs">{l.tipo}</code> },
    { k: 'descricao', t: 'O que acontece' },
    ...(usandoBanco ? [] : [
      { k: 'destinatario', t: 'Quem recebe hoje' },
      { k: 'canal', t: 'Canal' },
    ]),
    { k: 'legado', t: 'Mecanismo atual' },
    { k: 'modo', t: 'Modo', r: l => l.daBase
        ? (
          <select value={l.modo} onChange={e => mudarModo(l, e.target.value)}
            className="bg-surface border border-surface-border text-slate-300 rounded-lg px-2 py-1 text-xs">
            <option value="legado">Só no legado</option>
            <option value="sombra">Sombra</option>
            <option value="ativo">Ativo</option>
            <option value="desligado">Desligado</option>
          </select>
        )
        : <Chip cls={(MODO[l.modo] ?? MODO.sombra).cls}>{(MODO[l.modo] ?? MODO.sombra).label}</Chip> },
  ]

  return (
    <div>
      {db.carregando ? <Carregando /> : (
        <>
          {!usandoBanco && (
            <Aviso>
              Catálogo levantado no inventário dos sistemas (somente leitura). Ainda não há gatilhos publicados no banco da Central.
              <strong> Sombra</strong> = a Central só registra e simula; o envio continua pelo mecanismo antigo.
            </Aviso>
          )}
          <div className="mb-4">
            <select value={sistema} onChange={e => setSistema(e.target.value)}
              className="bg-surface-card border border-surface-border text-slate-300 rounded-lg px-4 py-2 text-sm">
              <option value="">Todos os sistemas</option>
              {Object.entries(SISTEMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <Tabela colunas={colunas} linhas={linhas} vazio="Nenhum gatilho para este filtro." />
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------- Tabelas simples do banco */
function TabelaBanco({ tabela, select, ordem, colunas, vazio, filtro, versao }) {
  const { carregando, dados, indisponivel } = useTabela(tabela, { select, ordem, filtro, versao })
  if (carregando) return <Carregando />
  return (
    <div>
      {indisponivel && AVISO_BANCO}
      {!indisponivel && <Tabela colunas={colunas} linhas={dados} vazio={vazio} />}
    </div>
  )
}

const chipStatus = (l) => <Chip cls={STATUS_ENVIO[l.status] ?? STATUS_ENVIO.cancelado}>{l.status}</Chip>

// O que o gi-avisos (VPS) fez com o evento, por destinatário (eventos.entregas_externas).
// Os avisos do HUB (hub.aviso_fluxo) saem por ele, não pelo worker da Central.
const SITUACAO_EXTERNA = {
  enviado:    { label: 'enviado',        cls: 'bg-green-500/10 text-green-400 border-green-500/20' },
  previsto:   { label: 'previsto',       cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  agrupado:   { label: 'agrupado',       cls: 'bg-slate-500/10 text-slate-300 border-slate-500/20' },
  encerrado:  { label: 'encerrado',      cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  na_fila:    { label: 'fora do horário', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  autor:      { label: 'é o autor',      cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  sem_numero: { label: 'sem WhatsApp',   cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  pausado:    { label: 'Pausado',        cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  sem_regra:  { label: 'sem regra',      cls: 'bg-slate-500/10 text-slate-500 border-slate-500/20' },
  erro:       { label: 'erro',           cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
}

// Destinatários informados pelo sistema de origem (nome; o e-mail fica na dica)
function ParaQuem({ l }) {
  const lista = Array.isArray(l.destinatarios) && l.destinatarios.length ? l.destinatarios : (l.dono ? [l.dono] : [])
  if (!lista.length) return <span className="text-slate-500">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {lista.map((d, i) => <span key={(d.email ?? '') + i} title={d.email ?? ''} className="whitespace-nowrap">{d.nome || d.email}</span>)}
    </div>
  )
}

// Última situação por pessoa
function NoGiAvisos({ l }) {
  const ent = Array.isArray(l.entregas_externas) ? l.entregas_externas : []
  if (!ent.length) return <span className="text-slate-500">—</span>
  const porPessoa = new Map()
  for (const e of ent) {
    const atual = porPessoa.get(e.destinatario_email)
    if (!atual || new Date(e.em) > new Date(atual.em)) porPessoa.set(e.destinatario_email, e)
  }
  return (
    <div className="flex flex-col gap-1">
      {[...porPessoa.values()].map(e => {
        const sit = SITUACAO_EXTERNA[e.situacao] ?? { label: e.situacao, cls: STATUS_ENVIO.cancelado }
        return (
          <span key={e.destinatario_email} title={`${e.detalhe ?? ''} · ${fmtData(e.em)}`} className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-slate-400 text-xs">{e.destinatario_nome || e.destinatario_email}</span>
            <Chip cls={sit.cls}>{sit.label}</Chip>
          </span>
        )
      })}
    </div>
  )
}

function Monitor() {
  return (
    <TabelaBanco tabela="eventos"
      select="id,tipo,status,recebido_em,entidade_tipo,entidade_id,origens(slug),titulo:payload->>titulo,destinatarios:payload->destinatarios,dono:payload->dono,entregas_externas(destinatario_email,destinatario_nome,situacao,detalhe,em)"
      ordem="recebido_em"
      vazio="Nenhum evento recebido ainda. Os eventos aparecem aqui assim que um sistema começar a publicar."
      colunas={[
        { k: 'recebido_em', t: 'Recebido', r: l => fmtData(l.recebido_em) },
        { k: 'origem', t: 'Sistema', r: l => SISTEMAS[l.origens?.slug] ?? l.origens?.slug ?? '—' },
        { k: 'tipo', t: 'Evento', r: l => (
          <div className="flex flex-col gap-0.5">
            <code className="text-violet-300 text-xs">{l.tipo}</code>
            {l.titulo && <span className="text-slate-400 text-xs">{l.titulo}</span>}
          </div>
        ) },
        { k: 'entidade', t: 'Entidade', r: l => l.entidade_tipo ? `${l.entidade_tipo} ${l.entidade_id ?? ''}` : '—' },
        { k: 'para', t: 'Para', r: l => <ParaQuem l={l} /> },
        { k: 'status', t: 'Central', r: l => <Chip cls="bg-slate-500/10 text-slate-300 border-slate-500/20">{l.status}</Chip> },
        { k: 'giavisos', t: 'WhatsApp (gi-avisos)', r: l => <NoGiAvisos l={l} /> },
      ]} />
  )
}

/* ------------------------------------------------- Destinatários e pausa do WhatsApp */
const SELECT_DEST = 'id,nome,tipo,whatsapp,email,ativo,aceita_whatsapp,whatsapp_pausa_assuntos,whatsapp_pausa_ate,whatsapp_pausa_motivo,whatsapp_pausa_por,whatsapp_pausa_em'

const DURACOES = [
  { id: 'religar', rotulo: 'Até eu religar' },
  { id: '1d',      rotulo: '1 dia',     ms: 24 * 3600e3 },
  { id: '3d',      rotulo: '3 dias',    ms: 3 * 24 * 3600e3 },
  { id: '1s',      rotulo: '1 semana',  ms: 7 * 24 * 3600e3 },
  { id: 'data',    rotulo: 'Até uma data e hora' },
]

// Pausa vencida (whatsapp_pausa_ate no passado) vale como ligado, igual ao gi-avisos.
function situacaoPausa(d, agora = Date.now()) {
  if (!d.whatsapp) return { id: 'sem_numero' }
  const assuntos = d.whatsapp_pausa_assuntos ?? []
  const total = d.aceita_whatsapp === false
  if (!total && !assuntos.length) return { id: 'ligado' }
  const ate = d.whatsapp_pausa_ate ? new Date(d.whatsapp_pausa_ate).getTime() : null
  if (ate !== null && ate <= agora) return { id: 'ligado', venceu: d.whatsapp_pausa_ate }
  return { id: total ? 'pausado' : 'parcial' }
}

const paraCampoData = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function ResumoPausa({ d, sit, rotulos }) {
  if (sit.venceu) return <span className="text-slate-500 text-xs">pausa venceu em {fmtData(sit.venceu)}</span>
  if (sit.id !== 'pausado' && sit.id !== 'parcial') return <span className="text-slate-500">—</span>
  const partes = [
    sit.id === 'pausado' ? 'Todos os assuntos' : (d.whatsapp_pausa_assuntos ?? []).map(s => rotulos[s] ?? s).join(', '),
    d.whatsapp_pausa_ate ? `até ${fmtData(d.whatsapp_pausa_ate)}` : 'até religar',
    d.whatsapp_pausa_por ? `por ${d.whatsapp_pausa_por}, ${fmtData(d.whatsapp_pausa_em)}` : null,
  ].filter(Boolean)
  return <span className="text-xs text-slate-300" title={d.whatsapp_pausa_motivo ? `Motivo: ${d.whatsapp_pausa_motivo}` : ''}>{partes.join(' · ')}</span>
}

function PausaModal({ d, assuntos, onFechar, onSalvar }) {
  const sit = situacaoPausa(d)
  const [modo, setModo] = useState(sit.id === 'parcial' ? 'parcial' : 'tudo')
  const [marcados, setMarcados] = useState(() => new Set(sit.id === 'parcial' ? d.whatsapp_pausa_assuntos : []))
  const [duracao, setDuracao] = useState(() => (sit.id !== 'ligado' && d.whatsapp_pausa_ate ? 'data' : 'religar'))
  const [data, setData] = useState(() => (sit.id !== 'ligado' && d.whatsapp_pausa_ate ? paraCampoData(d.whatsapp_pausa_ate) : ''))
  const [motivo, setMotivo] = useState(sit.id !== 'ligado' ? d.whatsapp_pausa_motivo ?? '' : '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const alternar = (slug) => setMarcados(m => { const n = new Set(m); n.has(slug) ? n.delete(slug) : n.add(slug); return n })

  async function salvar() {
    let ate = null
    if (duracao === 'data') {
      const t = new Date(data).getTime()
      if (!data || Number.isNaN(t) || t <= Date.now()) return setErro('Escolha uma data e hora no futuro.')
      ate = new Date(t).toISOString()
    } else if (duracao !== 'religar') {
      ate = new Date(Date.now() + DURACOES.find(x => x.id === duracao).ms).toISOString()
    }
    if (modo === 'parcial' && !marcados.size) return setErro('Marque pelo menos um assunto para pausar.')
    setSalvando(true)
    const falha = await onSalvar({
      aceita_whatsapp: modo !== 'tudo',
      whatsapp_pausa_assuntos: modo === 'parcial' ? [...marcados] : null,
      whatsapp_pausa_ate: ate,
      whatsapp_pausa_motivo: motivo.trim() || null,
    })
    if (falha) { setErro(falha); setSalvando(false) }
  }

  return (
    <Modal titulo={`Pausar WhatsApp — ${d.nome}`} onFechar={onFechar}
      rodape={<>
        <button onClick={onFechar} className="text-sm text-slate-400 hover:text-white px-3 py-2">Cancelar</button>
        <button onClick={salvar} disabled={salvando}
          className="text-sm bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg px-4 py-2 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Pausar'}
        </button>
      </>}>
      <Aviso>Durante a pausa as mensagens <strong>não são guardadas</strong> para depois; aparecem no Monitor como "Pausado".</Aviso>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="radio" name="modo" checked={modo === 'tudo'} onChange={() => setModo('tudo')} /> Pausar tudo
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="radio" name="modo" checked={modo === 'parcial'} onChange={() => setModo('parcial')} /> Pausar só alguns assuntos
        </label>
      </div>

      {modo === 'parcial' && (
        <div className="space-y-2 border border-surface-border rounded-xl p-3">
          {assuntos.map(a => (
            <label key={a.slug} className={`flex items-start gap-2 text-sm ${a.pausavel ? 'text-slate-200' : 'text-slate-500'}`}>
              <input type="checkbox" className="mt-1" disabled={!a.pausavel}
                checked={a.pausavel && marcados.has(a.slug)} onChange={() => alternar(a.slug)} />
              <span>
                {a.rotulo}
                <span className="block text-xs text-slate-500">{a.pausavel ? a.exemplos : 'Pedido de assinatura sempre chega.'}</span>
              </span>
            </label>
          ))}
          {!assuntos.length && <p className="text-xs text-slate-500">Não foi possível carregar os assuntos.</p>}
        </div>
      )}

      <Campo rotulo="Até quando">
        <select value={duracao} onChange={e => setDuracao(e.target.value)} className={INPUT}>
          {DURACOES.map(x => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
        </select>
      </Campo>
      {duracao === 'data' && (
        <Campo rotulo="Data e hora para voltar">
          <input type="datetime-local" value={data} onChange={e => setData(e.target.value)} className={INPUT} />
        </Campo>
      )}
      <Campo rotulo="Motivo (opcional)">
        <input value={motivo} onChange={e => setMotivo(e.target.value)} className={INPUT} placeholder="Ex.: férias, excesso de avisos" />
      </Campo>
      {erro && <p className="text-sm text-red-400">{erro}</p>}
    </Modal>
  )
}

function Destinatarios() {
  const db = useTabela('destinatarios', { select: SELECT_DEST, limite: 500 })
  const ass = useTabela('assuntos_whatsapp', { select: 'slug,rotulo,exemplos,ordem,pausavel', limite: 50 })
  const [linhas, setLinhas] = useState([])
  const [busca, setBusca] = useState('')
  const [soPausados, setSoPausados] = useState(false)
  const [editando, setEditando] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const [aviso, setAviso] = useState(null)

  useEffect(() => { setLinhas([...db.dados].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))) }, [db.dados])
  const assuntos = useMemo(() => [...ass.dados].sort((a, b) => a.ordem - b.ordem), [ass.dados])
  const rotulos = useMemo(() => Object.fromEntries(assuntos.map(a => [a.slug, a.rotulo])), [assuntos])

  // Devolve texto de erro (ou null). A linha é atualizada na tela sem recarregar.
  async function gravar(d, patch) {
    const { data, error } = await eventos().from('destinatarios').update(patch).eq('id', d.id).select(SELECT_DEST)
    if (error) return 'Não foi possível salvar: ' + error.message
    if (!data?.length) return 'Não foi possível salvar: sem permissão ou o destinatário não existe mais.'
    setLinhas(ls => ls.map(l => (l.id === d.id ? data[0] : l)))
    return null
  }

  async function religar(d) {
    setOcupado(d.id)
    const falha = await gravar(d, { aceita_whatsapp: true, whatsapp_pausa_assuntos: null, whatsapp_pausa_ate: null, whatsapp_pausa_motivo: null })
    setOcupado(null)
    setAviso(falha ? { erro: true, texto: falha } : { texto: `WhatsApp de ${d.nome} religado.` })
  }

  async function pausar(patch) {
    const d = editando
    const falha = await gravar(d, patch)
    if (!falha) { setEditando(null); setAviso({ texto: `WhatsApp de ${d.nome} pausado.` }) }
    return falha
  }

  if (db.carregando) return <Carregando />
  if (db.indisponivel) return AVISO_BANCO

  const agora = Date.now()
  const visiveis = linhas.filter(l => {
    if (busca && !String(l.nome).toLowerCase().includes(busca.trim().toLowerCase())) return false
    if (soPausados) { const s = situacaoPausa(l, agora).id; return s === 'pausado' || s === 'parcial' }
    return true
  })

  const colunas = [
    { k: 'nome', t: 'Nome' },
    { k: 'tipo', t: 'Tipo' },
    { k: 'whatsapp', t: 'Número', r: l => mascara(l.whatsapp) },
    { k: 'ativo', t: 'Estado', r: l => l.ativo ? 'Ativo' : 'Inativo' },
    { k: 'wpp', t: 'WhatsApp', r: l => {
      const s = situacaoPausa(l, agora)
      if (s.id === 'sem_numero') return <Chip cls="bg-slate-500/10 text-slate-400 border-slate-500/20">Sem número</Chip>
      const rot = { ligado: 'Ligado', pausado: 'Pausado', parcial: 'Parcial' }[s.id]
      const cor = { ligado: 'text-green-400', pausado: 'text-amber-400', parcial: 'text-amber-400' }[s.id]
      return (
        <span className="flex items-center gap-3">
          <Interruptor ligado={s.id !== 'pausado'} parcial={s.id === 'parcial'} ocupado={ocupado === l.id}
            rotulo={`WhatsApp de ${l.nome}`} onClick={() => (s.id === 'ligado' ? setEditando(l) : religar(l))} />
          <span className={cor}>{rot}</span>
        </span>
      )
    } },
    { k: 'pausa', t: 'Pausa', r: l => {
      const s = situacaoPausa(l, agora)
      const pausa = s.id === 'pausado' || s.id === 'parcial'
      return (
        <div className="flex flex-col gap-1">
          <ResumoPausa d={l} sit={s} rotulos={rotulos} />
          {pausa && <button onClick={() => setEditando(l)} className="text-xs text-violet-300 hover:text-violet-200 text-left">Editar pausa</button>}
        </div>
      )
    } },
  ]

  return (
    <div>
      {aviso && (
        <div className={`mb-4 text-sm rounded-xl px-4 py-3 border ${aviso.erro ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-green-500/10 border-green-500/20 text-green-300'}`}>
          {aviso.texto}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome"
          className="bg-surface-card border border-surface-border text-slate-300 rounded-lg px-4 py-2 text-sm w-64" />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={soPausados} onChange={e => setSoPausados(e.target.checked)} /> Só pausados
        </label>
        <span className="text-slate-500 text-xs">{visiveis.length} de {linhas.length}</span>
      </div>
      <Tabela colunas={colunas} linhas={visiveis}
        vazio={linhas.length
          ? 'Nenhuma pessoa para este filtro.'
          : 'Nenhum destinatário cadastrado. Pessoas internas vêm dos perfis do portal; contatos externos são cadastrados aqui.'} />
      {editando && <PausaModal d={editando} assuntos={assuntos} onFechar={() => setEditando(null)} onSalvar={pausar} />}
    </div>
  )
}

// Liga/desliga canais (só administradores gravam; a auditoria é feita pelo banco). Desativado o canal,
// nada sai por ele: o que estiver na fila não é entregue e novos envios são descartados com o motivo
// "canal_desativado" (dá para reenviar em Falhas e Reenvios depois de religar).
async function definirCanais(slugs, ativo) {
  const { error } = await eventos().from('canais').update({ ativo }).in('slug', slugs)
  if (error) window.alert('Não foi possível alterar o canal: ' + error.message)
  return !error
}

function Interruptor({ ligado, ocupado, onClick, rotulo, parcial }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={ocupado} onClick={onClick}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${parcial ? 'bg-amber-500' : ligado ? 'bg-green-500' : 'bg-slate-600'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${ligado ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Canais() {
  const [versao, setVersao] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  async function alternar(l) {
    setOcupado(true)
    await definirCanais([l.slug], !l.ativo)
    setOcupado(false)
    setVersao(v => v + 1)
  }
  return (
    <TabelaBanco tabela="canais" select="slug,ativo,limite_por_minuto,intervalo_min_ms" versao={versao}
      vazio="Nenhum canal configurado."
      colunas={[
        { k: 'slug', t: 'Canal' },
        { k: 'ativo', t: 'Estado', r: l => (
          <span className="flex items-center gap-3">
            <Interruptor ligado={l.ativo} ocupado={ocupado} rotulo={`Envios pelo canal ${l.slug}`} onClick={() => alternar(l)} />
            <span className={l.ativo ? 'text-green-400' : 'text-slate-400'}>{l.ativo ? 'Ativo' : 'Desativado'}</span>
          </span>
        ) },
        { k: 'limite_por_minuto', t: 'Limite por minuto' },
        { k: 'intervalo_min_ms', t: 'Intervalo mínimo (ms)' },
      ]} />
  )
}

// Botão geral do Painel: liga ou pausa todos os canais de uma vez.
function InterruptorGeral() {
  const [canais, setCanais] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const carregar = useCallback(async () => {
    const { data, error } = await eventos().from('canais').select('slug,ativo')
    setCanais(error ? [] : data ?? [])
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (!canais || !canais.length) return null
  const ativos = canais.filter(c => c.ativo).length
  const todos = ativos === canais.length
  const nenhum = ativos === 0

  async function alternar() {
    const ligar = !todos
    const msg = ligar
      ? 'Ligar os envios por todos os canais?'
      : 'Pausar os envios por todos os canais? Nada será enviado até religar, e novos envios serão descartados (dá para reenviar depois em Falhas e Reenvios).'
    if (!window.confirm(msg)) return
    setOcupado(true)
    await definirCanais(canais.map(c => c.slug), ligar)
    await carregar()
    setOcupado(false)
  }

  const estado = todos ? { t: 'Ligados', cls: 'text-green-400' }
    : nenhum ? { t: 'Pausados', cls: 'text-red-400' }
    : { t: `Parcial (${ativos} de ${canais.length} canais ligados)`, cls: 'text-amber-400' }

  return (
    <div className="flex items-center justify-between gap-4 bg-surface-card border border-surface-border rounded-2xl p-5 mb-6">
      <div>
        <p className="text-slate-500 text-xs uppercase tracking-wider">Envio de mensagens</p>
        <p className={`text-xl font-semibold mt-1 ${estado.cls}`}>{estado.t}</p>
        <p className="text-slate-500 text-xs mt-1">Liga ou pausa todos os canais de uma vez. Os eventos continuam sendo registrados.</p>
      </div>
      <Interruptor ligado={todos} ocupado={ocupado} rotulo="Envios de mensagens" onClick={alternar} />
    </div>
  )
}

const colunasEnvio = [
  { k: 'agendado_para', t: 'Agendado', r: l => fmtData(l.agendado_para) },
  { k: 'canal', t: 'Canal' },
  { k: 'destino', t: 'Destinatário', r: l => l.destinatarios?.nome ?? '—' },
  { k: 'status', t: 'Status', r: chipStatus },
  { k: 'tentativas', t: 'Tentativas' },
]

function Fila() {
  return (
    <TabelaBanco tabela="envios" select="id,canal,status,tentativas,agendado_para,destinatarios(nome)" ordem="agendado_para"
      filtro={q => q.in('status', ['pendente', 'processando', 'simulado'])}
      vazio="Nenhuma mensagem aguardando processamento." colunas={colunasEnvio} />
  )
}

// Quem recebeu, o texto da mensagem e de qual sistema ela partiu. "Enviadas" = entregues de verdade;
// "Simuladas" = o que a Central teria enviado em modo sombra (nada saiu).
function Mensagens() {
  const [quais, setQuais] = useState('enviado')
  return (
    <div>
      <div className="mb-4">
        <select value={quais} onChange={e => setQuais(e.target.value)}
          className="bg-surface-card border border-surface-border text-slate-300 rounded-lg px-4 py-2 text-sm">
          <option value="enviado">Enviadas</option>
          <option value="simulado">Simuladas (modo sombra, nada foi enviado)</option>
        </select>
      </div>
      <TabelaBanco tabela="envios" select="id,mensagem_renderizada,destinatarios(nome),eventos(origens(slug))" ordem="agendado_para"
        filtro={q => q.eq('status', quais)} versao={quais}
        vazio={quais === 'enviado'
          ? 'Nenhuma mensagem enviada pela Central ainda. Enquanto os gatilhos estão em sombra, veja as simuladas.'
          : 'Nenhuma mensagem simulada ainda.'}
        colunas={[
          { k: 'nome', t: 'Nome', r: l => l.destinatarios?.nome ?? '—' },
          { k: 'mensagem', t: 'Mensagem', r: l => <span className="whitespace-pre-wrap break-words">{l.mensagem_renderizada ?? '—'}</span> },
          { k: 'site', t: 'Site', r: l => SISTEMAS[l.eventos?.origens?.slug] ?? l.eventos?.origens?.slug ?? '—' },
        ]} />
    </div>
  )
}

function Falhas() {
  const [versao, setVersao] = useState(0)
  // Passa pela função do banco (eventos.reenviar_envio): confere que é administrador, zera as
  // tentativas e grava quem reenviou na auditoria. Não atualiza a tabela diretamente.
  async function reenviar(id) {
    const { data, error } = await eventos().rpc('reenviar_envio', { p_envio: id })
    if (error) window.alert('Não foi possível reenviar: ' + error.message)
    else if (data === false) window.alert('Este envio não está mais em falha ou descartado.')
    setVersao(v => v + 1)
  }
  return (
    <TabelaBanco tabela="envios" select="id,canal,status,tentativas,agendado_para,motivo_descarte,destinatarios(nome)" ordem="agendado_para"
      filtro={q => q.in('status', ['falha', 'descartado'])}
      versao={versao}
      vazio="Nenhuma falha registrada."
      colunas={[
        ...colunasEnvio,
        { k: 'motivo_descarte', t: 'Motivo' },
        { k: 'acao', t: '', r: l => (
          <button onClick={() => reenviar(l.id)}
            className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white border border-surface-border hover:border-brand/40 rounded-lg px-2.5 py-1">
            <RotateCcw className="w-3 h-3" /> Reenviar
          </button>
        ) },
      ]} />
  )
}

function Auditoria() {
  return (
    <TabelaBanco tabela="auditoria" select="id,quando,ator,acao,objeto" ordem="quando"
      vazio="Nenhuma alteração registrada ainda."
      colunas={[
        { k: 'quando', t: 'Quando', r: l => fmtData(l.quando) },
        { k: 'ator', t: 'Quem' },
        { k: 'acao', t: 'Ação' },
        { k: 'objeto', t: 'Objeto' },
      ]} />
  )
}

/* ------------------------------------------------------------------ Página */
export default function Eventos({ onBack }) {
  const [{ aba, sistema: sistemaFiltro }, abrir] = useAbaNoEndereco()
  const [chave, setChave] = useState(0)

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-surface-card border-b border-surface-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack}
              className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <img src="/vp-mark.png" alt="VP" className="w-9 h-9 object-contain" />
            <div>
              <h1 className="text-white font-semibold">Central de Eventos</h1>
              <p className="text-slate-500 text-xs">Gatilhos, comunicações e envios dos sistemas</p>
            </div>
          </div>
          <button onClick={() => setChave(k => k + 1)}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/5" title="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      <nav className="border-b border-surface-border px-6 overflow-x-auto">
        <div className="max-w-6xl mx-auto flex gap-1">
          {TABS.map(t => {
            const Icon = t.icon
            const ativa = aba === t.id
            return (
              <button key={t.id} onClick={() => abrir(t.id)}
                className={`flex items-center gap-2 px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                  ativa ? 'border-violet-400 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            )
          })}
        </div>
      </nav>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8" key={chave}>
        {aba === 'painel'        && <Painel onAbrir={abrir} />}
        {aba === 'monitor'       && <Monitor />}
        {aba === 'catalogo'      && <Catalogo key={sistemaFiltro} sistemaInicial={sistemaFiltro} />}
        {aba === 'regras'        && <RegrasETemplates />}
        {aba === 'destinatarios' && <Destinatarios />}
        {aba === 'canais'        && <Canais />}
        {aba === 'fila'          && <Fila />}
        {aba === 'mensagens'     && <Mensagens />}
        {aba === 'falhas'        && <Falhas />}
        {aba === 'auditoria'     && <Auditoria />}
      </main>
    </div>
  )
}
