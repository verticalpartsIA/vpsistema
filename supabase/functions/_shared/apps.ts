// Config central dos apps satélites que recebem SSO do vpsistema.
// Usado por sso-proxy (SSO no clique do usuário) e provision-module-user
// (provisionamento automático assim que um admin concede module_permissions).
export type MagicLinkApp = {
  ssoType: 'magiclink'
  url: string
  serviceKeyEnv: string
  redirectTo: string
}

export type TokenApp = {
  ssoType: 'token'
  redirectTo: string
}

export type AppConfig = MagicLinkApp | TokenApp

export const APPS: Record<string, AppConfig> = {
  // Apps com Supabase Auth próprio → magic link (precisam de usuário provisionado)
  vprequisicoes: {
    ssoType: 'magiclink',
    url: 'https://vvgcrhtmzvssfdazkkzk.supabase.co',
    serviceKeyEnv: 'VPREQ_SERVICE_KEY',
    redirectTo: 'https://vprequisicoes.vpsistema.com',
  },
  posvenda360: {
    ssoType: 'magiclink',
    url: 'https://jkbklzlbhhfnamaeislb.supabase.co',
    serviceKeyEnv: 'PV360_SERVICE_KEY',
    redirectTo: 'https://posvenda360.vpsistema.com',
  },
  visitas: {
    ssoType: 'magiclink',
    url: 'https://bvvnoapdclxhuygptbza.supabase.co',
    serviceKeyEnv: 'VISITAS_SERVICE_KEY',
    redirectTo: 'https://visitas.vpsistema.com',
  },
  // Apps que validam o JWT do vpsistema via ?sso_token= — não precisam de
  // usuário provisionado à parte, então provision-module-user ignora estes.
  vpclick: {
    ssoType: 'token',
    redirectTo: 'https://vpclick.vpsistema.com',
  },
  catraca: {
    ssoType: 'token',
    redirectTo: 'https://catraca.vpsistema.com',
  },
  propostas: {
    ssoType: 'token',
    redirectTo: 'https://propostas.vpsistema.com',
  },
  vpprd: {
    ssoType: 'token',
    redirectTo: 'https://vpprd.vpsistema.com',
  },
}
