// Detecção de deploy novo em abas que já estão abertas.
//
// O cache do portal já está correto: os assets levam hash no nome e o
// index.html vai com `no-store` (ver public/.htaccess), então qualquer
// carregamento novo — F5 comum, abrir o site, voltar depois — já baixa a
// versão nova. Ninguém precisa de Ctrl+Shift+R.
//
// O que nenhum header resolve é a aba que ficou aberta desde antes do deploy:
// aquele JS já está na memória e continua rodando o código antigo até alguém
// recarregar. É esse caso que este watcher cobre — compara o bundle que está
// rodando com o que o servidor está anunciando no index.html.

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000

/** Caminho do bundle carregado nesta aba (ex.: "assets/index-cObLaZ0y.js"). */
function runningBundle() {
  try {
    // O build é ESM, então import.meta.url aponta para o próprio bundle.
    return new URL(import.meta.url).pathname.split('/').pop() || null
  } catch {
    return null
  }
}

/** Bundle que o servidor está entregando agora, lido do index.html. */
async function deployedBundle() {
  // Cache-busting na URL além do no-store: proxies corporativos e o cache do
  // Service Worker de alguns navegadores ignoram o header.
  const res = await fetch(`/index.html?_v=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  const html = await res.text()
  return html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] || null
}

/**
 * Chama `onNewVersion()` uma única vez, quando o servidor passar a anunciar um
 * bundle diferente do que está rodando nesta aba.
 *
 * Verifica a cada `intervalMs` e também quando o colaborador volta para a aba,
 * que é o momento em que a desatualização costuma aparecer (deixou o portal
 * aberto, foi almoçar, voltou).
 *
 * Retorna a função para encerrar o watcher.
 */
export function watchForNewVersion(onNewVersion, { intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const running = runningBundle()
  // Em dev (sem bundle hasheado) não há o que comparar.
  if (!running || !running.includes('-')) return () => {}

  let stopped = false

  async function check() {
    if (stopped || document.visibilityState !== 'visible') return
    try {
      const deployed = await deployedBundle()
      if (!stopped && deployed && deployed !== running) {
        stopped = true
        onNewVersion()
      }
    } catch {
      // Offline ou servidor fora do ar: tenta de novo no próximo ciclo.
    }
  }

  const timer = setInterval(check, intervalMs)
  document.addEventListener('visibilitychange', check)

  return () => {
    stopped = true
    clearInterval(timer)
    document.removeEventListener('visibilitychange', check)
  }
}
