import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SISTEMAS } from '../lib/eventosCatalogo'
import {
  CANAIS_COM_ENVIO, DIAS, JANELA_PADRAO, OPERADORES, VARIAVEIS_DO_ROTEADOR, lerCondicao, lerDestino, lerJanela,
  montarCondicao, montarDestino, montarJanela, renderizarModelo, resumoJanela, validarRegra, validarTemplate,
  variaveisDesconhecidas, LIMITE_MENSAGEM,
} from '../lib/eventosRegras'
import { Aviso, Campo, Carregando, Chip, INPUT, Modal, Vazio } from './eventosUi'
import { Plus, Pencil, Trash2, Power } from 'lucide-react'

// Regras de comunicação e templates de mensagem (aba "Regras de Comunicação" da Central de Eventos).
// Só administradores chegam aqui e só eles escrevem no schema `eventos` (RLS eventos.is_admin()).
// Cada gravação é registrada na auditoria pelo próprio banco (trigger eventos.auditar).

const eventos = () => supabase.schema('eventos')

const BOTAO = 'inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg px-3 py-2'
const BOTAO_PRIMARIO = `${BOTAO} bg-brand hover:bg-brand-dark text-surface disabled:opacity-50`
const BOTAO_SECUNDARIO = `${BOTAO} text-slate-300 border border-surface-border hover:border-brand/40`
const BOTAO_PEQUENO = 'inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white border border-surface-border hover:border-brand/40 rounded-lg px-2.5 py-1'

const MODO_TEXTO = { sombra: 'Sombra', ativo: 'Ativo', desligado: 'Desligado', legado: 'Só no legado' }
const MODO_COR = {
  sombra: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ativo: 'bg-green-500/10 text-green-400 border-green-500/20',
  desligado: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  legado: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
}

const resumo = (texto, n = 70) => {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/* ------------------------------------------------------------------ Dados */
function useDadosDaCentral(versao) {
  const [estado, setEstado] = useState({ carregando: true, erro: null, d: null })
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const [g, t, r, d, gr, c] = await Promise.all([
        eventos().from('catalogo_gatilhos').select('id,tipo,modo,ativo,origens(slug)').order('tipo').limit(500),
        eventos().from('templates').select('*').order('canal').limit(500),
        eventos().from('regras').select('*').limit(500),
        eventos().from('destinatarios').select('id,nome,tipo,ativo').eq('ativo', true).order('nome').limit(1000),
        eventos().from('grupos').select('id,slug,nome').order('nome').limit(200),
        eventos().from('canais').select('slug,ativo').limit(20),
      ])
      if (cancelado) return
      const erro = [g, t, r, d, gr, c].find((x) => x.error)?.error
      setEstado({
        carregando: false, erro: erro ? erro.message : null,
        d: { gatilhos: g.data ?? [], templates: t.data ?? [], regras: r.data ?? [], destinatarios: d.data ?? [],
             grupos: gr.data ?? [], canais: c.data ?? [] },
      })
    })()
    return () => { cancelado = true }
  }, [versao])
  return estado
}

// Payload do último evento real do tipo, para o exemplo de pré-visualização (editável).
function useAmostra(tipo) {
  const [a, setA] = useState({ tipo: '', texto: '{}', editado: false })
  useEffect(() => {
    if (!tipo) return undefined
    let cancelado = false
    ;(async () => {
      const { data } = await eventos().from('eventos').select('payload').eq('tipo', tipo)
        .order('recebido_em', { ascending: false }).limit(1)
      if (cancelado) return
      const texto = JSON.stringify(data?.[0]?.payload ?? {}, null, 2)
      setA((prev) => (prev.tipo === tipo && prev.editado ? prev : { tipo, texto, editado: false }))
    })()
    return () => { cancelado = true }
  }, [tipo])
  const texto = a.tipo === tipo ? a.texto : '{}'
  const setTexto = (t) => setA({ tipo, texto: t, editado: true })
  const payload = useMemo(() => { try { const j = JSON.parse(texto); return j && typeof j === 'object' ? j : null } catch { return null } }, [texto])
  return { texto, setTexto, payload }
}

