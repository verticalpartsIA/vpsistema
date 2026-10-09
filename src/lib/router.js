import { useEffect, useState } from 'react'

// Cada tela do portal tem o seu endereço (vpsistema.com/dashboard, /admin…).
// Roteador mínimo sobre a History API — o site é uma SPA só, sem precisar de
// react-router. O .htaccess (e o `serve -s`) já devolvem o index.html para
// qualquer caminho, então recarregar em /logs funciona.

export const ROUTES = {
  login:     '/login',
  dashboard: '/dashboard',
  admin:     '/admin',
  ceo:       '/ceo',
  logs:      '/logs',
}

// Telas que só o Administrador abre
export const ADMIN_PATHS = [ROUTES.admin, ROUTES.ceo, ROUTES.logs]

const KNOWN = Object.values(ROUTES)

function currentPath() {
  const p = window.location.pathname.replace(/\/+$/, '').toLowerCase()
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
