// Verificação da assinatura do Send Email Hook do Supabase Auth (padrão Standard Webhooks —
// cabeçalhos webhook-id / webhook-timestamp / webhook-signature). Lógica pura, sem Deno.serve,
// para poder ser testada com node:test fora do runtime Deno.

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function hmacSha256Base64(secretBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', secretBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return bytesToBase64(new Uint8Array(sig))
}

export interface SendEmailHookHeaders {
  'webhook-id'?: string | null
  'webhook-timestamp'?: string | null
  'webhook-signature'?: string | null
}

/**
 * Confere a assinatura do payload do Send Email Hook. `secret` vem no formato
 * `whsec_<base64>`, como o painel do Supabase mostra ao ativar o hook.
 * `toleranceSeconds` rejeita timestamps velhos demais (replay).
 */
export async function verifySendEmailHookSignature(
  headers: SendEmailHookHeaders,
  rawBody: string,
  secret: string,
  now: number = Date.now(),
  toleranceSeconds = 300,
): Promise<boolean> {
  const id = headers['webhook-id']
  const timestamp = headers['webhook-timestamp']
  const sigHeader = headers['webhook-signature']
  if (!id || !timestamp || !sigHeader || !secret) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSeconds) return false

  let secretBytes: Uint8Array
  try {
    secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  } catch {
    return false
  }
  const expected = await hmacSha256Base64(secretBytes, `${id}.${timestamp}.${rawBody}`)

  const provided = sigHeader.split(' ').map((s) => s.split(',')[1]).filter(Boolean)
  return provided.includes(expected)
}
