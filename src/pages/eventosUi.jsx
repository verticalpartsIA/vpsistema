import { useEffect } from 'react'
import { Info, Loader2, Radio, X } from 'lucide-react'

export function Chip({ cls, children }) {
  return <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{children}</span>
}

export function Aviso({ children }) {
  return (
    <div className="flex items-start gap-3 bg-violet-500/10 border border-violet-500/20 text-violet-200 rounded-xl px-4 py-3 text-sm mb-5">
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function Vazio({ texto }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <Radio className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm text-center max-w-md">{texto}</p>
    </div>
  )
}

export function Carregando() {
  return <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-brand animate-spin" /></div>
}

// Janela de edição sobre a página. Fecha com Esc, com o X ou clicando fora.
export function Modal({ titulo, onFechar, children, rodape }) {
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onFechar])
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-2xl max-h-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-white font-semibold">{titulo}</h2>
          <button onClick={onFechar} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
        {rodape && <div className="px-5 py-4 border-t border-surface-border flex items-center justify-end gap-3">{rodape}</div>}
      </div>
    </div>
  )
}

export function Campo({ rotulo, dica, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-400 mb-1">{rotulo}</span>
      {children}
      {dica && <span className="block text-xs text-slate-500 mt-1">{dica}</span>}
    </label>
  )
}

export const INPUT = 'w-full bg-surface border border-surface-border text-slate-200 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600'
