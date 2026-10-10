// Rodar: node --test src/lib/__tests__/eventosRegras.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  renderizarModelo, variaveisDoModelo, variaveisDesconhecidas, lerCondicao, montarCondicao,
  lerJanela, montarJanela, lerDestino, montarDestino, validarRegra, validarTemplate, resumoJanela,
} from '../eventosRegras.js'

test('renderiza como o banco: campo ausente vira vazio, & e \\ entram literalmente', () => {
  assert.equal(renderizarModelo('Oi {{nome}}, {{ ticket }} {{x.y}} {{falta}}!', { nome: 'A&B\\C', ticket: 'REQ-1', x: { y: 2 } }), 'Oi A&B\\C, REQ-1 2 !')
  assert.equal(renderizarModelo('{{a}}'.repeat(5000), { a: 'x' }).length, 4000)
})

test('lista variáveis sem repetir e aponta as desconhecidas', () => {
  assert.deepEqual(variaveisDoModelo('{{a}} {{ b.c }} {{a}}'), ['a', 'b.c'])
  assert.deepEqual(variaveisDesconhecidas('{{ticket}} {{titulo}} {{destinatario_nome}} {{tikcet}}', { ticket: 1, titulo: 2 }), ['tikcet'])
})

test('condição: ida e volta, números e lista', () => {
  const linhas = [{ campo: 'valor_total', op: '>=', valor: '1000' }, { campo: 'etapa', op: 'in', valor: 'COTAÇÃO, APROVAÇÃO' }]
  const cond = montarCondicao(linhas)
  assert.deepEqual(cond, [{ campo: 'valor_total', op: '>=', valor: 1000 }, { campo: 'etapa', op: 'in', valor: ['COTAÇÃO', 'APROVAÇÃO'] }])
  assert.deepEqual(lerCondicao(cond), linhas)
  assert.equal(montarCondicao([{ campo: '  ', op: '=', valor: 'x' }]), null)
  assert.deepEqual(lerCondicao(null), [])
  assert.deepEqual(lerCondicao({ campo: 'a', op: '=', valor: 'b' }), [{ campo: 'a', op: '=', valor: 'b' }])
  assert.equal(lerCondicao({ qualquer: 1 }), null) // formato que a tela não sabe editar
})

test('janela: ida e volta e resumo', () => {
  const j = { inicio: '07:00', fim: '18:00', dias: [1, 2, 3, 4, 5] }
  assert.deepEqual(montarJanela(lerJanela(j)), j)
  assert.equal(montarJanela({ ...lerJanela(null) }), null)
  assert.equal(resumoJanela(j), 'Seg–Sex 07:00–18:00')
  assert.equal(resumoJanela(null), 'A qualquer hora')
  assert.equal(resumoJanela({ inicio: '08:00', fim: '12:00', dias: [1, 3, 6] }), 'Seg, Qua, Sáb 08:00–12:00')
  assert.equal(resumoJanela({ inicio: '08:00', fim: '12:00' }), 'Todos os dias 08:00–12:00')
})

test('destino: ida e volta sem campos vazios', () => {
  const d = { destinatarios: ['u1'], payload_email: 'requisitante_email' }
  assert.deepEqual(montarDestino(lerDestino(d)), d)
  assert.deepEqual(montarDestino(lerDestino(null)), {})
})

const regraOk = () => ({
  gatilho_id: 'g1', canais: ['whatsapp'], template_id: 't1', destino: { destinatarios: [], grupos: [], payloadEmail: 'requisitante_email' },
  janela: { ativa: true, inicio: '07:00', fim: '18:00', dias: [1, 2] }, atraso_segundos: 0, prioridade: 5, condicao: [],
})

test('regra válida passa; cada defeito gera uma mensagem', () => {
  assert.deepEqual(validarRegra(regraOk(), { canal: 'whatsapp' }), [])
  assert.equal(validarRegra({ ...regraOk(), gatilho_id: '' }, null).length, 1)
  assert.equal(validarRegra({ ...regraOk(), canais: [] }, null).length, 1)
  assert.equal(validarRegra({ ...regraOk(), template_id: '' }, null).length, 1)
  assert.equal(validarRegra({ ...regraOk(), destino: { destinatarios: [], grupos: [], payloadEmail: '' } }, { canal: 'whatsapp' }).length, 1)
  assert.match(validarRegra({ ...regraOk(), canais: ['whatsapp', 'email'] }, { canal: 'whatsapp' })[0], /canal whatsapp/)
  assert.match(validarRegra({ ...regraOk(), janela: { ativa: true, inicio: '18:00', fim: '07:00', dias: [1] } }, { canal: 'whatsapp' })[0], /antes do fim/)
  assert.match(validarRegra({ ...regraOk(), janela: { ativa: true, inicio: '07:00', fim: '18:00', dias: [] } }, { canal: 'whatsapp' })[0], /dia da semana/)
  assert.equal(validarRegra({ ...regraOk(), atraso_segundos: -1 }, { canal: 'whatsapp' }).length, 1)
  assert.equal(validarRegra({ ...regraOk(), prioridade: 'x' }, { canal: 'whatsapp' }).length, 1)
  assert.match(validarRegra({ ...regraOk(), condicao: [{ campo: 'etapa', op: '=', valor: '' }] }, { canal: 'whatsapp' })[0], /falta o valor/)
  assert.match(validarRegra({ ...regraOk(), condicao: [{ campo: 'etapa', op: 'in', valor: ' , ' }] }, { canal: 'whatsapp' })[0], /ao menos um valor/)
})

test('template: precisa de canal e mensagem, e respeita o limite', () => {
  assert.deepEqual(validarTemplate({ canal: 'whatsapp', corpo: 'oi' }), [])
  assert.equal(validarTemplate({ canal: '', corpo: 'oi' }).length, 1)
  assert.equal(validarTemplate({ canal: 'whatsapp', corpo: '   ' }).length, 1)
  assert.equal(validarTemplate({ canal: 'whatsapp', corpo: 'x'.repeat(4001) }).length, 1)
})
