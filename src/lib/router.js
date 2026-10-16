import { useEffect, useState } from 'react'

// Cada tela do portal tem o seu endereço: o login é a raiz (vpsistema.com) e,
// já dentro, cada tela tem nome próprio (vpsistema.com/inicio, /historico…).
// Roteador mínimo sobre a History API — o site é uma SPA só, sem precisar de
// react-router. O .htaccess (e o `serve -s`) já devolvem o index.html para
// qualquer caminho, então recarregar em /historico funciona.

export const ROUTES = {
  login:     '/',
  dashboard: '/inicio',
  admin:     '/administracao',
  ceo:       '/painel-executivo',
  logs:      '/historico',
  eventos:   '/eventos',
}

// Telas de administração (regras de quem abre cada uma ficam no App.jsx)
export const ADMIN_PATHS = [ROUTES.admin, ROUTES.ceo, ROUTES.logs, ROUTES.eventos]

const KNOWN = Object.values(ROUTES)

// Telas que têm endereço próprio para cada aba (ex.: /eventos/monitor-de-eventos).
// O App só enxerga a tela-base (/eventos); a aba é lida pela própria tela.
const COM_SUBROTAS = [ROUTES.eventos]

const normalizar = (p) => String(p || '').replace(/\/+$/, '').toLowerCase() || '/'

// Caminho → tela-base conhecida ('/' se desconhecido)
export function rotaBase(pathname = window.location.pathname) {
  const p = normalizar(pathname)
  if (KNOWN.includes(p)) return p
  const base = COM_SUBROTAS.find(b => p.startsWith(b + '/'))
  return base || '/'
}

// Partes do endereço depois da tela-base: /eventos/catalogo-de-gatilhos/vphub → ['catalogo-de-gatilhos','vphub']
export function subrota(base, pathname = window.location.pathname) {
  const p = normalizar(pathname)
  if (!p.startsWith(base + '/')) return []
  return p.slice(base.length + 1).split('/').filter(Boolean).map(decodeURIComponent)
}

function currentPath() {
  return rotaBase()
}

// Troca o endereço preservando ?query e #hash (links de convite, ?acesso=…)
export function navigate(path, { replace = false } = {}) {
  if (window.location.pathname === path) return
  const url = path + window.location.search + window.location.hash
  if (replace) window.history.replaceState({}, '', url)
  else         window.history.pushState({}, '', url)
  window.dispatchEvent(new Event('vp:navigate'))
}

export function usePath() {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const sync = () => setPath(currentPath())
    window.addEventListener('popstate', sync)    // botões Voltar/Avançar
    window.addEventListener('vp:navigate', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('vp:navigate', sync)
    }
  }, [])
  return path
}
