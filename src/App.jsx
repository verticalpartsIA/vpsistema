import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login        from './pages/Login'
import Dashboard    from './pages/Dashboard'
import Admin        from './pages/Admin'
import CeoDashboard from './pages/CeoDashboard'
import ActivityLog  from './pages/ActivityLog'
import { logActivity } from './lib/activityLog'
import { Loader2 } from 'lucide-react'

function App() {
  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [view,       setView]       = useState('dashboard') // 'dashboard' | 'admin' | 'ceo' | 'logs'
  const [isRecovery, setIsRecovery] = useState(false)
  const [linkExpired, setLinkExpired] = useState(false)

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
        logActivity({ action: 'login' })
      }
      if (event === 'SIGNED_OUT') {
        logActivity({ action: 'logout' })
      }
      setUser(session?.user ?? null)
      if (!session?.user) {
        setView('dashboard')
        setIsRecovery(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    )
  }

  // Link de recuperação expirado — volta para login com aviso
  if (linkExpired) {
    return <Login forceMode="expired" onExpiredDismiss={() => setLinkExpired(false)} />
  }

  // Fluxo de recuperação de senha — mostra formulário mesmo com sessão ativa
  if (isRecovery) {
    return <Login forceMode="reset" onResetDone={() => setIsRecovery(false)} />
  }

  if (!user) return <Login />

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
      onNavigateAdmin={() => { logActivity({ action: 'admin_access' }); setView('admin') }}
      onNavigateCeo={()   => { logActivity({ action: 'ceo_access'   }); setView('ceo')   }}
      onNavigateLogs={() => { logActivity({ action: 'log_access'    }); setView('logs')  }}
    />
  )
}

export default App
