// Send Email Hook do Supabase Auth: em vez do GoTrue mandar e-mail nativo (recuperação, convite,
// confirmação) sozinho — inclusive quando disparado direto do painel do Supabase, por fora do
// fluxo de recuperação com 2FA —, ele chama esta função primeiro. Só registra a tentativa em
// auth_email_hook_log e devolve sucesso sem enviar nada. verify_jwt = false (é o GoTrue chamando,
// autenticado pela assinatura própria do hook, não por um JWT do Supabase).
import { verifySendEmailHookSignature } from '../_shared/auth-email-hook-core.ts'
import { adminClient, json } from '../_shared/whatsapp-login.ts'

Deno.serve(async (req) => {
  const rawBody = await req.text()
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''

  const ok = await verifySendEmailHookSignature(
    {
      'webhook-id': req.headers.get('webhook-id'),
      'webhook-timestamp': req.headers.get('webhook-timestamp'),
      'webhook-signature': req.headers.get('webhook-signature'),
    },
    rawBody,
    secret,
  )
  if (!ok) return json({ error: 'assinatura inválida' }, 401)

  let emailType: string | null = null
  let userId: string | null = null
  try {
    const payload = JSON.parse(rawBody)
    emailType = payload?.email_data?.email_action_type ?? null
    userId = payload?.user?.id ?? null
  } catch {
    // Corpo inesperado — ainda assim não manda nada, só não tem o que logar de detalhe.
  }

  try {
    const admin = adminClient()
    await admin.from('auth_email_hook_log').insert({ email_type: emailType, user_id: userId })
  } catch (e) {
    console.error('auth-email-hook: falha ao gravar log:', String((e as Error)?.message || e))
  }

  // Corpo vazio = sucesso para o GoTrue, sem conteúdo de e-mail nenhum — é exatamente o ponto
  // deste hook: o e-mail nativo nunca chega a sair.
  return json({})
})
