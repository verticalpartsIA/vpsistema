// Lógica pura do worker de envio da Central de Eventos (sem Deno nem Supabase), testável em Node.
// O handler fica em eventos-worker/index.ts. Contrato: docs/eventos/04-roteador-e-worker.md

import { normalizePhoneBR } from './whatsapp.ts'

export interface Reserva {
  envio_id: string
  canal: string
  tentativa: number
  whatsapp: string | null
  email: string | null
  nome: string | null
  mensagem: string | null
  intervalo_min_ms: number
}

export interface Resultado {
  resultado: 'enviado' | 'erro'
  http?: number | null
  erro?: string | null
  idExterno?: string | null
  /** Não adianta tentar de novo (número inexistente, canal sem adaptador...). */
  permanente?: boolean
  /** O canal não está configurado: devolve à fila sem gastar tentativa. */
  semConfig?: boolean
}

export const BUDGET_MS = 50_000

/** Telefone nunca aparece inteiro em log ou erro. */
export function mascararTelefone(tel: string | null | undefined): string {
  const d = String(tel ?? '').replace(/\D/g, '')
  return d.length >= 6 ? `${d.slice(0, 2)}•••••${d.slice(-4)}` : '—'
}

/** Quantos envios cabem no tempo da execução, dado o intervalo mínimo entre mensagens. */
export function tamanhoDoLote(intervaloMs: number, orcamentoMs = BUDGET_MS, maximo = 20): number {
  const i = Math.max(intervaloMs, 250)
  return Math.max(1, Math.min(maximo, Math.floor(orcamentoMs / i)))
}

/**
 * Classifica a resposta HTTP da Evolution API.
 *  - 2xx: enviado.
 *  - 400/404/422: o número ou o pedido é inválido → permanente.
 *  - 401/403: chave errada ou sem acesso → NÃO é culpa da mensagem; tenta de novo com espera.
 *  - 408/429/5xx e erro de rede: transitório.
 */
export function classificarResposta(status: number, corpo: string): Resultado {
  if (status >= 200 && status < 300) return { resultado: 'enviado', http: status }
  const trecho = corpo.replace(/\s+/g, ' ').slice(0, 200)
  const permanente = status === 400 || status === 404 || status === 422
  return { resultado: 'erro', http: status, erro: `Evolution ${status}: ${trecho}`, permanente }
}

/** Extrai o id da mensagem na resposta de sucesso da Evolution (key.id), se vier. */
export function extrairIdExterno(corpo: string): string | null {
  try {
    const j = JSON.parse(corpo)
    return (j?.key?.id ?? j?.data?.key?.id ?? j?.id ?? null) as string | null
  } catch {
    return null
  }
}

export function montarEnvioWhatsApp(
  cfg: { url: string; key: string; instance: string },
  numeroBR: string,
  texto: string,
): { url: string; init: RequestInit } {
  return {
    url: `${cfg.url.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(cfg.instance)}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key },
      body: JSON.stringify({ number: `55${numeroBR}`, text: texto }),
    },
  }
}

/** Valida a reserva antes de chamar o canal. Devolve um Resultado se já dá para decidir. */
export function validarReserva(r: Reserva): Resultado | null {
  if (r.canal === 'whatsapp') {
    if (!normalizePhoneBR(r.whatsapp)) return { resultado: 'erro', erro: 'telefone inválido', permanente: true }
    if (!r.mensagem?.trim()) return { resultado: 'erro', erro: 'mensagem vazia', permanente: true }
    return null
  }
  if (r.canal === 'email') return { resultado: 'erro', erro: 'canal e-mail ainda não tem adaptador', permanente: true }
  if (r.canal === 'interno') {
    return { resultado: 'erro', erro: 'canal interno ainda não tem adaptador por sistema', permanente: true }
  }
  return { resultado: 'erro', erro: `canal desconhecido: ${r.canal}`, permanente: true }
}
