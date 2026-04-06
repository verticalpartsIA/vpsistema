import { supabase } from './supabase'

/**
 * Registra um evento no activity_logs.
 * Fire-and-forget: nunca bloqueia a UI.
 *
 * @param {object} opts
 * @param {string} opts.action   - 'login' | 'logout' | 'module_access' | 'invite_user' |
 *                                 'change_permissions' | 'admin_access' | 'ceo_access' | 'log_access'
 * @param {string} [opts.target] - módulo acessado, e-mail convidado, etc.
 * @param {object} [opts.details]- dados extras (jsonb)
 */
export async function logActivity({ action, target = null, details = null }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    const { data: prof } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', session.user.id)
      .single()

    await supabase.from('activity_logs').insert({
      user_id:    session.user.id,
      user_name:  prof?.name  || session.user.email,
      user_email: prof?.email || session.user.email,
      action,
      target,
      details,
    })
  } catch (_) {
    // silencioso — log nunca deve quebrar a UI
  }
}
