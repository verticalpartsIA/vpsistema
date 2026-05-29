import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, CheckCircle, Check } from 'lucide-react'

// ── Painel esquerdo — identidade da marca ────────────────────────────────────
function BrandPanel() {
  return (
    <div
      className="relative hidden lg:flex flex-col justify-between overflow-hidden p-14 text-white"
      style={{ background: 'radial-gradient(circle at 30% 20%, #1c1c1c, #000 65%)' }}
    >
      {/* Grade sutil dourada */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(245,196,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(245,196,0,0.05) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(circle at 30% 30%, #000 40%, transparent 80%)',
        }}
      />
      {/* Círculo decorativo */}
      <div className="pointer-events-none absolute right-[-120px] top-1/2 h-[360px] w-[360px] -translate-y-1/2 rounded-full border-2 border-brand/20" />

      {/* Logo */}
      <div className="relative z-10">
        <img src="/logo-white.png" alt="VerticalParts" className="h-9 object-contain" />
      </div>

      {/* Texto */}
      <div className="relative z-10">
        <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-brand before:h-0.5 before:w-7 before:bg-brand before:content-['']">
          Portal Corporativo
        </span>
        <h1 className="mt-4 text-[44px] font-extrabold leading-[1.1] tracking-tight">
          Bem-vindo<br />de volta à <span className="text-brand">VerticalParts.</span>
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
          Acesse dashboards, relatórios e ferramentas de gestão em um só lugar.
        </p>

        <ul className="mt-8 flex flex-col gap-3.5">
          {[
            'Vendas, Compras, Engenharia, Financeiro e mais',
            'Integração com todos os sistemas VP — SSO automático',
            'Controle de permissões por cargo e departamento',
          ].map((f) => (
            <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="h-4 w-4 shrink-0 text-brand" strokeWidth={3} />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
        © {new Date().getFullYear()} VerticalParts
      </div>
    </div>
  )
}

// ── Campo de formulário (estilo DS, fundo branco) ────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, required, icon, rightSlot }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className="w-full rounded-lg border border-neutral-200 bg-white py-2.5 text-sm text-black placeholder-neutral-400
                     pl-9 pr-10 outline-none transition-colors
                     focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {rightSlot && (
          <span className="absolute right-3 top-1/2 z-10 -translate-y-1/2">{rightSlot}</span>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function Login({ forceMode = null, onResetDone = null, onExpiredDismiss = null }) {
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [mode,         setMode]         = useState(forceMode || 'login')
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

  // ── Lógica de auth (inalterada) ──────────────────────────────────────────

  async function handleSetNewPassword(e) {
    e.preventDefault()
    if (newPassword.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return }
    if (newPassword !== confirmPass) { setError('As senhas não coincidem. Verifique e tente novamente.'); return }
    setError('')
    setResetLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setResetLoading(false)
    if (updateError) { setError('Não foi possível redefinir a senha. Tente solicitar um novo link.'); return }
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
    if (authError) { setError('E-mail ou senha inválidos. Tente novamente.'); setLoading(false); return }
    const { data: profile } = await supabase.from('profiles').select('is_active').eq('id', data.user.id).single()
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
    if (resetError) { setError('Não foi possível enviar o e-mail. Verifique o endereço informado.'); return }
    setResetSent(true)
  }

  // ── Helpers de UI ────────────────────────────────────────────────────────

  const EyeBtn = ({ show, onToggle }) => (
    <button type="button" onClick={onToggle} tabIndex={-1}
      className="cursor-pointer text-neutral-400 hover:text-neutral-600 transition-colors">
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )

  const ErrorBox = () => error ? (
    <div className="flex items-center gap-2 rounded-lg border-l-[3px] border-red-500 bg-red-50 px-4 py-3">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
      <p className="text-sm text-red-700">{error}</p>
    </div>
  ) : null

  const SubmitBtn = ({ disabled, children }) => (
    <button type="submit" disabled={disabled}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3
                 text-sm font-bold text-black shadow-lg shadow-brand/30
                 transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
      {children}
    </button>
  )

  const BackToLogin = () => (
    <div className="text-center">
      <button type="button" onClick={() => { setMode('login'); setError('') }}
        className="text-xs font-semibold text-neutral-500 transition-colors hover:text-black">
        ← Voltar para o login
      </button>
    </div>
  )

  // ── Conteúdo do painel direito por modo ──────────────────────────────────

  const rightContent = {

    login: (
      <>
        <div className="mb-8">
          <p className="mb-1 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand before:h-0.5 before:w-5 before:bg-brand before:content-['']">
            Acessar conta
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-black">Entrar na plataforma</h2>
          <p className="mt-2 text-sm text-neutral-500">Use seu e-mail corporativo e senha cadastrados.</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <Field label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="seu@verticalparts.com.br" required icon={<Mail className="h-4 w-4" />} />
          <Field label="Senha" type={showPass ? 'text' : 'password'} value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••••" required
            icon={<Lock className="h-4 w-4" />}
            rightSlot={<EyeBtn show={showPass} onToggle={() => setShowPass(v => !v)} />} />
          <ErrorBox />
          <SubmitBtn disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Entrando...</> : 'Entrar →'}
          </SubmitBtn>
          <div className="text-center">
            <button type="button" onClick={() => { setMode('forgot'); setError(''); setResetSent(false) }}
              className="text-xs font-semibold text-neutral-500 transition-colors hover:text-brand">
              Esqueceu a senha?
            </button>
          </div>
        </form>
      </>
    ),

    forgot: resetSent ? (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
          <CheckCircle className="h-7 w-7 text-brand" />
        </div>
        <h2 className="text-2xl font-extrabold text-black">E-mail enviado!</h2>
        <p className="max-w-xs text-sm text-neutral-500">
          Verifique sua caixa de entrada em <span className="font-semibold text-brand">{email}</span>{' '}
          e clique no link para criar sua nova senha.
        </p>
        <button onClick={() => { setMode('login'); setResetSent(false); setError('') }}
          className="mt-2 text-xs font-semibold text-neutral-500 transition-colors hover:text-black">
          ← Voltar para o login
        </button>
      </div>
    ) : (
      <>
        <div className="mb-8">
          <p className="mb-1 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand before:h-0.5 before:w-5 before:bg-brand before:content-['']">
            Recuperar acesso
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-black">Esqueceu a senha?</h2>
          <p className="mt-2 text-sm text-neutral-500">
            Informe o e-mail cadastrado e enviaremos um link para redefinir sua senha.
          </p>
        </div>
        <form onSubmit={handleForgotPassword} className="space-y-4">
          <Field label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="seu@verticalparts.com.br" required icon={<Mail className="h-4 w-4" />} />
          <ErrorBox />
          <SubmitBtn disabled={resetLoading}>
            {resetLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : 'Enviar link de redefinição →'}
          </SubmitBtn>
          <BackToLogin />
        </form>
      </>
    ),

    reset: resetDone ? (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
          <CheckCircle className="h-7 w-7 text-brand" />
        </div>
        <h2 className="text-2xl font-extrabold text-black">Senha redefinida!</h2>
        <p className="text-sm text-neutral-500">Redirecionando para o login...</p>
      </div>
    ) : (
      <>
        <div className="mb-8">
          <p className="mb-1 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand before:h-0.5 before:w-5 before:bg-brand before:content-['']">
            Nova senha
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-black">Defina sua nova senha</h2>
          <p className="mt-2 text-sm text-neutral-500">
            Escolha uma senha forte. Você fará login com ela em seguida.
          </p>
        </div>
        <form onSubmit={handleSetNewPassword} className="space-y-4">
          <Field label="Nova senha" type={showNewPass ? 'text' : 'password'} value={newPassword}
            onChange={e => setNewPassword(e.target.value)} placeholder="mínimo 6 caracteres" required
            icon={<Lock className="h-4 w-4" />}
            rightSlot={<EyeBtn show={showNewPass} onToggle={() => setShowNewPass(v => !v)} />} />
          <Field label="Confirmar nova senha" type={showConfirm ? 'text' : 'password'} value={confirmPass}
            onChange={e => setConfirmPass(e.target.value)} placeholder="repita a nova senha" required
            icon={<Lock className="h-4 w-4" />}
            rightSlot={<EyeBtn show={showConfirm} onToggle={() => setShowConfirm(v => !v)} />} />
          <ErrorBox />
          <SubmitBtn disabled={resetLoading}>
            {resetLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : 'Salvar nova senha →'}
          </SubmitBtn>
        </form>
      </>
    ),

    expired: (
      <>
        <div className="mb-8">
          <p className="mb-1 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand before:h-0.5 before:w-5 before:bg-brand before:content-['']">
            Link expirado
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-black">Link inválido</h2>
          <p className="mt-2 text-sm text-neutral-500">
            O link de recuperação expirou ou já foi utilizado. Solicite um novo.
          </p>
        </div>
        <button onClick={() => { setMode('forgot'); setError(''); setResetSent(false); if (onExpiredDismiss) onExpiredDismiss() }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3
                     text-sm font-bold text-black shadow-lg shadow-brand/30
                     transition-colors hover:bg-brand-dark">
          Solicitar novo link →
        </button>
        <div className="mt-4 text-center">
          <button onClick={() => { setMode('login'); if (onExpiredDismiss) onExpiredDismiss() }}
            className="text-xs font-semibold text-neutral-500 transition-colors hover:text-black">
            ← Voltar ao login
          </button>
        </div>
      </>
    ),
  }

  // ── Layout split ─────────────────────────────────────────────────────────

  return (
    <div className="grid min-h-screen w-full grid-cols-1 lg:grid-cols-[1fr_1.05fr]">
      <BrandPanel />
      <div className="flex items-center justify-center bg-white p-8 lg:p-14">
        <div className="w-full max-w-[440px]">
          {/* Logo visível só no mobile (painel esquerdo está oculto) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo-color.png" alt="VerticalParts" className="h-8 object-contain" />
          </div>
          {rightContent[mode]}
        </div>
      </div>
    </div>
  )
}