function BlocoAmostra({ amostra }) {
  return (
    <Campo rotulo="Exemplo de dados do evento (JSON)"
      dica={amostra.payload ? 'Vem do último evento real deste tipo; pode editar para testar.' : 'JSON inválido: a pré-visualização usa dados vazios.'}>
      <textarea rows={5} value={amostra.texto} onChange={(e) => amostra.setTexto(e.target.value)}
        className={`${INPUT} font-mono text-xs`} spellCheck={false} />
    </Campo>
  )
}

function Previa({ corpo, payload }) {
  const dados = { ...(payload ?? {}), destinatario_nome: 'Maria', evento_tipo: 'exemplo', entidade_id: '0000' }
  const texto = renderizarModelo(corpo, dados)
  return (
    <div>
      <span className="block text-xs font-semibold text-slate-400 mb-1">Como a mensagem fica</span>
      <div className="bg-green-900/20 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-slate-100 whitespace-pre-wrap break-words">
        {texto || <span className="text-slate-500">(vazia)</span>}
      </div>
      <p className="text-xs text-slate-500 mt-1">{texto.length} de {LIMITE_MENSAGEM} caracteres</p>
    </div>
  )
}

const ErrosDoFormulario = ({ erros }) => erros.length > 0 && (
  <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl px-4 py-3 text-sm">
    <ul className="list-disc pl-4 space-y-0.5">{erros.map((e) => <li key={e}>{e}</li>)}</ul>
  </div>
)

