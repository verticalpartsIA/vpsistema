// Passo 1 do login por código: recebe o celular e manda um código numérico
// por WhatsApp. Chamada ANTES do login → deploy com verify_jwt = false.
//
// O código é o email_otp de um magiclink do GoTrue (uso único, validado por
// ele); a tabela whatsapp_login_attempts só controla rate limit e a janela de
// 5 minutos. A resposta é sempre { success: true } para número válido, exista
// ele ou não, para ninguém descobrir quem é colaborador.
import { normalizePhoneBR, sendWhatsAppText } from '../_shared/whatsapp.ts'
import {
  MAX_SENDS_PER_IP_HOUR, MAX_SENDS_PER_PHONE_HOUR,
  adminClient, clientIp, corsHeaders, findLoginUser, json,
} from '../_shared/whatsapp-login.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone: rawPhone } = await req.json()
    const phone = normalizePhoneBR(rawPhone)
    if (!phone) return json({ error: 'Informe o celular com DDD.' }, 400)

    const admin = adminClient()
    const ip = clientIp(req)

    // Rate limit atômico: a checagem e a reserva da vaga acontecem na mesma
    // transação do banco (advisory lock), antes de gerar/enviar o código —
    // requisições concorrentes não furam o limite. A vaga é reservada para
    // QUALQUER número válido (existindo ou não), senão o 429 revelaria quais
    // números são de colaboradores.
    const { data: reserved, error: reserveErr } = await admin.rpc('whatsapp_login_reserve_send', {
      p_phone: phone,
      p_ip: ip,
      p_max_phone: MAX_SENDS_PER_PHONE_HOUR,
      p_max_ip: MAX_SENDS_PER_IP_HOUR,
    })
    if (reserveErr) throw reserveErr
    if (!reserved) {
      return json({ error: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' }, 429)
    }

    const user = await findLoginUser(admin, phone)
    if (!user) return json({ success: true })

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    })
    const code = link?.properties?.email_otp
    if (linkErr || !code) {
      console.error('whatsapp-login-request: generateLink falhou:', linkErr?.message || 'email_otp ausente')
      return json({ success: true })
    }

    try {
      await sendWhatsAppText(
        phone,
        `*VerticalParts* — seu código de acesso é *${code}*.\nVale por 5 minutos. Não compartilhe com ninguém.`,
      )
    } catch (e) {
      // Nunca loga o código. Falha de envio não vaza pro cliente (anti-enumeração),
      // mas fica no log pra diagnóstico.
      console.error('whatsapp-login-request: falha no envio:', String((e as Error)?.message || e))
    }

    return json({ success: true })
  } catch (err) {
    console.error('whatsapp-login-request:', String((err as Error)?.message || err))
    return json({ error: 'Não foi possível enviar o código. Tente novamente.' }, 500)
  }
})
