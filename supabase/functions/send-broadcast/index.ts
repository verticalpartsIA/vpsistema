// Executa um disparo agendado de WhatsApp (tabela scheduled_broadcasts). Chamada pelo
// pg_cron com um token de uso único (x-job-token). verify_jwt = false.
// Responde 202 na hora e envia em segundo plano, com intervalo de 2 a 3 s entre as
// mensagens (a linha é a do Pós-Venda; rajada sem pausa aumenta o risco de bloqueio).
import { sendWhatsAppText } from '../_shared/whatsapp.ts'
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const mask = (p: string) => `${p.slice(0, 2)}•••••${p.slice(-4)}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = req.headers.get('x-job-token') ?? ''
    const { id } = await req.json()
    if (!token || typeof id !== 'string') return json({ error: 'Não autorizado' }, 401)

    const admin = adminClient()

    // Reivindica o disparo de forma atômica: só roda uma vez, no horário, com o token certo.
    const { data: job } = await admin
      .from('scheduled_broadcasts')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', id)
      .eq('token_hash', await sha256Hex(token))
      .eq('status', 'pending')
      .lte('run_at', new Date(Date.now() + 5 * 60 * 1000).toISOString())
      .select('id, message, audience')
      .maybeSingle()
    if (!job) return json({ error: 'Disparo indisponível' }, 409)

    EdgeRuntime.waitUntil((async () => {
      let sent = 0
      const failures: Record<string, string> = {}
      let recipients: { phone: string; name: string }[] = []
      try {
        if (job.audience && job.audience.length) {
          recipients = [...new Set(job.audience as string[])].map(phone => ({ phone, name: '' }))
        } else {
          const { data, error } = await admin.rpc('broadcast_recipients')
          if (error) throw error
          recipients = data ?? []
        }
        await admin.from('scheduled_broadcasts').update({ recipients: recipients.length }).eq('id', job.id)

        for (const r of recipients) {
          try {
            await sendWhatsAppText(r.phone, job.message)
            sent++
          } catch (e) {
            failures[mask(r.phone)] = String((e as Error)?.message || e).slice(0, 160)
          }
          await sleep(2000 + Math.floor(Math.random() * 1000))
        }
        await admin.from('scheduled_broadcasts').update({
          status: Object.keys(failures).length === recipients.length && recipients.length > 0 ? 'failed' : 'done',
          sent, failed: Object.keys(failures).length, detail: { falhas: failures },
          finished_at: new Date().toISOString(),
        }).eq('id', job.id)
      } catch (e) {
        console.error('send-broadcast:', String((e as Error)?.message || e))
        await admin.from('scheduled_broadcasts').update({
          status: 'failed', sent, failed: Object.keys(failures).length,
          detail: { erro: String((e as Error)?.message || e).slice(0, 300), falhas: failures },
          finished_at: new Date().toISOString(),
        }).eq('id', job.id)
      }
    })())

    return json({ accepted: true }, 202)
  } catch (err) {
    console.error('send-broadcast:', String((err as Error)?.message || err))
    return json({ error: 'Erro' }, 500)
  }
})
