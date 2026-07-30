import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LogOut, User, Loader2, Lock, X, Users, BarChart2, ClipboardList, ExternalLink } from 'lucide-react'
import ModuleCard from '../components/ModuleCard'
import { logActivity } from '../lib/activityLog'
import { ADMIN_CARD_IMAGES } from '../lib/cardImages'


export default function Dashboard({ user, onNavigateAdmin, onNavigateCeo, onNavigateLogs, onSignOutStart }) {
  const [modules,  setModules]  = useState([])
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [blocked,  setBlocked]  = useState(null)  // módulo que o user tentou acessar sem permissão
  const [blockedSlugs, setBlockedSlugs] = useState([]) // módulos bloqueados p/ este user
  // Pop-up bloqueado pelo navegador (antivírus corporativo, política restritiva)
  // e nenhuma aba abriu: guarda o link certo pra pessoa clicar manualmente,
  // em vez do clique não fazer nada visível.
  const [openFailed, setOpenFailed] = useState(null) // { name, url }

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

      // Bloqueios individuais do usuário.
      // Todo colaborador cadastrado acessa todos os sistemas por padrão — a
      // tabela module_permissions só guarda exceções (can_access = false).
      // Antes ela funcionava como allow-list: quem tinha qualquer linha ficava
      // trancado fora de tudo que não estivesse marcado.
      const { data: blocks } = await supabase
        .from('module_permissions')
        .select('module_slug')
        .eq('user_id', user.id)
        .eq('can_access', false)

      setBlockedSlugs((blocks || []).map(b => b.module_slug))
      setLoading(false)
    }
    load()
  }, [user])

  function canAccess(slug) {
    return !blockedSlugs.includes(slug)
  }

  // Tenta abrir url numa aba nova; devolve false se o navegador bloqueou
  // (window.open retorna null, ou lança em alguns navegadores mais estritos).
  // Chamado depois de um await NUNCA é garantia de abrir — só o primeiro
  // window.open dentro do próprio clique conta como gesto do usuário para
  // a maioria dos bloqueadores de pop-up.
  function tryOpen(url) {
    try {
      return !!window.open(url, '_blank', 'noopener')
    } catch (_) {
      return false
    }
  }

  async function handleModuleClick(mod) {
    if (!canAccess(mod.slug)) {
      setBlocked(mod)
      return
    }

    logActivity({ action: 'module_access', target: mod.name })

    // Sistemas fora dos domínios VP (sem SSO) — abre direto.
    const SSO_DOMAINS = ['vpsistema.com', 'verticalparts.com']
    const isSSO = mod.url && SSO_DOMAINS.some(d => mod.url.includes(d))
    if (!isSSO) {
      if (!tryOpen(mod.url)) setOpenFailed({ name: mod.name, url: mod.url })
      return
    }

    // Abre a aba IMEDIATAMENTE, ainda dentro do gesto de clique. O link de SSO
    // é resolvido de forma assíncrona; se chamássemos window.open() só depois do
    // await, o navegador bloquearia como pop-up.
    const win = window.open('about:blank', '_blank')

    try {
      const targetApp = new URL(mod.url).hostname.split('.')[0]
      const { data, error } = await supabase.functions.invoke('sso-proxy', {
        body: { targetApp },
      })

      let finalUrl = mod.url
      if (!error && data?.actionLink) {
        finalUrl = data.actionLink
        // Removido: este bloco anexava sso_refresh sempre que a URL continha
        // "sso_token=" — mas essa string só aparece no link dos apps TOKEN
        // (Catraca, Propostas, VP Click, Engenharia, Suporte, Cotação
        // Importação), que por design verificam o JWT direto no servidor e
        // nunca pediram refresh_token (ver _shared/apps.ts). O link dos apps
        // MAGICLINK vem de generateLink() do Supabase — usa o parâmetro
        // "token", não "sso_token" — então essa condição nunca era
        // verdadeira pra eles, apesar do comentário original dizer o
        // contrário. Na prática, o código sempre injetou um parâmetro extra
        // e não pedido nos apps TOKEN — inofensivo se o satélite ignora
        // parâmetros desconhecidos, mas explica o "reload" no Propostas se
        // o front dele tentar consumir esse refresh_token (que pertence ao
        // projeto Supabase do vpsistema, não ao dele) como se fosse iniciar
        // uma sessão local.
      }

      // Se a aba inicial foi bloqueada (win null) e a segunda tentativa também
      // falhar — provável, ela roda fora do gesto de clique original — a pessoa
      // fica sem nenhum feedback. Mostra o link certo pra abrir manualmente:
      // um clique de verdade da pessoa nunca é bloqueado.
      if (win && !win.closed) win.location.href = finalUrl
      else if (!tryOpen(finalUrl)) setOpenFailed({ name: mod.name, url: finalUrl })
    } catch (_) {
      // Falha ao gerar SSO — abre a URL direta na aba já aberta.
      if (win && !win.closed) win.location.href = mod.url
      else if (!tryOpen(mod.url)) setOpenFailed({ name: mod.name, url: mod.url })
    }
  }

  async function handleLogout() {
    // Avisa o App de que esta saída foi pedida pela pessoa — sem isso, o
    // SIGNED_OUT seria lido como sessão caída e mostraria o aviso de expiração.
    if (onSignOutStart) onSignOutStart()
    await supabase.auth.signOut()
  }

  const isAdmin   = profile?.level === 'Administrador'
  const firstName = profile?.name?.split(' ')[0] || user.email.split('@')[0]
  const avatarUrl = profile?.avatar_url || null

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">

      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">

          {/* Só a imagem: o logo já traz a marca escrita, o texto ao lado repetia. */}
          <div className="flex items-center">
            <img src="/logo-color.png" alt="VerticalParts" className="h-8 object-contain" />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-neutral-600">
              <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center ring-2 ring-brand/30">
                <span className="text-brand font-bold text-xs">
                  {(profile?.name || user.email).slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-neutral-900 leading-none">{profile?.name || user.email}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {profile?.level || 'Colaborador'}
                  {profile?.department ? ` · ${profile.department}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-neutral-500 hover:text-red-500
                         border border-neutral-200 hover:border-red-300
                         rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10">

        <div className="mb-10">
          <h1 className="text-neutral-900 text-3xl font-bold mb-1">
            Olá, <span className="text-brand">{firstName}</span> 👋
          </h1>
          <p className="text-neutral-500">Selecione o sistema que deseja acessar</p>
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

      <footer className="text-center py-6 text-neutral-400 text-xs border-t border-neutral-200">
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

      {/* Modal: navegação bloqueada pelo navegador (pop-up) */}
      {openFailed && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <ExternalLink className="w-6 h-6 text-amber-400" />
              </div>
              <button onClick={() => setOpenFailed(null)}
                      className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Não foi possível abrir automaticamente</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-1">
              O navegador bloqueou a abertura de
            </p>
            <p className="text-brand font-medium text-sm mb-6">{openFailed.name}</p>
            <p className="text-slate-500 text-sm mb-6">
              Costuma ser bloqueio de pop-up (antivírus corporativo ou configuração do navegador). Clique no botão abaixo para abrir manualmente.
            </p>
            <a
              href={openFailed.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpenFailed(null)}
              className="block w-full text-center bg-brand hover:bg-brand-dark text-surface
                         font-bold rounded-lg py-2.5 text-sm transition-colors"
            >
              Abrir {openFailed.name}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
