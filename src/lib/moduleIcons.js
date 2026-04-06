/**
 * Mapa central de ícones dos módulos.
 * Usado por ModuleCard (Dashboard) e pelo modal de Permissões (Admin).
 * Todos os nomes batem com o campo `icon` da tabela `modules` no Supabase.
 */
import {
  ShieldCheck,
  MapPin,
  Package,
  ClipboardList,
  Globe,
  MousePointerClick,
  DraftingCompass,
  Activity,
  Bot,
  FileSignature,
  Users,
  ExternalLink,
} from 'lucide-react'

export const MODULE_ICONS = {
  ShieldCheck,
  MapPin,
  Package,
  ClipboardList,
  Globe,
  MousePointerClick,
  DraftingCompass,
  Activity,
  Bot,
  FileSignature,
  Users,
}

/** Retorna o componente de ícone pelo nome (string vinda do banco).
 *  Fallback: ExternalLink */
export function getModuleIcon(name) {
  return MODULE_ICONS[name] || ExternalLink
}
