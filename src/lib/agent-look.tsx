import {
  Bot,
  Briefcase,
  Building2,
  Handshake,
  HeartHandshake,
  Mail,
  Megaphone,
  MessageSquareReply,
  Phone,
  Radar,
  Rocket,
  Search,
  Send,
  Sparkles,
  Star,
  Target,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * How an agent looks in the sidebar, its page and its card: an icon and a
 * colour the team picks. Shared by server and client components. Class
 * names are written out whole so Tailwind keeps them.
 */

export const AGENT_ICON_CHOICES: Record<string, { label: string; Icon: LucideIcon }> = {
  send: { label: "Enviar", Icon: Send },
  reply: { label: "Responder", Icon: MessageSquareReply },
  care: { label: "Cuidar", Icon: HeartHandshake },
  search: { label: "Buscar", Icon: Search },
  radar: { label: "Radar", Icon: Radar },
  target: { label: "Objetivo", Icon: Target },
  rocket: { label: "Cohete", Icon: Rocket },
  zap: { label: "Rayo", Icon: Zap },
  sparkles: { label: "Chispas", Icon: Sparkles },
  bot: { label: "Robot", Icon: Bot },
  mail: { label: "Email", Icon: Mail },
  phone: { label: "Teléfono", Icon: Phone },
  users: { label: "Personas", Icon: Users },
  building: { label: "Empresa", Icon: Building2 },
  briefcase: { label: "Maletín", Icon: Briefcase },
  handshake: { label: "Acuerdo", Icon: Handshake },
  megaphone: { label: "Megáfono", Icon: Megaphone },
  star: { label: "Estrella", Icon: Star },
};

export const AGENT_COLORS: Record<string, { label: string; tile: string; text: string; swatch: string }> = {
  lima: { label: "Lima", tile: "bg-brand-100 text-accent", text: "text-accent", swatch: "bg-brand-500" },
  verde: {
    label: "Verde",
    tile: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-600",
    swatch: "bg-emerald-500",
  },
  turquesa: {
    label: "Turquesa",
    tile: "bg-teal-100 text-teal-700",
    text: "text-teal-600",
    swatch: "bg-teal-500",
  },
  azul: { label: "Azul", tile: "bg-sky-100 text-sky-700", text: "text-sky-600", swatch: "bg-sky-500" },
  indigo: {
    label: "Índigo",
    tile: "bg-indigo-100 text-indigo-700",
    text: "text-indigo-600",
    swatch: "bg-indigo-500",
  },
  violeta: {
    label: "Violeta",
    tile: "bg-violet-100 text-violet-700",
    text: "text-violet-600",
    swatch: "bg-violet-500",
  },
  rosa: { label: "Rosa", tile: "bg-pink-100 text-pink-700", text: "text-pink-600", swatch: "bg-pink-500" },
  coral: {
    label: "Coral",
    tile: "bg-coral-100 text-coral-700",
    text: "text-coral-600",
    swatch: "bg-coral-600",
  },
  ambar: {
    label: "Ámbar",
    tile: "bg-amber-100 text-amber-700",
    text: "text-amber-600",
    swatch: "bg-amber-500",
  },
  gris: { label: "Gris", tile: "bg-ink-100 text-ink-700", text: "text-ink-600", swatch: "bg-ink-500" },
};

const DEFAULT_ICON: Record<string, string> = { inbound: "reply", outbound: "send", account_manager: "care" };

/** The agent's icon and colour: its own, or its template's. */
export function agentLook(type: string, icon?: string | null, color?: string | null) {
  const iconKey = icon && AGENT_ICON_CHOICES[icon] ? icon : (DEFAULT_ICON[type] ?? "bot");
  const colorKey = color && AGENT_COLORS[color] ? color : "lima";
  return { iconKey, colorKey, Icon: AGENT_ICON_CHOICES[iconKey].Icon, ...AGENT_COLORS[colorKey] };
}
