import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { LogOut, User, Loader2, Lock, X, Users, BarChart2, ClipboardList } from 'lucide-react'
import ModuleCard from '../components/ModuleCard'
import { logActivity } from '../lib/activityLog'
import { ADMIN_CARD_IMAGES } from '../lib/cardImages'

const BG_IMAGES = [
  '/images/elevadores/alex_rainer-FJbr9yn05vg-unsplash.jpg',
  '/images/elevadores/giuseppe-argenziano-TbtSyRLOYzc-unsplash.jpg',
  '/images/elevadores/zhuojun-yu-s6hM9MgMRsc-unsplash.jpg',
  '/images/elevadores/zhuojun-yu-s6hM9MgMRsc-unsplash2.jpg',
]

export default function Dashboard({ user, onNavigateAdmin, onNavigateCeo, onNavigateLogs }) {
  const [modules,  setModules]  = useState([])
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [blocked,  setBlocked]  = useState(null)  // módulo que o user tentou acessar sem permissão
  const [userPerms, setUserPerms] = useState(null) // null = acesso pleno

  // Imagem de fundo aleatória — sorteada uma vez por visita
  const bgImage = useMemo(
    () => BG_IMAGES[Math.floor(Math.random() * BG_IMAGES.length)],
    []
  )

  useEffect(() => {
    async function load() {
      // Perfil do usuário
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setProfile(prof)

      // Todos os módulos ativos
      const { data: mods } = await supabase
        .from('modules')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      setModules(mods || [])

      // Permissões individuais do usuário
      // Se não há entradas = acesso pleno (padrão)
      const { data: perms } = await supabase
        .from('module_permissions')
        .select('module_slug')
        .eq('user_id', user.id)

      setUserPerms(perms && perms.length > 0 ? perms.map(p => p.module_slug) : null)
      setLoading(false)
    }
    load()
  }, [user])

  function canAccess(slug) {
    if (userPerms === null) return true          // sem restrições = pleno
    return userPerms.includes(slug)
  }

  async function handleModuleClick(mod) {
    if (!canAccess(mod.slug)) {
      setBlocked(mod)
      return
    }
    // Para subsistemas vpsistema.com e verticalparts.com, injetar SSO token automaticamente
    const SSO_DOMAINS = ['vpsistema.com', 'verticalparts.com']
    if (mod.url && SSO_DOMAINS.some(d => mod.url.includes(d))) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token && session?.refresh_token) {
          const target = new URL(mod.url)
          // Injeta access + refresh → subsistema cria sessão SSO via /api/sso
          target.searchParams.set('sso_token',   session.access_token)
          target.searchParams.set('sso_refresh', session.refresh_token)
          logActivity({ action: 'module_access', target: mod.name })
          window.open(target.toString(), '_blank', 'noopener')
          return
        }
      } catch (_) { /* fallthrough */ }
    }
    window.open(mod.url, '_blank', 'noopener')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  const isAdmin   = profile?.level === 'Administrador'
  const firstName = profile?.name?.split(' ')[0] || user.email.split('@')[0]
  const avatarUrl = profile?.avatar_url || null

  return (
    <div
      className="min-h-screen flex flex-col relative"
      style={{
        backgroundImage: `url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Overlay escuro sobre o fundo — garante legibilidade */}
      <div className="absolute inset-0 bg-black/70 pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 bg-surface-card/80 backdrop-blur-sm border-b border-surface-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">

          <div className="flex items-center gap-3">
            <img src="/vp-logo.png" alt="VerticalParts" className="h-8 w-8 rounded-lg object-cover" />
            <span className="text-white font-bold text-lg tracking-wide">VerticalParts</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-slate-300">
              <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center ring-2 ring-brand/30">
                <span className="text-brand font-bold text-xs">
                  {(profile?.name || user.email).slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-white leading-none">{profile?.name || user.email}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {profile?.level || 'Colaborador'}
                  {profile?.department ? ` · ${profile.department}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-slate-400 hover:text-red-400
                         border border-surface-border hover:border-red-500/40
                         rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-6 py-10">

        <div className="mb-10">
          <h1 className="text-white text-3xl font-bold mb-1">
            Olá, <span className="text-brand">{firstName}</span> 👋
          </h1>
          <p className="text-slate-400">Selecione o sistema que deseja acessar</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">

            {/* Cards admin — aparecem primeiro, no canto superior esquerdo */}
            {isAdmin && (
              <button
                onClick={onNavigateAdmin}
                className="group relative overflow-hidden bg-surface-card border border-surface-border
                           hover:border-brand/40 rounded-2xl p-6 text-left
                           transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5
                           focus:outline-none focus:ring-2 focus:ring-brand/50"
              >
                <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                     style={{ backgroundImage: `url(${ADMIN_CARD_IMAGES.administracao})` }} />
                <div className="absolute inset-0 bg-black/65 group-hover:bg-black/55 transition-colors duration-300" />
                <div className="relative z-10">
                  <div className="absolute inset-x-0 -top-6 h-1 bg-brand opacity-80 group-hover:opacity-100 transition-opacity" />
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-brand/25 transition-transform group-hover:scale-110" style={{ boxShadow: '0 0 0 1px #F59E0B30' }}>
                    <Users className="w-6 h-6 text-brand" />
                  </div>
                  <h3 className="text-white font-semibold text-base mb-1 group-hover:text-brand transition-colors">
                    Administração
                  </h3>
                  <p className="text-slate-300 text-xs leading-relaxed opacity-80">
                    Gestão de usuários e acessos
                  </p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-brand opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Gerenciar</span>
                  </div>
                </div>
              </button>
            )}

            {isAdmin && (
              <button
                onClick={onNavigateCeo}
                className="group relative overflow-hidden bg-surface-card border border-surface-border
                           hover:border-green-500/40 rounded-2xl p-6 text-left
                           transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5
                           focus:outline-none focus:ring-2 focus:ring-green-500/50"
              >
                <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                     style={{ backgroundImage: `url(${ADMIN_CARD_IMAGES.painel})` }} />
                <div className="absolute inset-0 bg-black/65 group-hover:bg-black/55 transition-colors duration-300" />
                <div className="relative z-10">
                  <div className="absolute inset-x-0 -top-6 h-1 bg-green-500 opacity-70 group-hover:opacity-100 transition-opacity" />
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-green-500/25 transition-transform group-hover:scale-110" style={{ boxShadow: '0 0 0 1px #10B98130' }}>
                    <BarChart2 className="w-6 h-6 text-green-400" />
                  </div>
                  <h3 className="text-white font-semibold text-base mb-1 group-hover:text-green-400 transition-colors">
                    Painel Executivo
                  </h3>
                  <p className="text-slate-300 text-xs leading-relaxed opacity-80">
                    Visão consolidada de todos os sistemas
                  </p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-green-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Visualizar</span>
                  </div>
                </div>
              </button>
            )}

            {isAdmin && (
              <button
                onClick={onNavigateLogs}
                className="group relative overflow-hidden bg-surface-card border border-surface-border
                           hover:border-sky-500/40 rounded-2xl p-6 text-left
                           transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5
                           focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              >
                <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                     style={{ backgroundImage: `url(${ADMIN_CARD_IMAGES.logs})` }} />
                <div className="absolute inset-0 bg-black/65 group-hover:bg-black/55 transition-colors duration-300" />
                <div className="relative z-10">
                  <div className="absolute inset-x-0 -top-6 h-1 bg-sky-500 opacity-70 group-hover:opacity-100 transition-opacity" />
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-sky-500/25 transition-transform group-hover:scale-110" style={{ boxShadow: '0 0 0 1px #0EA5E930' }}>
                    <ClipboardList className="w-6 h-6 text-sky-400" />
                  </div>
                  <h3 className="text-white font-semibold text-base mb-1 group-hover:text-sky-400 transition-colors">
                    Activity Log
                  </h3>
                  <p className="text-slate-300 text-xs leading-relaxed opacity-80">
                    Histórico de acessos e ações
                  </p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Ver histórico</span>
                  </div>
                </div>
              </button>
            )}

            {/* Módulos do sistema */}
            {modules.map((mod, i) => (
              <ModuleCard
                key={mod.slug}
                module={mod}
                index={i}
                locked={!canAccess(mod.slug)}
                onClick={() => handleModuleClick(mod)}
              />
            ))}

          </div>
        )}
      </main>

      <footer className="relative z-10 text-center py-6 text-slate-600 text-xs border-t border-surface-border/50">
        © {new Date().getFullYear()} Vertical Parts — Portal Corporativo
      </footer>

      {/* Modal: sem acesso */}
      {blocked && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Lock className="w-6 h-6 text-red-400" />
              </div>
              <button onClick={() => setBlocked(null)}
                      className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Acesso Restrito</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-1">
              Você não tem acesso ao sistema
            </p>
            <p className="text-brand font-medium text-sm mb-6">{blocked.name}</p>
            <p className="text-slate-500 text-sm">
              Fale com o administrador para solicitar permissão.
            </p>
            <button
              onClick={() => setBlocked(null)}
              className="mt-6 w-full bg-surface border border-surface-border hover:border-brand/40
                         text-slate-300 hover:text-white rounded-lg py-2.5 text-sm font-medium
                         transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
