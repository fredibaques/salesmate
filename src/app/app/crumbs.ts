import type { Crumb } from "@/components/breadcrumbs";
import { AGENT_INFO } from "@/lib/agents";

export type NameLookup = {
  project: (id: string) => Promise<string | null>;
  source: (id: string) => Promise<string | null>;
  conversation: (id: string) => Promise<string | null>;
  base: (id: string) => Promise<string | null>;
  meeting: (id: string) => Promise<string | null>;
  /** The name the user gave an agent, if any. */
  agent: (projectId: string, type: string) => Promise<string | null>;
};

const SETTINGS = { label: "Configuración", href: "/app/connections" };

const SECTION_PAGES: Record<string, { parent: Crumb; label: string }> = {
  connections: { parent: SETTINGS, label: "Conexiones" },
  ai: { parent: SETTINGS, label: "IA" },
  users: { parent: SETTINGS, label: "Usuarios" },
  exclusions: { parent: SETTINGS, label: "Exclusiones" },
  audit: { parent: SETTINGS, label: "Auditoría" },
};

const PROJECT_TABS: Record<string, string> = {
  prospects: "Tablas",
  knowledge: "Conocimiento",
  conversations: "Conversaciones",
  meetings: "Reuniones",
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
    case "automation":
      return "Automatización";
    default:
      return null;
  }
}

/**
 * The trail for a path under /app (`segments` are the parts after it). A
 * section's first page links back to the section; the last crumb is the page.
 * A section's own pages (a project and its tabs, a settings page) have its
 * header and tabs, so they get no trail: it starts one level deeper.
 */
export async function crumbsFor(segments: string[], names: NameLookup): Promise<Crumb[]> {
  const [first, ...rest] = segments;

  const section = SECTION_PAGES[first];
  if (section) {
    const here = { label: section.label, href: `/app/${first}` };
    if (first === "ai" && rest[0] === "connect") return [section.parent, here, { label: "Conectar" }];
    return [];
  }

  // Mi cuenta: its pages are tabs of one section.
  if (first === "account") return [];

  if (first === "projects") {
    const [id, tab, sub, subsub] = rest;
    if (!id) return [];
    if (id === "new") return [{ label: "Panel", href: "/app" }, { label: "Nuevo proyecto" }];
    // The project and its tabs show the project's header.
    if (!sub) return [];
    const base = `/app/projects/${id}`;
    const project = { label: (await names.project(id)) ?? "Proyecto", href: base };
    // Agents hang from the project (as in the sidebar): no «Agentes» step.
    if (tab === "agents") {
      if (sub === "new") {
        const info = subsub ? AGENT_INFO[subsub as keyof typeof AGENT_INFO] : undefined;
        return [project, { label: info ? `Añadir el ${info.name.toLowerCase()}` : "Añadir agente" }];
      }
      const info = AGENT_INFO[sub as keyof typeof AGENT_INFO];
      const agent = {
        label: (await names.agent(id, sub)) ?? info?.name ?? sub,
        href: `${base}/agents/${sub}`,
      };
      const page = subsub ? agentPageLabel(sub, subsub) : null;
      return page ? [project, agent, { label: page }] : [project, agent];
    }
    const tabLabel = PROJECT_TABS[tab];
    if (!tabLabel) return [project];
    const tabCrumb = {
      label: tabLabel,
      href: tab === "rules" || tab === "offer" ? `${base}/settings` : `${base}/${tab}`,
    };
    if (tab === "knowledge" && sub)
      return [project, tabCrumb, { label: (await names.source(sub)) ?? "Documento" }];
    if (tab === "prospects" && sub) {
      if (sub === "new") return [project, tabCrumb, { label: "Nueva tabla" }];
      return [project, tabCrumb, { label: (await names.base(sub)) ?? "Base" }];
    }
    if (tab === "meetings" && sub) {
      return [project, tabCrumb, { label: (await names.meeting(sub)) ?? "Reunión" }];
    }
    if (tab === "conversations" && sub) {
      return [project, tabCrumb, { label: (await names.conversation(sub)) ?? "Conversación" }];
    }
    return [project, tabCrumb];
  }

  return [];
}
