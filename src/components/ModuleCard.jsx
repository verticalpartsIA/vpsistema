import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { getModuleIcon } from '../lib/moduleIcons'
import { getCardImage } from '../lib/cardImages'

export default function ModuleCard({ module: mod, locked = false, onClick, index = 0 }) {
  // Card especial do Blog: ouro vivo animado (estilos em index.css, .vp-gold-card)
  if (mod.slug === 'blog') return <GoldModuleCard module={mod} locked={locked} onClick={onClick} />

  const Icon    = getModuleIcon(mod.icon)
  const color   = mod.color || '#F59E0B'
  const bgImage = getCardImage(mod.slug, index)

  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden bg-surface-card border border-surface-border rounded-2xl p-6 text-left
                  transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-brand/50
                  ${locked
                    ? 'opacity-35 saturate-50 cursor-pointer'
                    : 'hover:border-brand/40 hover:shadow-2xl hover:-translate-y-2 hover:scale-[1.02]'}`}
    >
      {/* Imagem de fundo opaca */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-110"
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

/** Conteúdo do card do Blog. `light` = versão clara, vista só dentro da mancha escura. */
function GoldContent({ mod, Icon, locked, light }) {
  return (
    <div className="relative z-10">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-inner
                      ${light ? 'bg-amber-300' : 'bg-black/80'}`}>
        <Icon className={`w-6 h-6 ${light ? 'text-[#1c1300]' : 'text-amber-300'}`} strokeWidth={1.75} />
      </div>

      <h3 className={`font-bold text-base mb-1 ${light ? 'text-[#fff6cf]' : 'text-[#1c1300]'}`}>{mod.name}</h3>

      {mod.description && (
        <p className={`text-xs leading-relaxed line-clamp-2 ${light ? 'text-amber-100' : 'text-[#3a2900]'}`}>
          {mod.description}
        </p>
      )}

      <div className={`mt-4 flex items-center gap-1 text-xs font-semibold ${light ? 'text-[#fff6cf]' : 'text-[#1c1300]'}`}>
        {locked ? (
          <span>Sem permissão</span>
        ) : (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            Abrir sistema <ExternalLink className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  )
}

/** Card do Blog: ouro vivo. A mancha escura segue o mouse e o amarelo foge para as bordas. */
function GoldModuleCard({ module: mod, locked, onClick }) {
  const Icon = getModuleIcon(mod.icon)
  const ref = useRef(null)
  const pos = useRef({ x: 0, y: 0, tx: 0, ty: 0, raf: 0, init: false })

  // Segue o mouse com atraso (suavização), o que dá o jeito de gota arrastada.
  const tick = () => {
    const el = ref.current
    const p = pos.current
    if (!el) { p.raf = 0; return }
    p.x += (p.tx - p.x) * 0.16
    p.y += (p.ty - p.y) * 0.16
    el.style.setProperty('--mx', `${p.x}px`)
    el.style.setProperty('--my', `${p.y}px`)
    // Para o loop quando a mancha alcança o mouse (não gasta CPU parado).
    p.raf = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) < 0.2 ? 0 : requestAnimationFrame(tick)
  }
  const handleMove = (e) => {
    if (locked || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const p = pos.current
    p.tx = e.clientX - r.left
    p.ty = e.clientY - r.top
    if (!p.init) { p.x = p.tx; p.y = p.ty; p.init = true }
    if (!p.raf) p.raf = requestAnimationFrame(tick)
  }
  const handleLeave = () => {
    const p = pos.current
    cancelAnimationFrame(p.raf)
    p.raf = 0
    p.init = false
  }
  useEffect(() => () => cancelAnimationFrame(pos.current.raf), [])

  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`vp-gold-card group relative overflow-hidden rounded-2xl p-6 text-left focus:outline-none focus:ring-2 focus:ring-amber-200/70
                  ${locked ? 'vp-gold-card--locked cursor-pointer' : ''}`}
    >
      {/* Marca VerticalParts escondida: só se revela dentro da mancha escura */}
      <div aria-hidden="true" className="vp-gold-logo absolute pointer-events-none" />
      <GoldContent mod={mod} Icon={Icon} locked={locked} />
      {/* Cópia clara do texto: só aparece dentro da mancha escura, para continuar legível */}
      <div aria-hidden="true" className="vp-gold-light absolute inset-0 p-6 pointer-events-none">
        <GoldContent mod={mod} Icon={Icon} locked={locked} light />
      </div>
    </button>
  )
}
