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

function currentPath() {
  const p = window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/'
  return KNOWN.includes(p) ? p : '/'
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
