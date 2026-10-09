// Rodar: node --experimental-strip-types --test supabase/functions/_shared/__tests__/eventos-worker-core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classificarResposta, extrairIdExterno, mascararTelefone, montarEnvioWhatsApp, tamanhoDoLote, validarReserva,
} from '../eventos-worker-core.ts'

const reserva = (o = {}) => ({ envio_id: 'e1', canal: 'whatsapp', tentativa: 1, whatsapp: '11987654321',
  email: null, nome: 'Ana', mensagem: 'olá', intervalo_min_ms: 2000, ...o })

test('telefone mascarado nunca mostra o número inteiro', () => {
  assert.equal(mascararTelefone('11987654321'), '11•••••4321')
  assert.equal(mascararTelefone('(11) 98765-4321'), '11•••••4321')
  assert.equal(mascararTelefone(null), '—')
  assert.equal(mascararTelefone('123'), '—')
  assert.ok(!mascararTelefone('11987654321').includes('98765'))
})

test('tamanho do lote cabe no orçamento de tempo', () => {
  assert.equal(tamanhoDoLote(2000), 20)       // 50s / 2s = 25, limitado a 20
  assert.equal(tamanhoDoLote(5000), 10)
  assert.equal(tamanhoDoLote(60000), 1)       // nunca zero
  assert.equal(tamanhoDoLote(0), 20)          // intervalo mínimo de segurança
  assert.equal(tamanhoDoLote(2000, 10000), 5)
})

test('classificação das respostas da Evolution', () => {
  assert.equal(classificarResposta(201, '{}').resultado, 'enviado')
  assert.equal(classificarResposta(200, '{}').resultado, 'enviado')
  for (const s of [400, 404, 422]) assert.equal(classificarResposta(s, 'x').permanente, true, `HTTP ${s}`)
  // chave errada / sem acesso: não é culpa da mensagem → tenta de novo
  for (const s of [401, 403]) assert.equal(classificarResposta(s, 'x').permanente, false, `HTTP ${s}`)
  for (const s of [408, 429, 500, 502, 503]) assert.equal(classificarResposta(s, 'x').permanente, false, `HTTP ${s}`)
  const e = classificarResposta(400, 'a\n  b   '.repeat(100))
  assert.ok(e.erro.length <= 240 && !e.erro.includes('\n'))
})

test('id externo da mensagem', () => {
  assert.equal(extrairIdExterno('{"key":{"id":"ABC"}}'), 'ABC')
  assert.equal(extrairIdExterno('{"data":{"key":{"id":"Z"}}}'), 'Z')
  assert.equal(extrairIdExterno('não é json'), null)
  assert.equal(extrairIdExterno('{}'), null)
})

test('requisição à Evolution: URL sem barra dupla, instância escapada, número com 55', () => {
  const { url, init } = montarEnvioWhatsApp({ url: 'https://evo.exemplo.com//', key: 'K', instance: 'pv 360' }, '11987654321', 'oi')
  assert.equal(url, 'https://evo.exemplo.com/message/sendText/pv%20360')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.apikey, 'K')
  assert.deepEqual(JSON.parse(init.body), { number: '5511987654321', text: 'oi' })
})

test('validação da reserva antes de chamar o canal', () => {
  assert.equal(validarReserva(reserva()), null)
  assert.match(validarReserva(reserva({ whatsapp: '123' })).erro, /telefone/)
  assert.equal(validarReserva(reserva({ whatsapp: null })).permanente, true)
  assert.match(validarReserva(reserva({ mensagem: '  ' })).erro, /vazia/)
  assert.match(validarReserva(reserva({ canal: 'email' })).erro, /e-mail/)
  assert.match(validarReserva(reserva({ canal: 'interno' })).erro, /interno/)
  assert.match(validarReserva(reserva({ canal: 'sms' })).erro, /desconhecido/)
  for (const c of ['email', 'interno', 'sms']) assert.equal(validarReserva(reserva({ canal: c })).permanente, true)
  assert.equal(validarReserva(reserva({ whatsapp: '5511987654321' })), null) // 55 na frente é aceito
})
