// Lógica pura da tela de Regras e Templates da Central de Eventos (sem React nem Supabase), testável em Node.
// Espelha o que o banco entende: eventos.renderizar, avaliar_condicao, proxima_janela e resolver_destinatarios
// (docs/eventos/sql/03_roteador_worker.sql). Se o formato mudar lá, muda aqui.

export const OPERADORES = [
  { v: '=', t: 'igual a' },
  { v: '!=', t: 'diferente de' },
  { v: '>', t: 'maior que' },
  { v: '>=', t: 'maior ou igual a' },
  { v: '<', t: 'menor que' },
  { v: '<=', t: 'menor ou igual a' },
  { v: 'in', t: 'é um destes (separe por vírgula)' },
]

// Canais que o worker consegue entregar hoje. Os outros existem na tabela, mas ainda não têm adaptador.
export const CANAIS_COM_ENVIO = ['whatsapp']

export const DIAS = [
  { n: 1, t: 'Seg' }, { n: 2, t: 'Ter' }, { n: 3, t: 'Qua' }, { n: 4, t: 'Qui' },
  { n: 5, t: 'Sex' }, { n: 6, t: 'Sáb' }, { n: 7, t: 'Dom' },
]

export const LIMITE_MENSAGEM = 4000

/** Mesma regra de eventos.renderizar: {{campo}} ou {{a.b}}; campo ausente vira texto vazio; máximo de 4000 caracteres. */
export function renderizarModelo(modelo, dados) {
  const texto = String(modelo ?? '').replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, caminho) => {
    const v = caminho.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), dados)
    if (v == null) return ''
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
  return texto.slice(0, LIMITE_MENSAGEM)
}

/** Variáveis {{...}} usadas no modelo, sem repetição, na ordem em que aparecem. */
export function variaveisDoModelo(modelo) {
  const achadas = []
  for (const m of String(modelo ?? '').matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) {
    if (!achadas.includes(m[1])) achadas.push(m[1])
  }
  return achadas
}

/** Variáveis que o roteador sempre acrescenta ao payload do evento. */
export const VARIAVEIS_DO_ROTEADOR = ['destinatario_nome', 'evento_tipo', 'entidade_id']

/** Variáveis do modelo que não existem no exemplo de payload nem entre as do roteador (provável erro de digitação). */
export function variaveisDesconhecidas(modelo, payload) {
  return variaveisDoModelo(modelo).filter((v) => {
    if (VARIAVEIS_DO_ROTEADOR.includes(v)) return false
    const achou = v.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), payload)
    return achou === undefined
  })
}

/* ------------------------------------------------------------------ Condição */

/** Banco → linhas do formulário. `null` = sem condição. Devolve null se o formato não é o que a tela sabe editar. */
export function lerCondicao(cond) {
  if (cond == null) return []
  const lista = Array.isArray(cond) ? cond : [cond]
  const linhas = []
  for (const c of lista) {
    if (!c || typeof c !== 'object' || typeof c.campo !== 'string' || !OPERADORES.some((o) => o.v === c.op)) return null
    linhas.push({
      campo: c.campo,
      op: c.op,
      valor: c.op === 'in' ? (Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor ?? '')) : String(c.valor ?? ''),
    })
  }
  return linhas
}

/** Linhas do formulário → jsonb. Linhas sem campo são ignoradas. Número digitado vira número (o banco compara como número). */
export function montarCondicao(linhas) {
  const validas = (linhas ?? []).filter((l) => l.campo?.trim())
  if (!validas.length) return null
  return validas.map((l) => {
    const campo = l.campo.trim()
    if (l.op === 'in') {
      return { campo, op: 'in', valor: String(l.valor ?? '').split(',').map((s) => s.trim()).filter(Boolean) }
    }
    const bruto = String(l.valor ?? '').trim()
    const ehNumero = /^-?\d+(\.\d+)?$/.test(bruto)
    return { campo, op: l.op, valor: ehNumero && l.op !== '=' && l.op !== '!=' ? Number(bruto) : bruto }
  })
}

/* ------------------------------------------------------------------ Janela de envio */

export const JANELA_PADRAO = { ativa: false, inicio: '07:00', fim: '18:00', dias: [1, 2, 3, 4, 5] }