/* ------------------------------------------------------------------ Templates */
function EditorTemplate({ modelo, dados, onFechar, onSalvo }) {
  const novo = !modelo?.id
  const [f, setF] = useState({ canal: modelo?.canal ?? 'whatsapp', assunto: modelo?.assunto ?? '', corpo: modelo?.corpo ?? '' })
  const usadoPor = dados.regras.filter((r) => r.template_id === modelo?.id)
  const gatilhoDeExemplo = usadoPor.length
    ? dados.gatilhos.find((g) => g.id === usadoPor[0].gatilho_id)?.tipo ?? ''
    : ''
  const [tipoExemplo, setTipoExemplo] = useState(gatilhoDeExemplo)
  const amostra = useAmostra(tipoExemplo)
  const [salvando, setSalvando] = useState(false)
  const [erroBanco, setErroBanco] = useState('')

  const erros = validarTemplate(f)
  const desconhecidas = variaveisDesconhecidas(f.corpo, amostra.payload ?? {})
  const emUsoAtivo = usadoPor.some((r) => r.ativa && dados.gatilhos.find((g) => g.id === r.gatilho_id)?.modo === 'ativo')

  async function salvar() {
    setSalvando(true); setErroBanco('')
    const linha = { canal: f.canal, assunto: f.assunto.trim() || null, corpo: f.corpo }
    const q = novo
      ? eventos().from('templates').insert(linha)
      : eventos().from('templates').update({ ...linha, versao: (modelo.versao ?? 1) + 1 }).eq('id', modelo.id)
    const { error } = await q
    setSalvando(false)
    if (error) setErroBanco('Não foi possível salvar: ' + error.message)
    else onSalvo()
  }

  async function excluir() {
    if (!window.confirm('Excluir este template? Só é possível se nenhuma regra o usa.')) return
    const { error } = await eventos().from('templates').delete().eq('id', modelo.id)
    if (error) setErroBanco('Não foi possível excluir (provavelmente alguma regra ainda usa): ' + error.message)
    else onSalvo()
  }

  function inserir(v) { setF((x) => ({ ...x, corpo: `${x.corpo}{{${v}}}` })) }
  const sugestoes = [...new Set([...Object.keys(amostra.payload ?? {}).filter((k) => typeof amostra.payload[k] !== 'object'),
    ...VARIAVEIS_DO_ROTEADOR])]

  return (
    <Modal titulo={novo ? 'Novo template' : 'Editar template'} onFechar={onFechar}
      rodape={(
        <>
          {!novo && <button onClick={excluir} disabled={usadoPor.length > 0}
            title={usadoPor.length ? 'Em uso por regras' : ''} className={`${BOTAO_SECUNDARIO} mr-auto disabled:opacity-40`}>
            <Trash2 className="w-4 h-4" /> Excluir
          </button>}
          <button onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || erros.length > 0} className={BOTAO_PRIMARIO}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      )}>
      {emUsoAtivo && <Aviso>Este template é usado por uma regra de gatilho <strong>ativo</strong>: ao salvar, a nova mensagem vale já nos próximos envios reais.</Aviso>}
      {usadoPor.length > 0 && !emUsoAtivo && <p className="text-xs text-slate-500">Usado por {usadoPor.length} regra(s).</p>}
      <Campo rotulo="Canal">
        <select value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} className={INPUT}>
          {dados.canais.map((c) => <option key={c.slug} value={c.slug}>{c.slug}{CANAIS_COM_ENVIO.includes(c.slug) ? '' : ' (ainda sem envio)'}</option>)}
        </select>
      </Campo>
      {f.canal === 'email' && (
        <Campo rotulo="Assunto (e-mail)">
          <input value={f.assunto} onChange={(e) => setF({ ...f, assunto: e.target.value })} className={INPUT} />
        </Campo>
      )}
      <Campo rotulo="Mensagem" dica="Use {{campo}} para trazer dados do evento, por exemplo {{ticket}}. Para negrito no WhatsApp: *texto*.">
        <textarea rows={7} value={f.corpo} onChange={(e) => setF({ ...f, corpo: e.target.value })} className={INPUT} />
      </Campo>
      <div className="flex flex-wrap gap-1.5">
        {sugestoes.map((v) => (
          <button key={v} type="button" onClick={() => inserir(v)}
            className="text-xs font-mono text-violet-300 border border-violet-500/20 hover:bg-violet-500/10 rounded px-1.5 py-0.5">{`{{${v}}}`}</button>
        ))}
      </div>
      <Campo rotulo="Pré-visualizar com os dados de qual gatilho?">
        <select value={tipoExemplo} onChange={(e) => setTipoExemplo(e.target.value)} className={INPUT}>
          <option value="">(dados vazios)</option>
          {dados.gatilhos.map((g) => <option key={g.id} value={g.tipo}>{g.tipo}</option>)}
        </select>
      </Campo>
      <BlocoAmostra amostra={amostra} />
      {desconhecidas.length > 0 && (
        <p className="text-xs text-amber-400">Atenção: {desconhecidas.map((v) => `{{${v}}}`).join(', ')} não existe nos dados de exemplo e sairá vazio. Confira a grafia.</p>
      )}
      <Previa corpo={f.corpo} payload={amostra.payload} />
      <ErrosDoFormulario erros={[...(f.corpo ? erros : []), ...(erroBanco ? [erroBanco] : [])]} />
    </Modal>
  )
}

