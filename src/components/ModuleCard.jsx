import { ExternalLink } from 'lucide-react'
import { getModuleIcon } from '../lib/moduleIcons'
import { getCardImage } from '../lib/cardImages'

export default function ModuleCard({ module: mod, locked = false, onClick, index = 0 }) {
  const Icon    = getModuleIcon(mod.icon)
  const color   = mod.color || '#F59E0B'
  const bgImage = getCardImage(mod.slug, index)

  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden bg-surface-card border border-surface-border rounded-2xl p-6 text-left
                  transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand/50
                  ${locked
                    ? 'opacity-35 saturate-50 cursor-pointer'
                    : 'hover:border-opacity-60 hover:shadow-xl hover:-translate-y-0.5'}`}
    >
      {/* Imagem de fundo opaca */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      {/* Overlay escuro para garantir legibilidade */}
      <div className="absolute inset-0 bg-black/65 group-hover:bg-black/55 transition-colors duration-300" />

      {/* Conteúdo — acima do overlay */}
      <div className="relative z-10">

        {/* Faixa colorida no topo */}
        <div
          className="absolute inset-x-0 -top-6 h-1 opacity-80 group-hover:opacity-100 transition-opacity"
          style={{ background: locked ? '#64748B' : color }}
        />

        {/* Ícone */}
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4
            ${locked ? '' : 'transition-transform group-hover:scale-110'}`}
          style={{ background: `${color}25`, boxShadow: `0 0 0 1px ${color}30` }}
        >
          <Icon className="w-6 h-6" strokeWidth={1.75} style={{ color }} />
        </div>

        {/* Nome */}
        <h3 className={`font-semibold text-base mb-1 transition-colors
          ${locked ? 'text-slate-400' : 'text-white group-hover:text-brand'}`}>
          {mod.name}
        </h3>

        {/* Descrição */}
        {mod.description && (
          <p className="text-slate-300 text-xs leading-relaxed line-clamp-2 opacity-80">
            {mod.description}
          </p>
        )}

        {/* Rodapé */}
        <div className="mt-4 flex items-center gap-1 text-xs font-medium" style={{ color }}>
          {locked ? (
            <span className="text-slate-500">Sem permissão</span>
          ) : (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              Abrir sistema <ExternalLink className="w-3 h-3" />
            </span>
          )}
        </div>

      </div>
    </button>
  )
}
