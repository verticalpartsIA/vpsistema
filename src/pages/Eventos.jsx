import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATALOGO_INICIAL, SISTEMAS } from '../lib/eventosCatalogo'
import {
  ArrowLeft, Radio, LayoutDashboard, Activity, ListTree, Workflow, Users, Plug,
  Inbox, AlertTriangle, ShieldCheck, Loader2, RefreshCw, Info, RotateCcw,
} from 'lucide-react'

// Central de Eventos (/eventos). Lê o schema `eventos` do Supabase. Enquanto o
// banco da Central não estiver ativo, a tela mostra o catálogo levantado no
// inventário (src/lib/eventosCatalogo.js) e avisa que os demais dados ainda não existem.

const eventos = () => supabase.schema('eventos')

const TABS = [
  { id: 'painel',        label: 'Painel Geral',          icon: LayoutDashboard },
  { id: 'monitor',       label: 'Monitor de Eventos',    icon: Activity },
  { id: 'catalogo',      label: 'Catálogo de Gatilhos',  icon: ListTree },
  { id: 'regras',        label: 'Regras de Comunicação', icon: Workflow },
  { id: 'destinatarios', label: 'Destinatários',         icon: Users },
  { id: 'canais',        label: 'Canais',                icon: Plug },
  { id: 'fila',          label: 'Fila de Envios',        icon: Inbox },
  { id: 'falhas',        label: 'Falhas e Reenvios',     icon: AlertTriangle },
  { id: 'auditoria',     label: 'Auditoria',             icon: ShieldCheck },
]

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

function Chip({ cls, children }) {
  return <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{children}</span>
}

