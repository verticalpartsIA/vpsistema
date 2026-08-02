// Config central dos apps satélites que recebem SSO do vpsistema.
// Usado por sso-proxy (SSO no clique do usuário) e provision-module-user
// (provisionamento automático de usuário nos apps com Auth próprio).
//
// A chave do mapa é o PRIMEIRO RÓTULO DO HOSTNAME do módulo (ex.: "posvenda360"
// de https://posvenda360.vpsistema.com) — é o que o Dashboard envia como
// targetApp. O campo `moduleSlug` amarra a entrada ao slug da tabela `modules`,
// que nem sempre é igual ao hostname (click ≠ vpclick,
// vpposvenda360 ≠ posvenda360, cotacao-importacao ≠ vpgestaoimportacao).
export type MagicLinkApp = {
  ssoType: 'magiclink'
  moduleSlug: string
  url: string
  serviceKeyEnv: string
  redirectTo: string
}

export type TokenApp = {
  ssoType: 'token'
  moduleSlug: string
  redirectTo: string
}

// App que roda no MESMO projeto Supabase do vpsistema (ex.: Gente & Gestão).
// Não precisa de service key nem de provisionamento — o access_token e o
// refresh_token da sessão atual já são válidos lá, porque é o mesmo servidor
// de auth. O sso-proxy repassa os dois como ?sso_token=&sso_refresh=.
export type SameProjectApp = {
  ssoType: 'sameproject'
  moduleSlug: string
  redirectTo: string
}

export type AppConfig = MagicLinkApp | TokenApp | SameProjectApp

export const APPS: Record<string, AppConfig> = {
  // Apps com Supabase Auth próprio → magic link (precisam de usuário provisionado)
  vprequisicoes: {
    ssoType: 'magiclink',
    moduleSlug: 'vprequisicoes',
    url: 'https://vvgcrhtmzvssfdazkkzk.supabase.co',
    serviceKeyEnv: 'VPREQ_SERVICE_KEY',
    redirectTo: 'https://vprequisicoes.vpsistema.com',
  },
  posvenda360: {
    ssoType: 'magiclink',
    moduleSlug: 'vpposvenda360',
    url: 'https://jkbklzlbhhfnamaeislb.supabase.co',
    serviceKeyEnv: 'PV360_SERVICE_KEY',
    redirectTo: 'https://posvenda360.vpsistema.com',
  },
  visitas: {
    ssoType: 'magiclink',
    moduleSlug: 'visitas',
    url: 'https://bvvnoapdclxhuygptbza.supabase.co',
    serviceKeyEnv: 'VISITAS_SERVICE_KEY',
    redirectTo: 'https://visitas.vpsistema.com',
  },
  // Apps que validam o JWT do vpsistema via ?sso_token= — não precisam de
  // usuário provisionado à parte, então provision-module-user ignora estes.
  vpclick: {
    ssoType: 'token',
    moduleSlug: 'click',
    redirectTo: 'https://vpclick.vpsistema.com',
  },
  catraca: {
    ssoType: 'token',
    moduleSlug: 'catraca',
    redirectTo: 'https://catraca.vpsistema.com',
  },
  propostas: {
    ssoType: 'token',
    moduleSlug: 'propostas',
    redirectTo: 'https://propostas.vpsistema.com',
  },
  vpgestaoimportacao: {
    ssoType: 'token',
    moduleSlug: 'cotacao-importacao',
    redirectTo: 'https://vpgestaoimportacao.vpsistema.com',
  },
  // Engenharia e Suporte faltavam no mapa: sem entrada aqui o sso-proxy
  // respondia "Unknown app" (400) e o Dashboard caía no fallback de abrir a
  // URL crua — o subsistema não recebia sessão nenhuma e devolvia o usuário
  // para a própria tela de login (o "dá reload" relatado pelos colaboradores).
  engenharia: {
    ssoType: 'token',
    moduleSlug: 'engenharia',
    redirectTo: 'https://engenharia.vpsistema.com',
  },
  suporte: {
    ssoType: 'token',
    moduleSlug: 'suporte',
    redirectTo: 'https://suporte.vpsistema.com',
  },
  // Gente & Gestão (RH/DP): app novo que usa o MESMO projeto Supabase do
  // vpsistema — mesma tabela profiles, mesmo auth.users. Não é magiclink
  // (não precisa criar/provisionar usuário em outro projeto) nem token puro
  // (o app tem Supabase Auth próprio e precisa de uma sessão real, não só do
  // JWT pra validar server-side) — por isso o tipo 'sameproject'.
  gentegestao: {
    ssoType: 'sameproject',
    moduleSlug: 'gente-gestao',
    redirectTo: 'https://gentegestao.vpsistema.com/dashboard',
  },
}

/** Config do app satélite a partir do slug da tabela `modules`. */
export function appForModuleSlug(moduleSlug: string): AppConfig | undefined {
  return Object.values(APPS).find((a) => a.moduleSlug === moduleSlug)
}
