// Hook "Send Email" do Supabase Auth. Descarta TODOS os e-mails nativos do Auth.
//
// Por quê: o link mágico / código por e-mail nativo deixa qualquer pessoa com acesso à
// caixa de e-mail de um usuário abrir sessão SEM senha e SEM o código do WhatsApp (2FA).
// O portal não depende de nenhum e-mail nativo: o convite (invite-user) e a recuperação
// de senha (send-recovery-email) mandam os próprios e-mails por SMTP e usam o Admin API
// (generateLink), que não passa por este hook.
//
// Configuração (painel do Supabase): Authentication > Hooks > Send Email > Edge Function
// "auth-email-hook"; o segredo do webhook vai no secret SEND_EMAIL_HOOK_SECRET.
// verify_jwt = false (o Supabase assina a chamada; a assinatura é verificada aqui).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  if (!secret) {
    console.error('auth-email-hook: SEND_EMAIL_HOOK_SECRET não configurado')
    return new Response(JSON.stringify({ error: { http_code: 500, message: 'hook não configurado' } }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.text()
    const wh = new Webhook(secret.replace('v1,whsec_', ''))
    const { email_data } = wh.verify(payload, Object.fromEntries(req.headers)) as {
      email_data?: { email_action_type?: string }
    }

    // Só o tipo da ação (magiclink, recovery, signup...) — nunca o e-mail do usuário.
    const action = String(email_data?.email_action_type ?? 'desconhecido').slice(0, 40)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await admin.from('auth_email_hook_log').insert({ action })

    // Resposta vazia com 200 = "enviado" para o Auth; nada é enviado de fato.
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('auth-email-hook: assinatura inválida ou erro:', String((err as Error)?.message || err))
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'não autorizado' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
})
