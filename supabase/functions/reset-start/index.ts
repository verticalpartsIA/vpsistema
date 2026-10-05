// Recuperação de senha, passo 1: manda DOIS códigos nossos — um por e-mail e outro por
// WhatsApp — e devolve um challenge_id. verify_jwt = false (chamada antes do login).
// A resposta é a mesma exista o e-mail ou não (anti-enumeração); só o limite de pedidos
// responde diferente (429). Quem não tem celular cadastrado não consegue redefinir sozinho.
import nodemailer from 'npm:nodemailer'
import { sendWhatsAppText } from '../_shared/whatsapp.ts'
import { adminClient, clientIp, corsHeaders, json } from '../_shared/whatsapp-login.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function emailHtml(code: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#F2F2F2;font-family:Helvetica Neue,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#000;padding:24px 32px;color:#fff;font-weight:700;letter-spacing:.04em;">VerticalParts</td></tr>
<tr><td style="background:#F5C400;height:4px;font-size:0;line-height:4px;">&nbsp;</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 12px;font-size:24px;color:#000;">Redefinir sua senha</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4A4A4A;">Use este código no portal. Por segurança, você também precisa do código que enviamos por <strong>WhatsApp</strong>.</p>
<p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:.2em;color:#000;">${code}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#808080;">O código vale por 15 minutos. Se você não pediu isso, ignore este e-mail: sua senha continua a mesma.</p>
</td></tr></table></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()
    if (typeof email !== 'string' || !email || email.length > 254) {
      return json({ error: 'Informe um e-mail válido.' }, 400)
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('password_reset_start', { p_email: email, p_ip: clientIp(req) })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data

    if (r?.status === 'locked') {
      return json({ error: 'Muitas solicitações. Aguarde um pouco e tente novamente.' }, 429)
    }

    if (r?.status !== 'ok') {
      // e-mail inexistente / inativo / sem celular: mesma resposta, com tempo parecido
      await sleep(1500 + Math.floor(Math.random() * 1500))
      return json({ success: true, challenge_id: crypto.randomUUID() })
    }

    const smtpPassword = Deno.env.get('SMTP_PASSWORD')
    const sends = await Promise.allSettled([
      (async () => {
        if (!smtpPassword) throw new Error('SMTP_PASSWORD não configurado')
        const transporter = nodemailer.createTransport({
          host: 'smtp.hostinger.com', port: 587, secure: false, requireTLS: true,
          auth: { user: 'suporte@vpsistema.com', pass: smtpPassword },
        })
        await transporter.sendMail({
          from: '"VerticalParts" <suporte@vpsistema.com>',
          to: r.email_to,
          subject: 'Código para redefinir sua senha — VerticalParts',
          text: `Seu código para redefinir a senha é ${r.email_code}. Vale por 15 minutos. Você também precisa do código enviado por WhatsApp. Se não foi você, ignore este e-mail.`,
          html: emailHtml(r.email_code),
        })
      })(),
      sendWhatsAppText(
        r.phone,
        `*VerticalParts* — seu código para redefinir a senha é *${r.wpp_code}*.\nVale por 15 minutos. Você também recebeu um código por e-mail: precisa dos dois. Se não foi você, ignore e avise o administrador.`,
      ),
    ])
    // Nunca loga códigos nem e-mail. Falha de envio não vaza para o cliente.
    sends.forEach((s, i) => {
      if (s.status === 'rejected') console.error(`reset-start: falha no envio (${i === 0 ? 'e-mail' : 'whatsapp'}):`, String(s.reason?.message || s.reason).slice(0, 200))
    })

    return json({ success: true, challenge_id: r.challenge_id })
  } catch (err) {
    console.error('reset-start:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível enviar os códigos agora. Tente novamente.' }, 500)
  }
})
