// Rodar: node --experimental-strip-types --test supabase/functions/_shared/__tests__/auth-email-hook-core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySendEmailHookSignature } from '../auth-email-hook-core.ts'

function toBase64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function sign(secretB64, id, timestamp, body) {
  const key = await crypto.subtle.importKey(
    'raw', Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  return toBase64(new Uint8Array(sig))
}

test('aceita assinatura válida', async () => {
  const secretB64 = toBase64(crypto.getRandomValues(new Uint8Array(32)))
  const secret = `whsec_${secretB64}`
  const id = 'msg_123'
  const now = Date.now()
  const timestamp = String(Math.floor(now / 1000))
  const body = '{"type":"recovery"}'
  const sig = await sign(secretB64, id, timestamp, body)

  const ok = await verifySendEmailHookSignature(
    { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${sig}` },
    body, secret, now,
  )
  assert.equal(ok, true)
})

test('rejeita assinatura errada', async () => {
  const secret = `whsec_${toBase64(crypto.getRandomValues(new Uint8Array(32)))}`
  const ok = await verifySendEmailHookSignature(
    {
      'webhook-id': 'msg_1',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-signature': 'v1,aW52YWxpZGE=',
    },
    '{}', secret,
  )
  assert.equal(ok, false)
})

test('rejeita timestamp fora da tolerância (replay)', async () => {
  const secretB64 = toBase64(crypto.getRandomValues(new Uint8Array(32)))
  const secret = `whsec_${secretB64}`
  const id = 'msg_old'
  const oldTimestamp = String(Math.floor(Date.now() / 1000) - 10000)
  const body = '{}'
  const sig = await sign(secretB64, id, oldTimestamp, body)

  const ok = await verifySendEmailHookSignature(
    { 'webhook-id': id, 'webhook-timestamp': oldTimestamp, 'webhook-signature': `v1,${sig}` },
    body, secret,
  )
  assert.equal(ok, false)
})

test('rejeita cabeçalhos ausentes', async () => {
  const ok = await verifySendEmailHookSignature({}, '{}', 'whsec_AAAA')
  assert.equal(ok, false)
})

test('rejeita quando falta o secret', async () => {
  const ok = await verifySendEmailHookSignature(
    { 'webhook-id': 'x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,abc' },
    '{}', '',
  )
  assert.equal(ok, false)
})