function Templates({ dados, recarregar }) {
  const [editando, setEditando] = useState(null)
  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditando({})} className={BOTAO_PRIMARIO}><Plus className="w-4 h-4" /> Novo template</button>
      </div>
      {dados.templates.length === 0
        ? <Vazio texto="Nenhum template criado. O template é o texto da mensagem; as regras apontam para ele." />
        : (
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wider border-b border-surface-border">
                  <th className="px-4 py-3">Canal</th><th className="px-4 py-3">Mensagem</th>
                  <th className="px-4 py-3">Em uso</th><th className="px-4 py-3">Versão</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {dados.templates.map((t) => (
                  <tr key={t.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-slate-300 align-top">{t.canal}</td>
                    <td className="px-4 py-3 text-slate-300 align-top">{resumo(t.corpo, 90)}</td>
                    <td className="px-4 py-3 text-slate-300 align-top">{dados.regras.filter((r) => r.template_id === t.id).length} regra(s)</td>
                    <td className="px-4 py-3 text-slate-300 align-top">{t.versao}</td>
                    <td className="px-4 py-3 align-top text-right">
                      <button onClick={() => setEditando(t)} className={BOTAO_PEQUENO}><Pencil className="w-3 h-3" /> Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {editando && (
        <EditorTemplate modelo={editando} dados={dados} onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); recarregar() }} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Regras */
function formularioDa(regra) {
  if (!regra?.id) {
    return { gatilho_id: '', canais: ['whatsapp'], template_id: '', ativa: true, prioridade: 5, atraso_segundos: 0,
      destino: lerDestino(null), janela: { ...JANELA_PADRAO }, condicao: [], condicaoNaoEditavel: false }
  }
  const cond = lerCondicao(regra.condicao)
  return {
    gatilho_id: regra.gatilho_id, canais: regra.canais ?? [], template_id: regra.template_id ?? '', ativa: regra.ativa,
    prioridade: regra.prioridade, atraso_segundos: regra.atraso_segundos, destino: lerDestino(regra.destino),
    janela: lerJanela(regra.janela_envio), condicao: cond ?? [], condicaoNaoEditavel: cond === null,
  }
}

function EditorRegra({ regra, dados, onFechar, onSalvo }) {
  const novo = !regra?.id
  const [f, setF] = useState(() => formularioDa(regra))
  const [busca, setBusca] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroBanco, setErroBanco] = useState('')

  const gatilho = dados.gatilhos.find((g) => g.id === f.gatilho_id)
  const template = dados.templates.find((t) => t.id === f.template_id)
  const amostra = useAmostra(gatilho?.tipo ?? '')
  const erros = validarRegra(f, template)
  const pessoas = dados.destinatarios.filter((d) => !busca || d.nome.toLowerCase().includes(busca.toLowerCase()))

  const set = (parte) => setF((x) => ({ ...x, ...parte }))
  const alternar = (lista, v) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v])

  async function salvar() {
    setSalvando(true); setErroBanco('')
    const linha = {
      gatilho_id: f.gatilho_id, ativa: f.ativa, canais: f.canais, template_id: f.template_id,
      destino: montarDestino(f.destino), janela_envio: montarJanela(f.janela),
      atraso_segundos: Number(f.atraso_segundos), prioridade: Number(f.prioridade),
      // Condição que a tela não sabe editar (formato manual) é preservada como está.
      condicao: f.condicaoNaoEditavel ? regra.condicao : montarCondicao(f.condicao),
    }
    const { error } = novo
      ? await eventos().from('regras').insert(linha)
      : await eventos().from('regras').update(linha).eq('id', regra.id)
    setSalvando(false)
    if (error) setErroBanco('Não foi possível salvar: ' + error.message)
    else onSalvo()
  }

  const gatilhosPorSistema = Object.entries(SISTEMAS).map(([slug, nome]) => [nome, dados.gatilhos.filter((g) => g.origens?.slug === slug)])
    .filter(([, l]) => l.length)

  return (
    <Modal titulo={novo ? 'Nova regra' : 'Editar regra'} onFechar={onFechar}
      rodape={(
        <>
          <button onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || erros.length > 0} className={BOTAO_PRIMARIO}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      )}>
      {gatilho?.modo === 'ativo' && f.ativa && (
        <Aviso>O gatilho <strong>{gatilho.tipo}</strong> está <strong>ativo</strong>: esta regra passa a gerar envios reais assim que for salva.</Aviso>
      )}
      {gatilho?.modo === 'sombra' && (
        <p className="text-xs text-amber-400">O gatilho está em sombra: a regra só gera envios simulados, nada é enviado de verdade.</p>
      )}
      {gatilho && ['legado', 'desligado'].includes(gatilho.modo) && (
        <p className="text-xs text-slate-400">O gatilho está em “{MODO_TEXTO[gatilho.modo]}”: a regra fica guardada, mas ainda não gera envios.</p>
      )}

      <Campo rotulo="Quando (gatilho)">
        <select value={f.gatilho_id} onChange={(e) => set({ gatilho_id: e.target.value })} className={INPUT}>
          <option value="">Escolha…</option>
          {gatilhosPorSistema.map(([nome, lista]) => (
            <optgroup key={nome} label={nome}>
              {lista.map((g) => <option key={g.id} value={g.id}>{g.tipo} ({MODO_TEXTO[g.ativo ? g.modo : 'desligado']})</option>)}
            </optgroup>
          ))}
        </select>
      </Campo>

      <Campo rotulo="Condição (opcional)" dica="A regra só vale se TODAS as linhas forem verdadeiras. Campo é o nome no evento, por exemplo etapa ou valor_total.">
        <div className="space-y-2">
          {f.condicaoNaoEditavel && <p className="text-xs text-amber-400">Esta regra tem uma condição em formato avançado; ela será mantida como está.</p>}
          {!f.condicaoNaoEditavel && f.condicao.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input placeholder="campo" value={l.campo} className={INPUT}
                onChange={(e) => set({ condicao: f.condicao.map((x, j) => (j === i ? { ...x, campo: e.target.value } : x)) })} />
              <select value={l.op} className={INPUT}
                onChange={(e) => set({ condicao: f.condicao.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
                {OPERADORES.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
              </select>
              <input placeholder="valor" value={l.valor} className={INPUT}
                onChange={(e) => set({ condicao: f.condicao.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ condicao: f.condicao.filter((_, j) => j !== i) })}
                className="text-slate-400 hover:text-red-400 px-1" aria-label="Remover condição"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {!f.condicaoNaoEditavel && (
            <button type="button" onClick={() => set({ condicao: [...f.condicao, { campo: '', op: '=', valor: '' }] })}
              className={BOTAO_PEQUENO}><Plus className="w-3 h-3" /> Adicionar condição</button>
          )}
        </div>
      </Campo>

      <Campo rotulo="Por qual canal">
        <div className="flex flex-wrap gap-4">
          {dados.canais.map((c) => {
            const marcado = f.canais.includes(c.slug)
            const sem = !CANAIS_COM_ENVIO.includes(c.slug)
            return (
              <label key={c.slug} className={`flex items-center gap-2 text-sm ${sem && !marcado ? 'text-slate-600' : 'text-slate-300'}`}>
                <input type="checkbox" checked={marcado} disabled={sem && !marcado}
                  onChange={() => set({ canais: alternar(f.canais, c.slug) })} />
                {c.slug}{sem ? ' (ainda sem envio)' : ''}
              </label>
            )
          })}
        </div>
      </Campo>

      <Campo rotulo="Template (texto da mensagem)">
        <select value={f.template_id} onChange={(e) => set({ template_id: e.target.value })} className={INPUT}>
          <option value="">Escolha…</option>
          {dados.templates.map((t) => <option key={t.id} value={t.id}>{t.canal} · {resumo(t.corpo, 60)}</option>)}
        </select>
      </Campo>

      <Campo rotulo="Quem recebe" dica="Some pessoas, grupos e/ou o campo do evento que traz o e-mail da pessoa (ex.: requisitante_email).">
        <div className="space-y-3">
          <input placeholder="Campo do evento com o e-mail (opcional)" value={f.destino.payloadEmail} className={INPUT}
            onChange={(e) => set({ destino: { ...f.destino, payloadEmail: e.target.value } })} />
          {dados.grupos.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {dados.grupos.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={f.destino.grupos.includes(g.slug)}
                    onChange={() => set({ destino: { ...f.destino, grupos: alternar(f.destino.grupos, g.slug) } })} />
                  Grupo {g.nome}
                </label>
              ))}
            </div>
          )}
          <input placeholder="Buscar pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} className={INPUT} />
          <div className="max-h-40 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border">
            {pessoas.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm text-slate-300 px-3 py-1.5">
                <input type="checkbox" checked={f.destino.destinatarios.includes(d.id)}
                  onChange={() => set({ destino: { ...f.destino, destinatarios: alternar(f.destino.destinatarios, d.id) } })} />
                {d.nome}
              </label>
            ))}
            {pessoas.length === 0 && <p className="text-xs text-slate-500 px-3 py-2">Ninguém encontrado.</p>}
          </div>
          {f.destino.destinatarios.length > 0 && <p className="text-xs text-slate-500">{f.destino.destinatarios.length} pessoa(s) marcada(s).</p>}
        </div>
      </Campo>

      <Campo rotulo="Janela de envio" dica="Fora da janela a mensagem espera até a próxima abertura (horário de Brasília). O início deve ser antes do fim, no mesmo dia.">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={f.janela.ativa} onChange={(e) => set({ janela: { ...f.janela, ativa: e.target.checked } })} />
            Só enviar em certos horários
          </label>
          {f.janela.ativa && (
            <>
              <div className="flex items-center gap-2">
                <input type="time" value={f.janela.inicio} className={`${INPUT} max-w-32`}
                  onChange={(e) => set({ janela: { ...f.janela, inicio: e.target.value } })} />
                <span className="text-slate-500 text-sm">até</span>
                <input type="time" value={f.janela.fim} className={`${INPUT} max-w-32`}
                  onChange={(e) => set({ janela: { ...f.janela, fim: e.target.value } })} />
              </div>
              <div className="flex gap-3 flex-wrap">
                {DIAS.map((d) => (
                  <label key={d.n} className="flex items-center gap-1 text-sm text-slate-300">
                    <input type="checkbox" checked={f.janela.dias.includes(d.n)}
                      onChange={() => set({ janela: { ...f.janela, dias: alternar(f.janela.dias, d.n) } })} />
                    {d.t}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </Campo>

      <div className="grid grid-cols-2 gap-4">
        <Campo rotulo="Atraso (segundos)" dica="Espera antes de enviar; 0 = assim que possível.">
          <input type="number" min="0" value={f.atraso_segundos} onChange={(e) => set({ atraso_segundos: e.target.value })} className={INPUT} />
        </Campo>
        <Campo rotulo="Prioridade" dica="Menor número = avaliada primeiro.">
          <input type="number" min="1" max="99" value={f.prioridade} onChange={(e) => set({ prioridade: e.target.value })} className={INPUT} />
        </Campo>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={f.ativa} onChange={(e) => set({ ativa: e.target.checked })} /> Regra ativa
      </label>

      {template && (
        <>
          <BlocoAmostra amostra={amostra} />
          <Previa corpo={template.corpo} payload={amostra.payload} />
        </>
      )}
      <ErrosDoFormulario erros={[...erros, ...(erroBanco ? [erroBanco] : [])]} />
    </Modal>
  )
}

function Regras({ dados, recarregar }) {
  const [editando, setEditando] = useState(null)
  const nomeGatilho = useCallback((id) => dados.gatilhos.find((g) => g.id === id), [dados.gatilhos])
  const nomePessoa = (id) => dados.destinatarios.find((d) => d.id === id)?.nome

  function quemRecebe(r) {
    const d = lerDestino(r.destino)
    const partes = []
    if (d.payloadEmail) partes.push(`dono do evento (${d.payloadEmail})`)
    if (d.destinatarios.length) {
      const nomes = d.destinatarios.map(nomePessoa).filter(Boolean)
      partes.push(nomes.length <= 2 ? nomes.join(', ') : `${nomes.length} pessoas`)
    }
    if (d.grupos.length) partes.push(`grupo ${d.grupos.join(', ')}`)
    return partes.join(' + ') || '—'
  }

  async function alternarAtiva(r) {
    const g = nomeGatilho(r.gatilho_id)
    if (!r.ativa && g?.modo === 'ativo' && !window.confirm('O gatilho está ATIVO: reativar esta regra volta a gerar envios reais. Continuar?')) return
    const { error } = await eventos().from('regras').update({ ativa: !r.ativa }).eq('id', r.id)
    if (error) window.alert('Não foi possível alterar a regra: ' + error.message)
    else recarregar()
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditando({})} className={BOTAO_PRIMARIO}><Plus className="w-4 h-4" /> Nova regra</button>
      </div>
      {dados.regras.length === 0
        ? <Vazio texto="Nenhuma regra de comunicação criada. Cada regra define quando, por qual canal e para quem enviar." />
        : (
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wider border-b border-surface-border">
                  {['Gatilho', 'Canais', 'Quem recebe', 'Mensagem', 'Janela', 'Prior.', 'Estado', ''].map((t) => <th key={t} className="px-4 py-3 whitespace-nowrap">{t}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {dados.regras.map((r) => {
                  const g = nomeGatilho(r.gatilho_id)
                  const t = dados.templates.find((x) => x.id === r.template_id)
                  return (
                    <tr key={r.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 align-top">
                        <code className="text-violet-300 text-xs">{g?.tipo ?? '—'}</code>
                        {g && <div className="mt-1"><Chip cls={MODO_COR[g.ativo ? g.modo : 'desligado']}>{MODO_TEXTO[g.ativo ? g.modo : 'desligado']}</Chip></div>}
                      </td>
                      <td className="px-4 py-3 text-slate-300 align-top">{(r.canais ?? []).join(', ')}</td>
                      <td className="px-4 py-3 text-slate-300 align-top">{quemRecebe(r)}</td>
                      <td className="px-4 py-3 text-slate-300 align-top">{t ? resumo(t.corpo, 50) : <span className="text-red-400">sem template</span>}</td>
                      <td className="px-4 py-3 text-slate-300 align-top whitespace-nowrap">{resumoJanela(r.janela_envio)}</td>
                      <td className="px-4 py-3 text-slate-300 align-top">{r.prioridade}</td>
                      <td className="px-4 py-3 text-slate-300 align-top">{r.ativa ? 'Ativa' : 'Inativa'}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => alternarAtiva(r)} className={BOTAO_PEQUENO}><Power className="w-3 h-3" /> {r.ativa ? 'Desativar' : 'Ativar'}</button>
                          <button onClick={() => setEditando(r)} className={BOTAO_PEQUENO}><Pencil className="w-3 h-3" /> Editar</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      {editando && (
        <EditorRegra regra={editando} dados={dados} onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); recarregar() }} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Aba */
export default function RegrasETemplates() {
  const [sub, setSub] = useState('regras')
  const [versao, setVersao] = useState(0)
  const { carregando, erro, d } = useDadosDaCentral(versao)
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  if (carregando && !d) return <Carregando />
  if (erro) return <Aviso>O banco da Central de Eventos ainda não foi ativado neste ambiente, ou você não tem acesso: {erro}</Aviso>

  return (
    <div>
      <Aviso>
        Uma <strong>regra</strong> diz quando (gatilho), por qual canal e para quem enviar; o <strong>template</strong> é o texto da mensagem.
        Alterações valem para os próximos eventos e ficam registradas na Auditoria. Só gatilhos em modo <strong>Ativo</strong> enviam de verdade.
      </Aviso>
      <div className="flex gap-2 mb-5">
        {[['regras', 'Regras'], ['templates', 'Templates']].map(([id, nome]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`text-sm px-4 py-1.5 rounded-lg border ${sub === id ? 'border-violet-400 text-white bg-violet-500/10' : 'border-surface-border text-slate-400 hover:text-slate-200'}`}>
            {nome}
          </button>
        ))}
      </div>
      {sub === 'regras' ? <Regras dados={d} recarregar={recarregar} /> : <Templates dados={d} recarregar={recarregar} />}
    </div>
  )
}
