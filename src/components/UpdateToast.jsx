import { RefreshCw } from 'lucide-react'

// Aviso de versão nova para quando NÃO dá para recarregar sozinho — o
// colaborador está com algo digitado na tela (convite, edição de nome) e um
// reload automático jogaria o trabalho fora. Aqui a decisão é dele.
export default function UpdateToast() {
  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3
                 bg-surface-card border border-brand/40 rounded-xl shadow-2xl
                 px-4 py-3 max-w-[calc(100vw-2rem)]"
    >
      <RefreshCw className="w-4 h-4 text-brand shrink-0" />
      <p className="text-sm text-slate-300 leading-snug">
        Nova versão do portal disponível.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 bg-brand hover:bg-brand-dark text-surface font-bold
                   rounded-lg px-3 py-1.5 text-xs transition-colors"
      >
        Atualizar
      </button>
    </div>
  )
}
