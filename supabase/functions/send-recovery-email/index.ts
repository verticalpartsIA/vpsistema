import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'E-mail inválido.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Gera o token de recuperação via Admin API (sem rate limit de e-mail)
    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: 'https://vpsistema.com' },
    })

    if (linkError || !data?.properties?.email_otp) {
      // Retorna sucesso mesmo se o e-mail não existe (evita enumeração de usuários)
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Usa o código OTP em vez de um link clicável.
    // Scanners de e-mail (Microsoft Safe Links / Defender for Office 365) visitam
    // URLs proativamente e consomem tokens de uso único antes do usuário clicar.
    // Um código numérico não pode ser "clicado" por scanner — só o usuário digita.
    const otpCode = data.properties.email_otp

    const smtpPassword = Deno.env.get('SMTP_PASSWORD')
    if (!smtpPassword) {
      throw new Error('SMTP_PASSWORD não configurado nos secrets da Edge Function.')
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.hostinger.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: 'suporte@vpsistema.com',
        pass: smtpPassword,
      },
    })

    await transporter.sendMail({
      from: '"VerticalParts" <suporte@vpsistema.com>',
      to: email,
      subject: 'Código de recuperação de senha — VerticalParts',
      text: `Seu código de recuperação: ${otpCode}\n\nDigite este código em vpsistema.com para criar uma nova senha.\nO código é válido por 1 hora.`,
      html: buildRecoveryEmailHtml(otpCode),
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('send-recovery-email error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function buildRecoveryEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Código de recuperação</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f5">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td bgcolor="#111111" align="center" style="padding:32px 40px;">
          <img src="https://ubdkoqxfwcraftesgmbw.supabase.co/storage/v1/object/public/avatars/brand/logo-white.png"
               alt="VerticalParts" height="36" style="display:block;height:36px;">
        </td>
      </tr>

      <!-- Faixa amarela -->
      <tr><td bgcolor="#F5C400" style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- Corpo -->
      <tr>
        <td bgcolor="#ffffff" style="padding:48px 40px 40px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#F5C400;">
            &#8212;&nbsp; Recuperar Acesso
          </p>
          <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#111111;line-height:1.2;">
            Código de recuperação
          </h1>
          <p style="margin:0 0 32px;font-size:15px;color:#555555;line-height:1.6;">
            Recebemos uma solicitação para redefinir a senha da sua conta no Portal VerticalParts.<br>
            Digite o código abaixo no site para criar uma nova senha.
          </p>

          <!-- Código OTP em destaque -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td align="center" bgcolor="#f8f8f8" style="border-radius:12px;border:2px solid #F5C400;padding:28px 20px;">
                <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999999;">
                  Seu c&oacute;digo
                </p>
                <p style="margin:0;font-size:42px;font-weight:800;letter-spacing:0.25em;color:#111111;font-family:'Courier New',monospace;">
                  ${code}
                </p>
                <p style="margin:12px 0 0;font-size:12px;color:#999999;">
                  V&aacute;lido por 1 hora &bull; Use apenas uma vez
                </p>
              </td>
            </tr>
          </table>

          <!-- Instruções -->
          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;width:100%;">
            <tr>
              <td bgcolor="#FFF6CC" style="border-left:4px solid #F5C400;border-radius:4px;padding:14px 18px;">
                <p style="margin:0;font-size:13px;color:#7a6200;line-height:1.6;">
                  <strong>Como usar:</strong> Acesse <a href="https://vpsistema.com" style="color:#7a6200;">vpsistema.com</a>,
                  clique em <em>&ldquo;Esqueceu a senha?&rdquo;</em>, informe seu e-mail e clique em
                  <em>&ldquo;Enviar&rdquo;</em>. Em seguida, digite este c&oacute;digo no campo que aparecer.
                </p>
              </td>
            </tr>
          </table>

          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;width:100%;">
            <tr>
              <td bgcolor="#f8f8f8" style="border-left:4px solid #dddddd;border-radius:4px;padding:14px 18px;">
                <p style="margin:0;font-size:13px;color:#888888;">
                  <strong>N&atilde;o solicitou isso?</strong> Ignore este e-mail. Sua senha permanece a mesma.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td bgcolor="#111111" style="padding:24px 40px;" align="center">
          <a href="https://vpsistema.com" style="text-decoration:none;">
            <img src="https://ubdkoqxfwcraftesgmbw.supabase.co/storage/v1/object/public/avatars/brand/logo-white.png"
                 alt="VerticalParts" height="24" style="display:block;height:24px;margin:0 auto 12px;">
          </a>
          <p style="margin:0;font-size:12px;color:#666666;">
            &copy; 2026 VerticalParts &mdash;
            <a href="mailto:suporte@vpsistema.com" style="color:#F5C400;text-decoration:none;">suporte@vpsistema.com</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}
