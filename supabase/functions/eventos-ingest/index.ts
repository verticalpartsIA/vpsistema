// API de ingestão da Central de Eventos: os sistemas publicam fatos de negócio aqui.
// Chamada por outros servidores (não pelo navegador) → deploy com verify_jwt = false;
// a autenticação é por origem: X-Origem + X-Timestamp + X-Assinatura (HMAC-SHA256).
// Só grava o evento e responde. Nenhum envio acontece dentro da requisição.
// Contrato e códigos de resposta: docs/eventos/02-modelo-dados-api.md
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  MAX_BODY_BYTES, assinaturaConfere, slugValido, timestampValido,
  validarEnvelope, validarPayload,
} from '../_shared/eventos-ingest-core.ts'

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } })

// Resposta única para origem inexistente, sem segredo ou assinatura errada:
// quem erra não descobre quais origens existem.
const NEGADO = () => json({ error: 'Não autorizado' }, 401)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405, { Allow: 'POST' })

  const slug = req.headers.get('x-origem')
  const timestamp = req.headers.get('x-timestamp')
  const assinatura = req.headers.get('x-assinatura')
  if (!slugValido(slug) || !timestamp || !assinatura) return NEGADO()
  if (!timestampValido(timestamp, Date.now())) return json({ error: 'Timestamp fora da janela de 5 minutos' }, 401)

  const bruto = await req.text()
  if (new TextEncoder().encode(bruto).length > MAX_BODY_BYTES) return json({ error: 'Corpo maior que 64 KB' }, 413)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'eventos' },
    auth: { persistSession: false },
  })

  const { data: origens, error: errOrigem } = await admin.rpc('segredo_origem', { p_slug: slug })
  if (errOrigem) {
    console.error('eventos-ingest: segredo_origem falhou:', errOrigem.message)
    return json({ error: 'Falha temporária, tente novamente' }, 503, { 'Retry-After': '30' })
  }
  const origem = origens?.[0]
  if (!origem?.segredo || !(await assinaturaConfere(origem.segredo, timestamp, bruto, assinatura))) return NEGADO()
  if (!origem.ativo) return json({ error: 'Origem desativada' }, 403)

  let corpo: unknown
  try { corpo = JSON.parse(bruto) } catch { return json({ error: 'JSON inválido' }, 400) }

  const envelope = validarEnvelope(corpo, Date.now())
  if ('status' in envelope) return json({ error: envelope.error, detalhes: envelope.detalhes }, envelope.status)

  const { data: gatilhos, error: errGatilho } = await admin.rpc('gatilho_origem', {
    p_origem: origem.origem_id, p_tipo: envelope.tipo,
  })
  if (errGatilho) {
    console.error('eventos-ingest: gatilho_origem falhou:', errGatilho.message)
    return json({ error: 'Falha temporária, tente novamente' }, 503, { 'Retry-After': '30' })
  }
  if (!gatilhos?.length) {
    return json({ error: 'Tipo de evento não cadastrado no catálogo desta origem', tipo: envelope.tipo }, 404)
  }

  const errosPayload = validarPayload(envelope.payload, gatilhos[0].schema_payload)
  if (errosPayload.length) return json({ error: 'Payload fora do schema do gatilho', detalhes: errosPayload }, 400)

  const { data: reg, error: errReg } = await admin.rpc('registrar_evento', {
    p_origem: origem.origem_id,
    p_limite: origem.limite,
    p_tipo: envelope.tipo,
    p_key: envelope.idempotency_key,
    p_ocorrido: envelope.ocorrido_em,
    p_ator: envelope.ator,
    p_ent_tipo: envelope.entidade.tipo,
    p_ent_id: envelope.entidade.id ?? envelope.entidade.numero,
    p_payload: envelope.payload,
  })
  if (errReg) {
    console.error('eventos-ingest: registrar_evento falhou:', errReg.message)
    return json({ error: 'Falha temporária, tente novamente' }, 503, { 'Retry-After': '30' })
  }

  switch (reg?.resultado) {
    case 'criado':    return json({ evento_id: reg.evento_id, duplicado: false }, 202)
    case 'duplicado': return json({ evento_id: reg.evento_id, duplicado: true }, 200)
    case 'limite':    return json({ error: 'Limite de eventos por minuto excedido' }, 429, { 'Retry-After': '60' })
    default:          return json({ error: 'Resposta inesperada do banco' }, 500)
  }
})