function Aviso({ children }) {
  return (
    <div className="flex items-start gap-3 bg-violet-500/10 border border-violet-500/20 text-violet-200 rounded-xl px-4 py-3 text-sm mb-5">
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function Vazio({ texto }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <Radio className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm text-center max-w-md">{texto}</p>
    </div>
  )
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

function Carregando() {
  return <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-brand animate-spin" /></div>
}

const AVISO_BANCO = (
  <Aviso>
    O banco da Central de Eventos ainda não foi ativado neste ambiente. Quando for, esta tela passa a mostrar os dados reais automaticamente.
  </Aviso>
)

/* ---------------------------------------------------------------- Painel */
function Painel({ onAbrir }) {
  const ev = useTabela('eventos', { select: 'id,status,recebido_em', ordem: 'recebido_em', limite: 1000 })
  const en = useTabela('envios', { select: 'id,status', limite: 1000 })

  const porSistema = useMemo(() => {
    const m = {}
    for (const c of CATALOGO_INICIAL) {
      m[c.sistema] ??= { total: 0, sombra: 0, legado: 0 }
      m[c.sistema].total++
      if (c.modo === 'legado') m[c.sistema].legado++
      else m[c.sistema].sombra++
    }
    return m
  }, [])

  const contar = (arr, st) => arr.filter(x => x.status === st).length
  const hoje = new Date().toDateString()
  const eventosHoje = ev.dados.filter(e => new Date(e.recebido_em).toDateString() === hoje).length
  const banco = !ev.indisponivel && !en.indisponivel

  const Kpi = ({ titulo, valor, destaque }) => (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <p className="text-slate-500 text-xs uppercase tracking-wider">{titulo}</p>
      <p className={`text-3xl font-semibold mt-2 ${destaque ?? 'text-white'}`}>{valor}</p>
    </div>
  )

  return (
    <div>
      {!banco && AVISO_BANCO}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Kpi titulo="Eventos hoje"        valor={banco ? eventosHoje : '—'} />
        <Kpi titulo="Envios na fila"      valor={banco ? contar(en.dados, 'pendente') + contar(en.dados, 'processando') : '—'} />
        <Kpi titulo="Falhas"              valor={banco ? contar(en.dados, 'falha') + contar(en.dados, 'descartado') : '—'} destaque={banco ? 'text-red-400' : undefined} />
        <Kpi titulo="Gatilhos catalogados" valor={CATALOGO_INICIAL.length} destaque="text-violet-400" />
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
      .update({ modo: modo === 'desligado' ? 'desligado' : modo, ativo: modo !== 'desligado' }).eq('id', l.id)
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

function Monitor() {
  return (
    <TabelaBanco tabela="eventos" select="id,tipo,status,recebido_em,entidade_tipo,entidade_id,origens(slug)" ordem="recebido_em"
      vazio="Nenhum evento recebido ainda. Os eventos aparecem aqui assim que um sistema começar a publicar."
      colunas={[
        { k: 'recebido_em', t: 'Recebido', r: l => fmtData(l.recebido_em) },
        { k: 'origem', t: 'Sistema', r: l => SISTEMAS[l.origens?.slug] ?? l.origens?.slug ?? '—' },
        { k: 'tipo', t: 'Evento', r: l => <code className="text-violet-300 text-xs">{l.tipo}</code> },
        { k: 'entidade', t: 'Entidade', r: l => l.entidade_tipo ? `${l.entidade_tipo} ${l.entidade_id ?? ''}` : '—' },
        { k: 'status', t: 'Status', r: l => <Chip cls="bg-slate-500/10 text-slate-300 border-slate-500/20">{l.status}</Chip> },
      ]} />
  )
}

function Regras() {
  return (
    <TabelaBanco tabela="regras" select="id,ativa,canais,prioridade,catalogo_gatilhos(tipo)"
      vazio="Nenhuma regra de comunicação criada. Cada regra define quando, por qual canal e para quem enviar."
      colunas={[
        { k: 'gatilho', t: 'Gatilho', r: l => <code className="text-violet-300 text-xs">{l.catalogo_gatilhos?.tipo ?? '—'}</code> },
        { k: 'canais', t: 'Canais', r: l => (l.canais ?? []).join(', ') },
        { k: 'prioridade', t: 'Prioridade' },
        { k: 'ativa', t: 'Estado', r: l => l.ativa ? 'Ativa' : 'Inativa' },
      ]} />
  )
}

function Destinatarios() {
  return (
    <TabelaBanco tabela="destinatarios" select="id,nome,tipo,whatsapp,email,ativo"
      vazio="Nenhum destinatário cadastrado. Pessoas internas vêm dos perfis do portal; contatos externos são cadastrados aqui."
      colunas={[
        { k: 'nome', t: 'Nome' },
        { k: 'tipo', t: 'Tipo' },
        { k: 'whatsapp', t: 'WhatsApp', r: l => mascara(l.whatsapp) },
        { k: 'ativo', t: 'Estado', r: l => l.ativo ? 'Ativo' : 'Inativo' },
      ]} />
  )
}

function Canais() {
  return (
    <TabelaBanco tabela="canais" select="slug,ativo,limite_por_minuto,intervalo_min_ms"
      vazio="Nenhum canal configurado."
      colunas={[
        { k: 'slug', t: 'Canal' },
        { k: 'ativo', t: 'Estado', r: l => l.ativo ? 'Ativo' : 'Desativado' },
        { k: 'limite_por_minuto', t: 'Limite por minuto' },
        { k: 'intervalo_min_ms', t: 'Intervalo mínimo (ms)' },
      ]} />
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

function Falhas() {
  const [versao, setVersao] = useState(0)
  async function reenviar(id) {
    const { error } = await eventos().from('envios')
      .update({ status: 'pendente', proxima_tentativa_em: new Date().toISOString() }).eq('id', id)
    if (error) window.alert('Não foi possível reenviar: ' + error.message)
    else setVersao(v => v + 1)
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
  const [aba, setAba] = useState('painel')
  const [sistemaFiltro, setSistemaFiltro] = useState('')
  const [chave, setChave] = useState(0)

  const abrir = useCallback((id, sistema = '') => { setAba(id); setSistemaFiltro(sistema) }, [])

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-surface-card border-b border-surface-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack}
              className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Radio className="w-5 h-5 text-violet-400" />
            </div>
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
        {aba === 'catalogo'      && <Catalogo sistemaInicial={sistemaFiltro} />}
        {aba === 'regras'        && <Regras />}
        {aba === 'destinatarios' && <Destinatarios />}
        {aba === 'canais'        && <Canais />}
        {aba === 'fila'          && <Fila />}
        {aba === 'falhas'        && <Falhas />}
        {aba === 'auditoria'     && <Auditoria />}
      </main>
    </div>
  )
}
