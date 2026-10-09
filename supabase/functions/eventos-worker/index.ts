// Worker de envio da Central de Eventos: entrega os envios 'pendente' pelos canais.
// Chamado pelo pg_cron (a cada minuto, via pg_net) com o header x-worker-token → verify_jwt = false.
// Só entrega envios de gatilhos em modo 'ativo': o roteador nunca cria 'pendente' em modo 'sombra'.
// Secrets da função: EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE (os mesmos do portal).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { normalizePhoneBR } from '../_shared/whatsapp.ts'
import {
  BUDGET_MS, classificarResposta, extrairIdExterno, mascararTelefone, montarEnvioWhatsApp,
  tamanhoDoLote, validarReserva,
  type Reserva, type Resultado,
} from '../_shared/eventos-worker-core.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function configWhatsApp() {
  const url = Deno.env.get('EVOLUTION_API_URL')
  const key = Deno.env.get('EVOLUTION_API_KEY')
  const instance = Deno.env.get('EVOLUTION_INSTANCE')
  return url && key && instance ? { url, key, instance } : null
}

async function enviarWhatsApp(r: Reserva): Promise<Resultado> {
  const cfg = configWhatsApp()
  if (!cfg) return { resultado: 'erro', erro: 'EVOLUTION_* não configurados na função', semConfig: true }

  const numero = normalizePhoneBR(r.whatsapp)!
  const { url, init } = montarEnvioWhatsApp(cfg, numero, r.mensagem!)
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    const corpo = await res.text().catch(() => '')
    const base = classificarResposta(res.status, corpo)
    return base.resultado === 'enviado' ? { ...base, idExterno: extrairIdExterno(corpo) } : base
  } catch (e) {
    return { resultado: 'erro', erro: `rede: ${String((e as Error)?.message || e).slice(0, 200)}` }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'eventos' },
    auth: { persistSession: false },
  })

  const { data: ok, error: errToken } = await admin.rpc('token_worker_ok', { p_token: req.headers.get('x-worker-token') ?? '' })
  if (errToken) {
    console.error('eventos-worker: token_worker_ok falhou:', errToken.message)
    return json({ error: 'Falha temporária' }, 503)
  }
  if (!ok) return json({ error: 'Não autorizado' }, 401)

  const inicio = Date.now()
  const resumo = { reservados: 0, enviados: 0, falhas: 0, devolvidos: 0 }

  // O limite do lote depende do intervalo do canal; começa pelo padrão do WhatsApp (2 s).
  const { data: lote, error: errReserva } = await admin.rpc('reservar_envios', { p_limite: tamanhoDoLote(2000) })
  if (errReserva) {
    console.error('eventos-worker: reservar_envios falhou:', errReserva.message)
    return json({ error: 'Falha temporária' }, 503)
  }

  const reservas = (lote ?? []) as Reserva[]
  resumo.reservados = reservas.length

  for (const r of reservas) {
    // Orçamento estourado: devolve o resto sem gastar tentativa.
    if (Date.now() - inicio > BUDGET_MS) {
      await admin.rpc('devolver_envio', { p_envio: r.envio_id, p_motivo: 'tempo da execução esgotado' })
      resumo.devolvidos++
      continue
    }

    const res = validarReserva(r) ?? (await enviarWhatsApp(r))

    if (res.semConfig) {
      await admin.rpc('devolver_envio', { p_envio: r.envio_id, p_motivo: res.erro ?? 'canal sem configuração' })
      resumo.devolvidos++
      continue
    }

    const { error } = await admin.rpc('registrar_tentativa', {
      p_envio: r.envio_id,
      p_resultado: res.resultado,
      p_http: res.http ?? null,
      p_erro: res.erro ?? null,
      p_id_externo: res.idExterno ?? null,
      p_permanente: res.permanente ?? false,
    })
    if (error) console.error('eventos-worker: registrar_tentativa falhou:', r.envio_id, error.message)

    if (res.resultado === 'enviado') resumo.enviados++
    else {
      resumo.falhas++
      console.warn('eventos-worker: falha', r.envio_id, r.canal, mascararTelefone(r.whatsapp), res.erro)
    }

    // Ritmo entre mensagens: rajada sem pausa aumenta o risco de bloqueio do número.
    if (r.canal === 'whatsapp') await sleep(r.intervalo_min_ms)
  }

  return json(resumo)
})
