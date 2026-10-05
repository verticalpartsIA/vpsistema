// Cria (ou reenvia) o acesso de um colaborador por WhatsApp: garante a conta no
// Auth com o MESMO id do perfil (cadastro simples / placeholder), usando o
// e-mail do perfil ou um e-mail técnico interno, e manda por WhatsApp um link
// de primeiro acesso de uso único. Só administradores. verify_jwt = true.
//
// O e-mail técnico (<55+celular>@wpp.vpsistema.com) nunca recebe mensagem:
// serve só de identidade no Auth/SSO. A senha é aleatória e descartada — o
// acesso do dia a dia é pelo código enviado por WhatsApp.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { normalizePhoneBR, sendWhatsAppText } from '../_shared/whatsapp.ts'
import { adminClient, corsHeaders, json } from '../_shared/whatsapp-login.ts'

const APP_URL = 'https://vpsistema.com'
const LINK_TTL_MS = 48 * 60 * 60 * 1000
const TECH_EMAIL_DOMAIN = 'wpp.vpsistema.com'

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Chamador precisa ser Administrador ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autorizado' }, 401)

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user: caller } } = await supabaseUser.auth.getUser()
    if (!caller) return json({ error: 'Sessão inválida' }, 401)

    const { data: callerProfile } = await supabaseUser.from('profiles').select('level').eq('id', caller.id).single()
    if (callerProfile?.level !== 'Administrador') {
      return json({ error: 'Apenas administradores podem criar acessos.' }, 403)
    }

    const { profile_id } = await req.json()
    if (!profile_id) return json({ error: 'profile_id obrigatório' }, 400)

    const admin = adminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('id, name, email, celular, department, level, is_active')
      .eq('id', profile_id)
      .maybeSingle()
    if (!profile) return json({ error: 'Perfil não encontrado.' }, 404)
    if (profile.is_active === false) return json({ error: 'O colaborador está inativo. Reative antes de criar o acesso.' }, 400)

    const phone = normalizePhoneBR(profile.celular)
    if (!phone) return json({ error: 'Cadastre o celular do colaborador (com DDD) antes de criar o acesso.' }, 400)

    // Outro perfil ativo com o mesmo celular e conta no Auth deixaria o login
    // por código ambíguo (a função de login recusa nesse caso). Barra aqui.
    const { data: sameDigits } = await admin
      .from('profiles').select('id, name').eq('celular', phone).eq('is_active', true).neq('id', profile.id)
    for (const other of sameDigits ?? []) {
      const { data: otherAuth } = await admin.auth.admin.getUserById(other.id)
      if (otherAuth?.user) {
        return json({ error: `O celular já está cadastrado em outro colaborador com acesso (${other.name}). Corrija o cadastro antes.` }, 409)
      }
    }

    // ── Conta no Auth (mesmo id do perfil) ──
    const { data: existing } = await admin.auth.admin.getUserById(profile.id)
    let created = false
    if (!existing?.user) {
      const email = profile.email || `55${phone}@${TECH_EMAIL_DOMAIN}`
      const randomPassword = b64url(crypto.getRandomValues(new Uint8Array(24)))
      const { error: createErr } = await admin.auth.admin.createUser({
        id: profile.id,
        email,
        password: randomPassword,
        email_confirm: true,
        user_metadata: { name: profile.name, level: profile.level || 'Colaborador', department: profile.department || null },
      })
      if (createErr) {
        console.error('provision-whatsapp-access: createUser falhou:', createErr.message)
        return json({ error: `Não foi possível criar a conta: ${createErr.message}` }, 400)
      }
      created = true
      // handle_new_user faz upsert do perfil mas não grava o e-mail.
      const { error: profErr } = await admin
        .from('profiles').update({ email, is_placeholder: false }).eq('id', profile.id)
      if (profErr) console.error('provision-whatsapp-access: update profiles falhou:', profErr.message)
    }

    // ── Link de primeiro acesso (invalida os anteriores ainda não usados) ──
    await admin.from('whatsapp_first_access_links')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', profile.id).is('used_at', null)

    const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
    const expiresAt = new Date(Date.now() + LINK_TTL_MS)
    const { error: linkErr } = await admin.from('whatsapp_first_access_links').insert({
      user_id: profile.id,
      token_hash: await sha256Hex(token),
      created_by: caller.id,
      expires_at: expiresAt.toISOString(),
    })
    if (linkErr) return json({ error: 'Conta criada, mas não foi possível gerar o link de acesso.' }, 500)

    const link = `${APP_URL}/?acesso=${token}`
    const firstName = (profile.name || '').trim().split(' ')[0] || 'colaborador(a)'

    let whatsappSent = false
    let whatsappError: string | null = null
    try {
      await sendWhatsAppText(
        phone,
        `Olá, ${firstName}! 👋\n\nSeu acesso ao *Portal VerticalParts* foi liberado.\n\n` +
        `Toque no link para entrar pela primeira vez:\n${link}\n\n` +
        `O link vale por 48 horas e só pode ser usado uma vez. Nos próximos acessos, informe seu celular em ${APP_URL} e digite o código que enviaremos por WhatsApp.`,
      )
      whatsappSent = true
    } catch (e) {
      whatsappError = String((e as Error)?.message || e)
      console.error('provision-whatsapp-access: falha no envio:', whatsappError)
    }

    return json({
      success: true,
      created,
      whatsapp_sent: whatsappSent,
      whatsapp_error: whatsappError,
      expires_at: expiresAt.toISOString(),
      // Só devolve o link se o WhatsApp falhou, pro admin entregar manualmente.
      access_link: whatsappSent ? undefined : link,
    })
  } catch (err) {
    console.error('provision-whatsapp-access:', String((err as Error)?.message || err))
    return json({ error: 'Erro ao criar o acesso. Tente novamente.' }, 500)
  }
})
