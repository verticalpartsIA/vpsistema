// Envio de WhatsApp via Evolution API (v2). Config nos secrets da edge function:
//   EVOLUTION_API_URL   ex.: https://evolution.exemplo.com (sem barra final)
//   EVOLUTION_API_KEY   apikey da instância
//   EVOLUTION_INSTANCE  nome da instância conectada ao número da empresa

/** Só dígitos, sem o 55: devolve DDD + número (10 ou 11 dígitos) ou null. */
export function normalizePhoneBR(raw: unknown): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2)
  }
  return digits.length === 10 || digits.length === 11 ? digits : null
}

export async function sendWhatsAppText(phoneDigits: string, text: string): Promise<void> {
  const baseUrl = Deno.env.get('EVOLUTION_API_URL')?.replace(/\/+$/, '')
  const apiKey = Deno.env.get('EVOLUTION_API_KEY')
  const instance = Deno.env.get('EVOLUTION_INSTANCE')
  if (!baseUrl || !apiKey || !instance) {
    throw new Error('EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE não configurados nos secrets.')
  }

  const res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number: `55${phoneDigits}`, text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Evolution API ${res.status}: ${body.slice(0, 300)}`)
  }
}
