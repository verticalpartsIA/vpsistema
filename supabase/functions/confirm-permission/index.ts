import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Endpoint de confirmação usado pelos apps satélites (hoje, o VP Click) para
// validar um aviso de provisionamento: dado um user_id + module_slug, responde
// com autoridade se a permissão existe AGORA no vpsistema e devolve os dados
// básicos do perfil para o satélite criar/atualizar o usuário local.
//
// Sem verify_jwt: o chamador é outra edge function (sem JWT de usuário).
// A resposta só reflete o que já está gravado no banco do vpsistema, então
// um chamador forjado não consegue "inventar" permissão — no máximo consulta
// o estado real, que é exatamente o que o satélite deve espelhar. user_ids
// são UUIDs não enumeráveis.
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  try {
    const { user_id: userId, module_slug: moduleSlug } = await req.json()
    if (!userId || !moduleSlug) {
      return json({ error: 'user_id e module_slug são obrigatórios' }, 400)
    }

    const vpsistema = createClient(
      'https://ubdkoqxfwcraftesgmbw.supabase.co',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: profile, error: profileErr } = await vpsistema
      .from('profiles')
      .select('email, name, avatar_url, level, department, is_active')
      .eq('id', userId)
      .maybeSingle()
    if (profileErr || !profile?.email) return json({ error: 'Perfil não encontrado' }, 404)

    const { data: perm } = await vpsistema
      .from('module_permissions')
      .select('user_id')
      .eq('user_id', userId)
      .eq('module_slug', moduleSlug)
      .maybeSingle()

    return json({
      has_permission: !!perm && profile.is_active !== false,
      profile: {
        email: profile.email,
        name: profile.name,
        avatar_url: profile.avatar_url,
        level: profile.level,
        department: profile.department,
      },
    })
  } catch (err) {
    console.error('confirm-permission error:', err)
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
