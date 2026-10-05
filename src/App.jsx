import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Login        from './pages/Login'
import Dashboard    from './pages/Dashboard'
import Admin        from './pages/Admin'
import CeoDashboard from './pages/CeoDashboard'
import ActivityLog  from './pages/ActivityLog'
import { logActivity } from './lib/activityLog'
import { watchForNewVersion } from './lib/versionWatch'
import UpdateToast from './components/UpdateToast'
import { Loader2 } from 'lucide-react'

// Marca de "esta aba já esteve logada" — só um booleano, some ao fechar a aba.
// Serve para explicar a volta ao login; a sessão em si continua sem persistir.
const SESSION_FLAG = 'vp_sessao_ativa'

function App() {
  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [view,       setView]       = useState('dashboard') // 'dashboard' | 'admin' | 'ceo' | 'logs'
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

  useEffect(() => {
    // Links de convite/recuperação por e-mail foram desativados: o hash não abre mais sessão.
    if (window.location.hash.includes('access_token') || window.location.hash.includes('error_code')) {
      window.history.replaceState({}, '', window.location.pathname)
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
      if (event === 'PASSWORD_RECOVERY') return  // recuperação por link foi desativada
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
        setView('dashboard')
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
    if (!user) {
      return (
        <Login
          notice={sessionLost
            ? 'Sua sessão expirou e você precisa entrar de novo. Por segurança, o portal não guarda a sessão em cache.'
            : null}
        />
      )
    }

    if (view === 'admin') {
      return <Admin onBack={() => setView('dashboard')} />
    }

    if (view === 'ceo') {
      return <CeoDashboard onBack={() => setView('dashboard')} />
    }

    if (view === 'logs') {
      return <ActivityLog onBack={() => setView('dashboard')} />
    }

    return (
      <Dashboard
        user={user}
        onSignOutStart={() => { signingOutRef.current = true }}
        onNavigateAdmin={() => { logActivity({ action: 'admin_access' }); setView('admin') }}
        onNavigateCeo={()   => { logActivity({ action: 'ceo_access'   }); setView('ceo')   }}
        onNavigateLogs={() => { logActivity({ action: 'log_access'    }); setView('logs')  }}
      />
    )
  }
}

export default App
