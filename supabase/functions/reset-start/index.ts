// Passo 1 da recuperação de senha com 2FA: confere o e-mail no SERVIDOR; se a conta existir,
// estiver ativa e tiver celular cadastrado, manda dois códigos de 6 dígitos — um por e-mail,
// outro por WhatsApp. A resposta HTTP é sempre genérica: nunca revela se o e-mail existe, nem
// se a conta não tem celular (ver password_reset_start, migration 20261026180000).
// verify_jwt = false (chamada antes do login).
import nodemailer from 'npm:nodemailer'
import { sendWhatsAppText } from '../_shared/whatsapp.ts'
import { adminClient, clientIp, corsHeaders, json } from '../_shared/whatsapp-login.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()
    if (typeof email !== 'string' || !email || email.length > 254) {
      return json({ ok: true })
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('password_reset_start', {
      p_email: email, p_ip: clientIp(req),
    })
    if (error) {
      console.error('reset-start: password_reset_start falhou:', error.message)
      return json({ ok: true })
    }
    const r = Array.isArray(data) ? data[0] : data
    if (!r?.challenge_id) return json({ ok: true })

    if (r.status === 'ok') {
      const smtpPassword = Deno.env.get('SMTP_PASSWORD')
      try {
        if (!smtpPassword) throw new Error('SMTP_PASSWORD não configurado nos secrets da Edge Function.')
        const transporter = nodemailer.createTransport({
          host: 'smtp.hostinger.com',
          port: 587,
          secure: false,
          requireTLS: true,
          auth: { user: 'suporte@vpsistema.com', pass: smtpPassword },
        })
        await transporter.sendMail({
          from: '"VerticalParts" <suporte@vpsistema.com>',
          to: email,
          subject: 'Código de recuperação de senha — VerticalParts',
          text: `Seu código de recuperação: ${r.email_code}\n\nVale por 15 minutos. Você também vai receber um código por WhatsApp — os dois são necessários para trocar a senha.\n\nNão pediu isso? Ignore este e-mail.`,
        })
      } catch (e) {
        console.error('reset-start: falha no envio do e-mail:', String((e as Error)?.message || e))
      }
      try {
        await sendWhatsAppText(
          r.phone,
          `*VerticalParts* — seu código de recuperação de senha é *${r.whatsapp_code}*.\nVale por 15 minutos. Se não foi você que pediu, ignore esta mensagem.`,
        )
      } catch (e) {
        console.error('reset-start: falha no envio do WhatsApp:', String((e as Error)?.message || e))
      }
    }
    // status 'noop' ou 'locked': não envia nada, mas devolve o mesmo formato de resposta — o
    // challenge_id nunca vai casar com uma linha real, então confirmar código sempre dá "inválido".

    return json({ ok: true, challenge_id: r.challenge_id })
  } catch (err) {
    console.error('reset-start:', String((err as Error)?.message || err))
    return json({ ok: true })
  }
})
