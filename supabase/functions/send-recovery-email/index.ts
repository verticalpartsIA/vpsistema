// Substituída por reset-start/reset-confirm-email/reset-confirm-whatsapp/reset-complete
// (specs/001-recuperacao-senha-2fa) — a recuperação de senha agora exige confirmação por
// WhatsApp além do e-mail. Esta function fica só como stub, pra qualquer chamador antigo
// descobrir o motivo em vez de um erro genérico.
//
// ATENÇÃO (ordem de publicação, ver plan.md): só fazer o deploy deste stub depois que o
// frontend novo (Login.jsx) já estiver em produção usando reset-start — antes disso, a tela
// atual ainda depende desta function.
import { corsHeaders, json } from '../_shared/whatsapp-login.ts'

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return json({ error: 'Esta função foi substituída por reset-start. Atualize o app.' }, 410)
})
