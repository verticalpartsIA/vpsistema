// Login só por celular (código no WhatsApp, sem senha) DESLIGADO até existir o
// 2FA (e-mail + senha + código). O servidor também bloqueia: tabela
// public.whatsapp_login_config (phone_login_enabled) — ligar os dois juntos.
export const PHONE_LOGIN_ENABLED = false
