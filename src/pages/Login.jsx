import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, CheckCircle } from 'lucide-react'

export default function Login({ forceMode = null, onResetDone = null, onExpiredDismiss = null }) {
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [mode,         setMode]         = useState(forceMode || 'login')   // 'login' | 'forgot' | 'reset' | 'expired'
  const [resetSent,    setResetSent]    = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [newPassword,  setNewPassword]  = useState('')
  const [confirmPass,  setConfirmPass]  = useState('')
  const [showNewPass,  setShowNewPass]  = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [resetDone,    setResetDone]    = useState(false)

  useEffect(() => {
    if (forceMode) setMode(forceMode)
  }, [forceMode])

  async function handleSetNewPassword(e) {
    e.preventDefault()
    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (newPassword !== confirmPass) {
      setError('As senhas não coincidem. Verifique e tente novamente.')
      return
    }
    setError('')
    setResetLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setResetLoading(false)
    if (updateError) {
      setError('Não foi possível redefinir a senha. Tente solicitar um novo link.')
      return
    }
    setResetDone(true)
    setTimeout(() => {
      setResetDone(false)
      setNewPassword('')
      setConfirmPass('')
      if (onResetDone) onResetDone()
      else setMode('login')
    }, 2500)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('E-mail ou senha inválidos. Tente novamente.')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', data.user.id)
      .single()

    if (profile && profile.is_active === false) {
      await supabase.auth.signOut()
      setError('Sua conta está desativada. Fale com o administrador.')
      setLoading(false)
      return
    }

    setLoading(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setResetLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://vpsistema.com',
    })

    setResetLoading(false)

    if (resetError) {
      setError('Não foi possível enviar o e-mail. Verifique o endereço informado.')
      return
    }

    setResetSent(true)
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">

      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl overflow-hidden shadow-lg shadow-brand/30">
            <img src="/vp-logo.png" alt="VerticalParts" className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-2xl tracking-wide">VerticalParts</span>
        </div>
        <p className="text-slate-400 text-sm tracking-widest uppercase">Portal Corporativo</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-surface-card border border-surface-border rounded-2xl p-8 shadow-2xl">

        {/* ── LOGIN ── */}
        {mode === 'login' && (
          <>
            <div className="mb-8">
              <h1 className="text-white font-bold text-2xl mb-1">Bem-vindo 👋</h1>
              <p className="text-slate-400 text-sm">
                Acesse com seu e-mail corporativo para continuar
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">

              <div>
                <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  E-mail Corporativo
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@verticalparts.com.br"
                    required
                    className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                               rounded-lg pl-10 pr-4 py-3 text-sm
                               focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand
                               transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                               rounded-lg pl-10 pr-10 py-3 text-sm
                               focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand
                               transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    tabIndex={-1}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand hover:bg-brand-dark disabled:opacity-60 disabled:cursor-not-allowed
                           text-surface font-bold rounded-lg py-3 text-sm uppercase tracking-widest
                           flex items-center justify-center gap-2
                           transition-colors duration-200 shadow-lg shadow-brand/20 mt-2"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Entrando...</>
                  : 'Entrar'}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError(''); setResetSent(false) }}
                  className="text-slate-500 hover:text-brand text-xs transition-colors"
                >
                  Esqueci minha senha
                </button>
              </div>

            </form>
          </>
        )}

        {/* ── REDEFINIR SENHA (vindo do link de e-mail) ── */}
        {mode === 'reset' && (
          <>
            <div className="mb-8">
              <h1 className="text-white font-bold text-2xl mb-1">Nova senha</h1>
              <p className="text-slate-400 text-sm">
                Digite sua nova senha para acessar o portal.
              </p>
            </div>

            {resetDone ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <CheckCircle className="w-12 h-12 text-brand" />
                <p className="text-white font-semibold text-center">Senha redefinida!</p>
                <p className="text-slate-400 text-sm text-center">Redirecionando para o login...</p>
              </div>
            ) : (
              <form onSubmit={handleSetNewPassword} className="space-y-5">
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Nova Senha
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                    <input
                      type={showNewPass ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="mínimo 6 caracteres"
                      required
                      minLength={6}
                      className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                                 rounded-lg pl-10 pr-10 py-3 text-sm
                                 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand
                                 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      tabIndex={-1}
                    >
                      {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    Confirmar Nova Senha
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPass}
                      onChange={e => setConfirmPass(e.target.value)}
                      placeholder="repita a nova senha"
                      required
                      minLength={6}
                      className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                                 rounded-lg pl-10 pr-10 py-3 text-sm
                                 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand
                                 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full bg-brand hover:bg-brand-dark disabled:opacity-60 disabled:cursor-not-allowed
                             text-surface font-bold rounded-lg py-3 text-sm uppercase tracking-widest
                             flex items-center justify-center gap-2
                             transition-colors duration-200 shadow-lg shadow-brand/20"
                >
                  {resetLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
                    : 'Salvar nova senha'}
                </button>
              </form>
            )}
          </>
        )}

        {/* ── LINK EXPIRADO ── */}
        {mode === 'expired' && (
          <>
            <div className="mb-8">
              <h1 className="text-white font-bold text-2xl mb-1">Link expirado</h1>
              <p className="text-slate-400 text-sm">
                O link de recuperação que você usou expirou ou já foi utilizado.
              </p>
            </div>
            <p className="text-slate-400 text-sm mb-6">
              Solicite um novo link para criar sua senha.
            </p>
            <button
              onClick={() => {
                setMode('forgot')
                setError('')
                setResetSent(false)
                if (onExpiredDismiss) onExpiredDismiss()
              }}
              className="w-full bg-brand hover:bg-brand-dark text-surface font-bold rounded-lg py-3 text-sm
                         uppercase tracking-widest transition-colors duration-200 shadow-lg shadow-brand/20"
            >
              Solicitar novo link
            </button>
            <div className="text-center mt-4">
              <button
                onClick={() => { setMode('login'); if (onExpiredDismiss) onExpiredDismiss() }}
                className="text-slate-500 hover:text-brand text-xs transition-colors"
              >
                ← Voltar ao login
              </button>
            </div>
          </>
        )}

        {/* ── ESQUECI A SENHA ── */}
        {mode === 'forgot' && (
          <>
            <div className="mb-8">
              <h1 className="text-white font-bold text-2xl mb-1">Recuperar acesso</h1>
              <p className="text-slate-400 text-sm">
                Informe seu e-mail corporativo e enviaremos um link para criar uma nova senha.
              </p>
            </div>

            {resetSent ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <CheckCircle className="w-12 h-12 text-brand" />
                <p className="text-white font-semibold text-center">E-mail enviado!</p>
                <p className="text-slate-400 text-sm text-center">
                  Verifique sua caixa de entrada em <span className="text-brand">{email}</span> e clique no link para criar sua nova senha.
                </p>
                <button
                  onClick={() => { setMode('login'); setResetSent(false); setError('') }}
                  className="text-slate-500 hover:text-brand text-xs transition-colors mt-2"
                >
                  ← Voltar ao login
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div>
                  <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">
                    E-mail Corporativo
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="seu@verticalparts.com.br"
                      required
                      className="w-full bg-surface border border-surface-border text-white placeholder-slate-600
                                 rounded-lg pl-10 pr-4 py-3 text-sm
                                 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand
                                 transition-colors"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full bg-brand hover:bg-brand-dark disabled:opacity-60 disabled:cursor-not-allowed
                             text-surface font-bold rounded-lg py-3 text-sm uppercase tracking-widest
                             flex items-center justify-center gap-2
                             transition-colors duration-200 shadow-lg shadow-brand/20"
                >
                  {resetLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
                    : 'Enviar link de recuperação'}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError('') }}
                    className="text-slate-500 hover:text-brand text-xs transition-colors"
                  >
                    ← Voltar ao login
                  </button>
                </div>
              </form>
            )}
          </>
        )}

      </div>

      <p className="text-slate-600 text-xs mt-8">
        © {new Date().getFullYear()} Vertical Parts — Acesso Restrito
      </p>
    </div>
  )
}