export function lerJanela(j) {
  if (!j || typeof j !== 'object') return { ...JANELA_PADRAO }
  return {
    ativa: true,
    inicio: String(j.inicio ?? '00:00').slice(0, 5),
    fim: String(j.fim ?? '23:59').slice(0, 5),
    dias: Array.isArray(j.dias) ? j.dias.map(Number).filter((n) => n >= 1 && n <= 7) : [1, 2, 3, 4, 5, 6, 7],
  }
}

export function montarJanela(f) {
  if (!f?.ativa) return null
  return { inicio: f.inicio, fim: f.fim, dias: [...f.dias].sort((a, b) => a - b) }
}

/* ------------------------------------------------------------------ Destino */

export function lerDestino(d) {
  return {
    destinatarios: Array.isArray(d?.destinatarios) ? d.destinatarios : [],
    grupos: Array.isArray(d?.grupos) ? d.grupos : [],
    payloadEmail: typeof d?.payload_email === 'string' ? d.payload_email : '',
  }
}

export function montarDestino(f) {
  const d = {}
  if (f.destinatarios?.length) d.destinatarios = f.destinatarios
  if (f.grupos?.length) d.grupos = f.grupos
  if (f.payloadEmail?.trim()) d.payload_email = f.payloadEmail.trim()
  return d
}

/* ------------------------------------------------------------------ Validação */

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Erros que impedem salvar a regra. `template` é a linha de eventos.templates escolhida (ou undefined).
 * Cada regra usa um único template para todos os canais, então o canal do template tem de bater com o da regra.
 */
export function validarRegra(f, template) {
  const erros = []
  if (!f.gatilho_id) erros.push('Escolha o gatilho.')
  if (!f.canais?.length) erros.push('Escolha pelo menos um canal.')
  if (!f.template_id) erros.push('Escolha o template da mensagem.')
  else if (template && f.canais?.some((c) => c !== template.canal)) {
    erros.push(`O template escolhido é do canal ${template.canal}; a regra só pode usar esse canal com ele.`)
  }
  const d = montarDestino(f.destino ?? {})
  if (!Object.keys(d).length) erros.push('Diga quem recebe: pessoas, grupos ou o campo do e-mail no evento.')
  if (f.janela?.ativa) {
    if (!HORA.test(f.janela.inicio) || !HORA.test(f.janela.fim)) erros.push('Horário da janela inválido.')
    else if (f.janela.inicio >= f.janela.fim) erros.push('Na janela de envio, o início precisa ser antes do fim (mesmo dia).')
    if (!f.janela.dias?.length) erros.push('Escolha pelo menos um dia da semana na janela.')
  }
  const atraso = Number(f.atraso_segundos)
  if (!Number.isInteger(atraso) || atraso < 0) erros.push('O atraso precisa ser um número inteiro de segundos, zero ou mais.')
  const prio = Number(f.prioridade)
  if (!Number.isInteger(prio) || prio < 1 || prio > 99) erros.push('A prioridade precisa ser um número inteiro entre 1 e 99.')
  for (const l of f.condicao ?? []) {
    if (l.campo?.trim() && l.op !== 'in' && !String(l.valor ?? '').trim()) {
      erros.push(`Na condição sobre "${l.campo.trim()}", falta o valor.`)
    }
    if (l.campo?.trim() && l.op === 'in' && !montarCondicao([l])[0].valor.length) {
      erros.push(`Na condição sobre "${l.campo.trim()}", informe ao menos um valor.`)
    }
  }
  return erros
}

export function validarTemplate(f) {
  const erros = []
  if (!f.canal) erros.push('Escolha o canal.')
  if (!String(f.corpo ?? '').trim()) erros.push('Escreva a mensagem.')
  if (String(f.corpo ?? '').length > LIMITE_MENSAGEM) erros.push(`A mensagem passa de ${LIMITE_MENSAGEM} caracteres.`)
  return erros
}

/** Resume a janela para a lista: "Seg–Sex 07:00–18:00" ou "A qualquer hora". */
export function resumoJanela(j) {
  if (!j) return 'A qualquer hora'
  const f = lerJanela(j)
  const dias = [...f.dias].sort((a, b) => a - b)
  const nomes = dias.length === 7
    ? 'Todos os dias'
    : dias.length > 1 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1)
      ? `${DIAS[dias[0] - 1].t}–${DIAS[dias[dias.length - 1] - 1].t}`
      : dias.map((d) => DIAS[d - 1].t).join(', ')
  return `${nomes} ${f.inicio}–${f.fim}`
}
