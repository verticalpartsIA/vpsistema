// Lógica pura da API de ingestão da Central de Eventos (sem Deno nem Supabase),
// para poder ser testada em Node. O handler fica em eventos-ingest/index.ts.
// Contrato: docs/eventos/02-modelo-dados-api.md

export const MAX_BODY_BYTES = 64 * 1024
export const MAX_SKEW_SECONDS = 5 * 60

export interface Envelope {
  tipo: string
  idempotency_key: string
  ocorrido_em: string
  ator: unknown
  entidade: { tipo: string | null; id: string | null; numero: string | null }
  payload: Record<string, unknown>
}

export type Falha = { status: number; error: string; detalhes?: string[] }

const TIPO_RE = /^[a-z0-9_]+(\.[a-z0-9_]+){1,3}$/
const SLUG_RE = /^[a-z0-9_]{2,40}$/
const KEY_RE = /^[\w.:\-]{1,200}$/

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

/** Comparação em tempo constante (mesmo tamanho, sem sair no primeiro byte diferente). */
export function igualConstante(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function slugValido(slug: string | null): slug is string {
  return !!slug && SLUG_RE.test(slug)
}

/** Assinatura = HMAC-SHA256(segredo, `${timestamp}.${corpo bruto}`), em hex, no formato `sha256=<hex>`. */
export async function assinaturaEsperada(secret: string, timestamp: string, corpo: string): Promise<string> {
  return 'sha256=' + await hmacHex(secret, `${timestamp}.${corpo}`)
}

export function timestampValido(ts: string | null, agoraMs: number): boolean {
  if (!ts || !/^\d{10}$/.test(ts)) return false
  return Math.abs(agoraMs / 1000 - Number(ts)) <= MAX_SKEW_SECONDS
}

export async function assinaturaConfere(
  secret: string, timestamp: string, corpo: string, recebida: string | null,
): Promise<boolean> {
  if (!recebida) return false
  return igualConstante(await assinaturaEsperada(secret, timestamp, corpo), recebida.trim().toLowerCase())
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Valida o envelope do corpo. Devolve o envelope normalizado ou a falha 400. */
export function validarEnvelope(corpo: unknown, agoraMs: number): Envelope | Falha {
  if (!ehObjeto(corpo)) return { status: 400, error: 'Corpo deve ser um objeto JSON' }
  const erros: string[] = []

  const tipo = corpo.tipo
  if (typeof tipo !== 'string' || !TIPO_RE.test(tipo)) erros.push('tipo: use o formato sistema.entidade.acao em minúsculas (ex.: requisicao.aprovada)')

  const key = corpo.idempotency_key
  if (typeof key !== 'string' || !KEY_RE.test(key)) erros.push('idempotency_key: obrigatório, até 200 caracteres (letras, números, . : _ -)')

  let ocorrido = ''
  if (typeof corpo.ocorrido_em !== 'string' || Number.isNaN(Date.parse(corpo.ocorrido_em))) {
    erros.push('ocorrido_em: data ISO 8601 obrigatória')
  } else {
    ocorrido = new Date(corpo.ocorrido_em).toISOString()
    if (Date.parse(ocorrido) > agoraMs + MAX_SKEW_SECONDS * 1000) erros.push('ocorrido_em: não pode estar no futuro')
  }

  const payload = corpo.payload ?? {}
  if (!ehObjeto(payload)) erros.push('payload: deve ser um objeto')

  const ent = corpo.entidade
  if (ent !== undefined && !ehObjeto(ent)) erros.push('entidade: deve ser um objeto')
  const entidade = ehObjeto(ent)
    ? {
        tipo: typeof ent.tipo === 'string' ? ent.tipo.slice(0, 60) : null,
        id: ent.id == null ? null : String(ent.id).slice(0, 120),
        numero: ent.numero == null ? null : String(ent.numero).slice(0, 120),
      }
    : { tipo: null, id: null, numero: null }

  if (erros.length) return { status: 400, error: 'Evento inválido', detalhes: erros }

  return {
    tipo: tipo as string,
    idempotency_key: key as string,
    ocorrido_em: ocorrido,
    ator: corpo.ator ?? null,
    entidade,
    payload: payload as Record<string, unknown>,
  }
}

/**
 * Valida o payload contra o schema_payload do gatilho (subconjunto de JSON Schema:
 * `required` e `properties.<campo>.type`). Schema ausente = aceita qualquer objeto.
 */
export function validarPayload(payload: Record<string, unknown>, schema: unknown): string[] {
  if (!ehObjeto(schema)) return []
  const erros: string[] = []
  const requeridos = Array.isArray(schema.required) ? schema.required : []
  for (const campo of requeridos) {
    if (typeof campo === 'string' && (payload[campo] === undefined || payload[campo] === null)) {
      erros.push(`payload.${campo}: obrigatório`)
    }
  }
  const props = ehObjeto(schema.properties) ? schema.properties : {}
  for (const [campo, def] of Object.entries(props)) {
    const valor = payload[campo]
    if (valor === undefined || valor === null || !ehObjeto(def) || typeof def.type !== 'string') continue
    const tipoReal = Array.isArray(valor) ? 'array' : typeof valor
    const esperado = def.type === 'integer' ? 'number' : def.type
    if (tipoReal !== esperado) erros.push(`payload.${campo}: esperado ${def.type}`)
  }
  return erros
}
