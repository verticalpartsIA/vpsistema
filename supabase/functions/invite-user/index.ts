import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Plataformas que receberão o novo usuário automaticamente
// As chaves são configuradas como secrets no painel Supabase → Edge Functions → Secrets
const PLATFORMS = [
  {
    name: 'VP Requisições',
    url:  Deno.env.get('SB_VPREQUISICAO_URL'),
    key:  Deno.env.get('SB_VPREQUISICAO_SERVICE_KEY'),
  },
  {
    name: 'Pós-Venda 360',
    url:  Deno.env.get('SB_POSVENDA360_URL'),
    key:  Deno.env.get('SB_POSVENDA360_SERVICE_KEY'),
  },
  {
    name: 'Propostas',
    url:  Deno.env.get('SB_PROPOSTAS_URL'),
    key:  Deno.env.get('SB_PROPOSTAS_SERVICE_KEY'),
  },
  {
    name: 'Visitas e Brindes',
    url:  Deno.env.get('SB_VISITAS_URL'),
    key:  Deno.env.get('SB_VISITAS_SERVICE_KEY'),
  },
  {
    name: 'VP Catraca',
    url:  Deno.env.get('SB_CATRACA_URL'),
    key:  Deno.env.get('SB_CATRACA_SERVICE_KEY'),
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Verifica autenticação ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Confirma que o chamador é Administrador ──
    const { data: profile } = await supabaseUser
      .from('profiles')
      .select('level')
      .eq('id', user.id)
      .single()

    if (profile?.level !== 'Administrador') {
      return new Response(JSON.stringify({ error: 'Apenas administradores podem convidar.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { email, name, level, department, is_department_lead, password, avatar_url, resend } = await req.json()

    if (!password || password.length < 6) {
      return new Response(JSON.stringify({ error: 'A senha temporária deve ter pelo menos 6 caracteres.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Admin client do vpsistema (plataforma principal) ──
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 0. Se existir um profile órfão com este e-mail — auth.users apagado
    // direto no painel do Supabase (ou por uma exclusão anterior que não
    // limpou o profile), sem passar pelo delete-user — remove antes de
    // criar. Sem isso, a unique constraint em profiles.email trava a
    // criação do novo usuário pra sempre (caso Vinicius Leite).
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    if (existingProfile?.id) {
      const { data: authLookup, error: authLookupErr } = await supabaseAdmin.auth.admin.getUserById(existingProfile.id)
      // getUserById responde com ERRO (404 "User not found") quando o id não
      // existe no Auth — não é só "data.user null" sem erro. Tratar qualquer
      // erro como inconclusivo (como na 1ª versão) nunca deleta o órfão, que
      // é exatamente o caso mais comum aqui. Só ficamos conservadores diante
      // de um erro que não seja "não encontrado" (ex.: falha de rede).
      const notFound = !authLookup?.user && (!authLookupErr || /not.*found/i.test(authLookupErr.message || ''))
      if (notFound) {
        await supabaseAdmin.from('profiles').delete().eq('id', existingProfile.id)
      }
    }

    // 1. Cria o usuário no vpsistema com senha definida pelo admin
    let mainUser = null
    const { data: mainData, error: mainError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, level: level || 'Colaborador', department: department || null }
    })

    if (mainError) {
      const alreadyExists = /already.*registered|already.*exists/i.test(mainError.message)

      // "Reenviar credenciais": usuário já existe (convite anterior sem e-mail).
      // Atualiza a senha para a nova temporária e segue para o envio do e-mail.
      if (alreadyExists && resend) {
        const { data: existing } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .ilike('email', email)
          .single()

        if (!existing?.id) {
          return new Response(JSON.stringify({ error: 'Usuário já existe no Auth mas não foi encontrado em profiles — verifique manualmente.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { data: updated, error: updError } = await supabaseAdmin.auth.admin.updateUserById(
          existing.id, { password }
        )
        if (updError) {
          return new Response(JSON.stringify({ error: `Falha ao redefinir a senha: ${updError.message}` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        mainUser = updated.user
      } else if (alreadyExists) {
        return new Response(JSON.stringify({ error: mainError.message, already_exists: true }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } else {
        // mainError.message pode vir undefined dependendo do formato do erro
        // devolvido pelo GoTrue — nesse caso JSON.stringify({ error: undefined })
        // gera o corpo "{}" e o admin não vê nada útil. Sempre manda algo legível.
        return new Response(JSON.stringify({ error: mainError.message || JSON.stringify(mainError) || 'Erro desconhecido ao criar usuário.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      mainUser = mainData.user
    }

    // 1b. Salva avatar_url no profile (service role bypassa RLS)
    if (avatar_url && mainUser?.id) {
      await supabaseAdmin
        .from('profiles')
        .update({ avatar_url })
        .eq('id', mainUser.id)
    }

    // 1c. Marca líder de departamento (handle_new_user não lê isso da
    // metadata — só existe via update explícito). Dispara o trigger
    // auto_assign_manager_id, que posiciona a pessoa no organograma do
    // GenteGestão automaticamente.
    if (is_department_lead && mainUser?.id) {
      await supabaseAdmin
        .from('profiles')
        .update({ is_department_lead: true })
        .eq('id', mainUser.id)
    }

    // 2. Replica o usuário em todas as outras plataformas
    const platformResults: { platform: string; status: string; error?: string }[] = []

    for (const platform of PLATFORMS) {
      if (!platform.url || !platform.key) {
        platformResults.push({ platform: platform.name, status: 'skipped' })
        continue
      }

      try {
        const adminClient = createClient(platform.url, platform.key)
        const { error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name, department: department || null }
        })
        const exists = error && /already.*registered|already.*exists/i.test(error.message)
        platformResults.push({
          platform: platform.name,
          status: error ? (exists ? 'exists' : 'error') : 'ok',
          error: exists ? undefined : error?.message
        })
      } catch (e) {
        platformResults.push({ platform: platform.name, status: 'error', error: String(e) })
      }
    }

    // 3. Envia o e-mail de boas-vindas com as credenciais.
    //    Mesma via SMTP do send-recovery-email (Hostinger + nodemailer) — o
    //    e-mail nativo do Supabase Auth nunca é acionado por admin.createUser,
    //    então sem este passo o colaborador simplesmente não fica sabendo.
    //    Falha aqui NÃO desfaz a criação: é reportada ao admin na resposta.
    let emailSent = false
    let emailError: string | null = null
    try {
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
        subject: 'Bem-vindo(a) ao Portal VerticalParts — seus dados de acesso',
        text: `Olá, ${name || ''}!\n\nSua conta no Portal VerticalParts foi criada.\n\nAcesse: https://vpsistema.com\nE-mail: ${email}\nSenha temporária: ${password}\n\nRecomendamos trocar a senha no primeiro acesso usando a opção "Esqueceu a senha?".`,
        html: buildWelcomeEmailHtml(name || '', email, password),
      })
      emailSent = true
    } catch (e) {
      emailError = String(e?.message || e)
      console.error('invite-user: falha ao enviar e-mail de boas-vindas:', emailError)
    }

    return new Response(JSON.stringify({
      user: mainUser,
      platforms: platformResults,
      email_sent: emailSent,
      email_error: emailError,
      resent: Boolean(resend),
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function buildWelcomeEmailHtml(name: string, email: string, password: string): string {
  const firstName = (name || '').trim().split(' ')[0] || 'colaborador(a)'
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Bem-vindo(a) ao Portal VerticalParts</title>
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
            &#8212;&nbsp; Bem-vindo(a)
          </p>
          <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#111111;line-height:1.2;">
            Ol&aacute;, ${firstName}!
          </h1>
          <p style="margin:0 0 32px;font-size:15px;color:#555555;line-height:1.6;">
            Sua conta no <strong>Portal VerticalParts</strong> foi criada.<br>
            Use os dados abaixo para fazer seu primeiro acesso.
          </p>

          <!-- Credenciais em destaque -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td align="center" bgcolor="#f8f8f8" style="border-radius:12px;border:2px solid #F5C400;padding:28px 20px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999999;">
                  Acesse
                </p>
                <p style="margin:0 0 16px;font-size:20px;font-weight:800;color:#111111;">
                  <a href="https://vpsistema.com" style="color:#111111;text-decoration:none;">vpsistema.com</a>
                </p>
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999999;">
                  E-mail
                </p>
                <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#111111;font-family:'Courier New',monospace;">
                  ${email}
                </p>
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999999;">
                  Senha tempor&aacute;ria
                </p>
                <p style="margin:0;font-size:24px;font-weight:800;letter-spacing:0.08em;color:#111111;font-family:'Courier New',monospace;">
                  ${password}
                </p>
              </td>
            </tr>
          </table>

          <!-- Instruções -->
          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;width:100%;">
            <tr>
              <td bgcolor="#FFF6CC" style="border-left:4px solid #F5C400;border-radius:4px;padding:14px 18px;">
                <p style="margin:0;font-size:13px;color:#7a6200;line-height:1.6;">
                  <strong>Recomendado:</strong> troque esta senha tempor&aacute;ria no primeiro acesso.
                  Em <a href="https://vpsistema.com" style="color:#7a6200;">vpsistema.com</a>, clique em
                  <em>&ldquo;Esqueceu a senha?&rdquo;</em>, informe seu e-mail e siga as instru&ccedil;&otilde;es
                  para definir uma senha s&oacute; sua.
                </p>
              </td>
            </tr>
          </table>

          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;width:100%;">
            <tr>
              <td bgcolor="#f8f8f8" style="border-left:4px solid #dddddd;border-radius:4px;padding:14px 18px;">
                <p style="margin:0;font-size:13px;color:#888888;">
                  <strong>N&atilde;o esperava este e-mail?</strong> Fale com o administrador do portal em
                  <a href="mailto:suporte@vpsistema.com" style="color:#888888;">suporte@vpsistema.com</a>.
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
