// Rodar: node --experimental-strip-types --test supabase/functions/_shared/__tests__/eventos-ingest-core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assinaturaEsperada, assinaturaConfere, igualConstante, slugValido,
  timestampValido, validarEnvelope, validarPayload,
} from '../eventos-ingest-core.ts'

const AGORA = Date.parse('2026-10-09T21:00:00Z')
const ok = () => ({
  tipo: 'requisicao.aprovada', idempotency_key: 'req-1-aprovada-v1', ocorrido_em: '2026-10-09T20:59:00Z',
  ator: { email: 'a@b.com' }, entidade: { tipo: 'requisicao', id: 1234, numero: 'REQ-1' }, payload: { valor_total: 10 },
})

test('assinatura confere e muda se o corpo, o timestamp ou o segredo mudam', async () => {
  const corpo = JSON.stringify(ok())
  const ts = String(Math.floor(AGORA / 1000))
  const sig = await assinaturaEsperada('segredo', ts, corpo)
  assert.match(sig, /^sha256=[0-9a-f]{64}$/)
  assert.equal(await assinaturaConfere('segredo', ts, corpo, sig), true)
  assert.equal(await assinaturaConfere('segredo', ts, corpo + ' ', sig), false)
  assert.equal(await assinaturaConfere('segredo', String(Number(ts) + 1), corpo, sig), false)
  assert.equal(await assinaturaConfere('outro', ts, corpo, sig), false)
  assert.equal(await assinaturaConfere('segredo', ts, corpo, null), false)
  assert.equal(await assinaturaConfere('segredo', ts, corpo, sig.toUpperCase().replace('SHA256=', 'sha256=')), true)
})

test('vetor conhecido de HMAC-SHA256 (confere com a implementação de referência)', async () => {
  const { createHmac } = await import('node:crypto')
  const esperado = 'sha256=' + createHmac('sha256', 'k').update('1760000000.{"a":1}').digest('hex')
  assert.equal(await assinaturaEsperada('k', '1760000000', '{"a":1}'), esperado)
})

test('comparação constante', () => {
  assert.equal(igualConstante('abc', 'abc'), true)
  assert.equal(igualConstante('abc', 'abd'), false)
  assert.equal(igualConstante('abc', 'abcd'), false)
  assert.equal(igualConstante('', ''), true)
})

test('timestamp: janela de 5 minutos e formato', () => {
  const s = Math.floor(AGORA / 1000)
  assert.equal(timestampValido(String(s), AGORA), true)
  assert.equal(timestampValido(String(s - 299), AGORA), true)
  assert.equal(timestampValido(String(s - 301), AGORA), false)
  assert.equal(timestampValido(String(s + 301), AGORA), false)
  assert.equal(timestampValido('abc', AGORA), false)
  assert.equal(timestampValido(null, AGORA), false)
  assert.equal(timestampValido(String(s * 1000), AGORA), false)
})

test('slug da origem', () => {
  assert.equal(slugValido('vprequisicoes'), true)
  assert.equal(slugValido('VP'), false)
  assert.equal(slugValido("a'; drop"), false)
  assert.equal(slugValido(null), false)
})

test('envelope válido é normalizado', () => {
  const e = validarEnvelope(ok(), AGORA)
  assert.equal(e.tipo, 'requisicao.aprovada')
  assert.equal(e.ocorrido_em, '2026-10-09T20:59:00.000Z')
  assert.equal(e.entidade.id, '1234')
})

test('envelope inválido lista os erros', () => {
  const casos = [
    [null, 'objeto'],
    [{ ...ok(), tipo: 'Requisicao' }, 'tipo'],
    [{ ...ok(), tipo: 'requisicao' }, 'tipo'],
    [{ ...ok(), idempotency_key: '' }, 'idempotency_key'],
    [{ ...ok(), idempotency_key: 'a'.repeat(201) }, 'idempotency_key'],
    [{ ...ok(), ocorrido_em: 'ontem' }, 'ocorrido_em'],
    [{ ...ok(), ocorrido_em: '2026-10-10T21:00:00Z' }, 'futuro'],
    [{ ...ok(), payload: [1] }, 'payload'],
    [{ ...ok(), entidade: 'x' }, 'entidade'],
  ]
  for (const [corpo, trecho] of casos) {
    const r = validarEnvelope(corpo, AGORA)
    assert.equal(r.status, 400, JSON.stringify(corpo))
    assert.ok(JSON.stringify(r).includes(trecho), `${trecho} em ${JSON.stringify(r)}`)
  }
})

test('payload ausente vira objeto vazio; entidade ausente vira nulos', () => {
  const { payload, entidade, ...resto } = ok()
  const e = validarEnvelope(resto, AGORA)
  assert.deepEqual(e.payload, {})
  assert.deepEqual(e.entidade, { tipo: null, id: null, numero: null })
})

test('schema do gatilho: required e type', () => {
  const schema = { required: ['valor_total', 'departamento'], properties: { valor_total: { type: 'number' }, departamento: { type: 'string' }, itens: { type: 'array' } } }
  assert.deepEqual(validarPayload({ valor_total: 1, departamento: 'Compras' }, schema), [])
  assert.equal(validarPayload({ valor_total: 1 }, schema).length, 1)
  assert.equal(validarPayload({ valor_total: '1', departamento: 'x' }, schema).length, 1)
  assert.equal(validarPayload({ valor_total: 1, departamento: 'x', itens: 'a' }, schema).length, 1)
  assert.deepEqual(validarPayload({ qualquer: 1 }, null), [])
  assert.deepEqual(validarPayload({}, {}), [])
})
