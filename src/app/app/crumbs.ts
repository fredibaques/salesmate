import type { Crumb } from "@/components/breadcrumbs";
import { AGENT_INFO } from "@/lib/agents";
import { getIntegration } from "@/lib/integrations";

export type NameLookup = {
  project: (id: string) => Promise<string | null>;
  source: (id: string) => Promise<string | null>;
  conversation: (id: string) => Promise<string | null>;
};

const SETTINGS = { label: "Configuración", href: "/app/connections" };
const COPILOT = { label: "Copilot", href: "/app/copilot" };
const ACCOUNT = { label: "Mi cuenta", href: "/app/account" };

const SECTION_PAGES: Record<string, { parent: Crumb; label: string }> = {
  connections: { parent: SETTINGS, label: "Conexiones" },
  ai: { parent: SETTINGS, label: "IA" },
  exclusions: { parent: SETTINGS, label: "Exclusiones" },
  audit: { parent: SETTINGS, label: "Auditoría" },
  copilot: { parent: COPILOT, label: "Asistente" },
  inbox: { parent: COPILOT, label: "Por aprobar" },
};

const ACCOUNT_PAGES: Record<string, string> = { security: "Seguridad", organization: "Organización" };

const PROJECT_TABS: Record<string, string> = {
  agents: "Agentes",
  knowledge: "Conocimiento",
  conversations: "Conversaciones",
  settings: "Ajustes",
  rules: "Ajustes",
  offer: "Ajustes",
};

function agentPageLabel(type: string, page: string) {
  switch (page) {
    case "instructions":
      return "Instrucciones";
    case "channels":
      return type === "outbound" ? "Herramientas" : "Canales y herramientas";
    case "approvals":
      return "Aprobaciones";
    case "prospects":
      return "Prospectos";
    default:
      return null;
  }
}

/**
 * The trail for a path under /app (`segments` are the parts after it). A
 * section's first page links back to the section; the last crumb is the page.
 */
export async function crumbsFor(segments: string[], names: NameLookup): Promise<Crumb[]> {
  const [first, ...rest] = segments;

  const section = SECTION_PAGES[first];
  if (section) {
    const here = { label: section.label, href: `/app/${first}` };
    if (first === "connections" && rest[0] === "new") {
      const out: Crumb[] = [section.parent, here, { label: "Nueva conexión", href: "/app/connections/new" }];
      if (rest[1]) out.push({ label: getIntegration(rest[1])?.name ?? rest[1] });
      return out;
    }
    return [section.parent, here];
  }

  if (first === "account") {
    return [ACCOUNT, { label: rest[0] ? (ACCOUNT_PAGES[rest[0]] ?? rest[0]) : "Perfil" }];
  }

  if (first === "projects") {
    const [id, tab, sub, subsub] = rest;
    if (!id) return [];
    if (id === "new") return [{ label: "Panel", href: "/app" }, { label: "Nuevo proyecto" }];
    const base = `/app/projects/${id}`;
    const project = { label: (await names.project(id)) ?? "Proyecto", href: base };
    if (!tab || tab === "agents") {
      const agents = { label: "Agentes", href: base };
      if (tab !== "agents" || !sub) return [project, agents];
      if (sub === "new") {
        const info = subsub ? AGENT_INFO[subsub as keyof typeof AGENT_INFO] : undefined;
        return [project, agents, { label: info ? `Añadir el ${info.name.toLowerCase()}` : "Añadir agente" }];
      }
      const info = AGENT_INFO[sub as keyof typeof AGENT_INFO];
      const agent = { label: info?.name ?? sub, href: `${base}/agents/${sub}` };
      const page = subsub ? agentPageLabel(sub, subsub) : null;
      return page ? [project, agents, agent, { label: page }] : [project, agents, agent];
    }
    const tabLabel = PROJECT_TABS[tab];
    if (!tabLabel) return [project];
    const tabCrumb = {
      label: tabLabel,
      href: tab === "rules" || tab === "offer" ? `${base}/settings` : `${base}/${tab}`,
    };
    if (tab === "rules") return [project, tabCrumb, { label: "Reglas y exclusiones" }];
    if (tab === "knowledge" && sub)
      return [project, tabCrumb, { label: (await names.source(sub)) ?? "Documento" }];
    if (tab === "conversations" && sub) {
      return [project, tabCrumb, { label: (await names.conversation(sub)) ?? "Conversación" }];
    }
    return [project, tabCrumb];
  }

  return [];
}
