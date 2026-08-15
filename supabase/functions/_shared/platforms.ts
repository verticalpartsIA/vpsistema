import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Plataformas satélites que recebem réplica de conta no convite/exclusão de
// colaborador. Config única compartilhada por invite-user, delete-user e
// provision-module-user — antes duplicada literalmente em cada função.
export const PLATFORMS = [
  {
    name: 'VP Requisições',
    url: Deno.env.get('SB_VPREQUISICAO_URL'),
    key: Deno.env.get('SB_VPREQUISICAO_SERVICE_KEY'),
  },
  {
    name: 'Pós-Venda 360',
    url: Deno.env.get('SB_POSVENDA360_URL'),
    key: Deno.env.get('SB_POSVENDA360_SERVICE_KEY'),
  },
  {
    name: 'Propostas',
    url: Deno.env.get('SB_PROPOSTAS_URL'),
    key: Deno.env.get('SB_PROPOSTAS_SERVICE_KEY'),
  },
  {
    name: 'Visitas e Brindes',
    url: Deno.env.get('SB_VISITAS_URL'),
    key: Deno.env.get('SB_VISITAS_SERVICE_KEY'),
  },
  {
    name: 'VP Catraca',
    url: Deno.env.get('SB_CATRACA_URL'),
    key: Deno.env.get('SB_CATRACA_SERVICE_KEY'),
  },
]

// listUsers() só retorna a primeira página (perPage padrão 1000) — num
// satélite com mais contas que isso, procurar só na 1ª página gera falso
// "not_found" pra usuários reais das páginas seguintes. Pagina até esgotar.
export async function findUserByEmail(
  client: ReturnType<typeof createClient>,
  email?: string | null,
) {
  if (!email) return null
  const perPage = 1000
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (users.length < perPage) return null
  }
}
