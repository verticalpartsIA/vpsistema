import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Login        from './pages/Login'
import Dashboard    from './pages/Dashboard'
import Admin        from './pages/Admin'
import CeoDashboard from './pages/CeoDashboard'
import ActivityLog  from './pages/ActivityLog'
import Eventos      from './pages/Eventos'
import { logActivity } from './lib/activityLog'
import { watchForNewVersion } from './lib/versionWatch'
import UpdateToast from './components/UpdateToast'
import { ROUTES, ADMIN_PATHS, navigate, usePath } from './lib/router'
import { Loader2 } from 'lucide-react'

// Marca de "esta aba já esteve logada" — só um booleano, some ao fechar a aba.
// Serve para explicar a volta ao login; a sessão em si continua sem persistir.
const SESSION_FLAG = 'vp_sessao_ativa'

function App() {
  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const path = usePath() // '/' (login) | '/inicio' | '/administracao' | '/painel-executivo' | '/historico' | '/eventos'
  // Nível do perfil (undefined = carregando). Só o Administrador abre /administracao, /painel-executivo e /historico.
  const [level,      setLevel]      = useState(undefined)
  const [isRecovery, setIsRecovery] = useState(false)
  const [linkExpired, setLinkExpired] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  // Sessão caiu sem a pessoa ter clicado em "Sair" (refresh de token falhou,
  // rede oscilou, aba ficou suspensa). A sessão não é persistida por decisão
  // de segurança, então não dá para recuperá-la — mas dá para explicar.
  const [sessionLost, setSessionLost] = useState(false)
  const signingOutRef = useRef(false)
  // Alguém digitou algo nesta aba? Se sim, recarregar sozinho jogaria fora um
  // convite ou uma edição em andamento.
  const typedRef = useRef(false)
  // Guarda o id do usuário já logado — o SIGNED_IN do Supabase dispara de novo
  // (troca de aba, foco na janela, refresh de token) sem ser um login real.
  const loggedUserIdRef = useRef(null)
  // Tela que a pessoa tentou abrir antes de fazer login (ex.: abriu /historico
  // sem sessão) — depois do login ela cai direto lá, não no Início.
  const nextPathRef = useRef(null)

  useEffect(() => {
    const hash = window.location.hash

    // Hash com erro de token expirado (fluxo implicit legado)
    if (hash.includes('error_code=otp_expired') || hash.includes('error=access_denied')) {
      window.history.replaceState({}, '', window.location.pathname)
      setLinkExpired(true)
      setLoading(false)
      return
    }
    if (hash.includes('type=invite') || hash.includes('type=recovery')) {
      setIsRecovery(true)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      loggedUserIdRef.current = session?.user?.id ?? null
      // Esta aba já teve sessão e agora não tem mais (recarregou, ou o refresh
      // falhou antes do reload). Não é defeito: a sessão vive só em memória por
      // decisão de segurança. A marca é um booleano por aba, nunca o token.
      if (!session?.user && sessionStorage.getItem(SESSION_FLAG)) {
        setSessionLost(true)
        sessionStorage.removeItem(SESSION_FLAG)
      }
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
        setUser(session?.user ?? null)
        return
      }
      if (event === 'SIGNED_IN') {
        const uid = session?.user?.id ?? null
        if (uid && uid !== loggedUserIdRef.current) {
          logActivity({ action: 'login' })
        }
        loggedUserIdRef.current = uid
        setSessionLost(false)
        if (uid) sessionStorage.setItem(SESSION_FLAG, '1')
      }
      if (event === 'SIGNED_OUT') {
        logActivity({ action: 'logout' })
        // Estava logado e não foi ele quem pediu para sair → a sessão caiu.
        if (loggedUserIdRef.current && !signingOutRef.current) setSessionLost(true)
        signingOutRef.current = false
        sessionStorage.removeItem(SESSION_FLAG)
        loggedUserIdRef.current = null
      }
      setUser(session?.user ?? null)
      if (!session?.user) {
        setIsRecovery(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Deploy novo enquanto a aba estava aberta: troca o app sem ninguém precisar
  // ser avisado por e-mail para dar Ctrl+Shift+R.
  useEffect(() => {
    const markTyped = () => { typedRef.current = true }
    document.addEventListener('input', markTyped, true)

    const stop = watchForNewVersion(() => {
      if (typedRef.current) setUpdateReady(true)  // tem formulário em uso: pergunta
      else window.location.reload()               // só navegação: troca na hora
    })

    return () => {
      stop()
      document.removeEventListener('input', markTyped, true)
    }
  }, [])

  // Nível do perfil, para liberar (ou não) as telas de administrador
  useEffect(() => {
    if (!user) { setLevel(undefined); return }
    let cancelled = false
    supabase.from('profiles').select('level').eq('id', user.id).single()
      .then(({ data }) => { if (!cancelled) setLevel(data?.level ?? null) })
    return () => { cancelled = true }
  }, [user])

  // Para onde o endereço atual deve levar. null = ainda não dá para decidir
  // (carregando) ou fluxo de convite/link expirado, que não mexe no endereço.
  function resolvePath() {
    if (loading || linkExpired || isRecovery) return null
    if (!user) return ROUTES.login          // login é a raiz: vpsistema.com
    if (path === ROUTES.login) return nextPathRef.current || ROUTES.dashboard
    if (ADMIN_PATHS.includes(path)) {
      if (level === undefined) return null
      if (level !== 'Administrador') return ROUTES.dashboard
    }
    return path
  }
  const target = resolvePath()

  // Corrige o endereço na barra (sem criar entrada nova no histórico)
  useEffect(() => {
    if (!target) return
    if (!user && path !== ROUTES.login) nextPathRef.current = path
    if (user) nextPathRef.current = null
    // compara com a barra real: /qualquer (desconhecido) ou /inicio/ também são corrigidos
    if (target !== window.location.pathname) navigate(target, { replace: true })
  }, [target, path, user])

  // Auditoria: registra a entrada nas telas de administrador, inclusive
  // quando a pessoa abre o endereço direto (favorito, link colado).
  useEffect(() => {
    if (target === ROUTES.admin) logActivity({ action: 'admin_access' })
    if (target === ROUTES.ceo)   logActivity({ action: 'ceo_access' })
    if (target === ROUTES.logs)  logActivity({ action: 'log_access' })
    if (target === ROUTES.eventos) logActivity({ action: 'eventos_access' })
  }, [target])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    )
  }

  return (
    <>
      {renderView()}
      {updateReady && <UpdateToast />}
    </>
  )

  function renderView() {
    // Link de recuperação expirado — volta para login com aviso
    if (linkExpired) {
      return <Login forceMode="expired" onExpiredDismiss={() => setLinkExpired(false)} />
    }

    // Fluxo de recuperação de senha — mostra formulário mesmo com sessão ativa
    if (isRecovery) {
      return (
        <Login
          forceMode="reset"
          onResetDone={async () => {
            // A sessão de recuperação vem só do e-mail: encerra e exige o login completo
            // (e-mail + senha + código por WhatsApp).
            signingOutRef.current = true
            await supabase.auth.signOut()
            setIsRecovery(false)
          }}
        />
      )
    }

    if (!user) {
      return (
        <Login
          notice={sessionLost
            ? 'Sua sessão expirou e você precisa entrar de novo. Por segurança, o portal não guarda a sessão em cache.'
            : null}
        />
      )
    }

    // Ainda conferindo o nível do perfil para uma tela de administrador
    if (!target) {
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-brand animate-spin" />
        </div>
      )
    }

    const backToDashboard = () => navigate(ROUTES.dashboard)

    if (target === ROUTES.admin) {
      return <Admin onBack={backToDashboard} />
    }

    if (target === ROUTES.ceo) {
      return <CeoDashboard onBack={backToDashboard} />
    }

    if (target === ROUTES.logs) {
      return <ActivityLog onBack={backToDashboard} />
    }

    if (target === ROUTES.eventos) {
      return <Eventos onBack={backToDashboard} />
    }

    return (
      <Dashboard
        user={user}
        onSignOutStart={() => { signingOutRef.current = true }}
        onNavigateAdmin={() => navigate(ROUTES.admin)}
        onNavigateCeo={()   => navigate(ROUTES.ceo)}
        onNavigateLogs={()  => navigate(ROUTES.logs)}
        onNavigateEventos={() => navigate(ROUTES.eventos)}
      />
    )
  }
}

export default App
