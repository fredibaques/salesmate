import type { Crumb } from "@/components/breadcrumbs";
import { AGENT_INFO } from "@/lib/agents";

export type NameLookup = {
  project: (id: string) => Promise<string | null>;
  source: (id: string) => Promise<string | null>;
  conversation: (id: string) => Promise<string | null>;
  base: (id: string) => Promise<string | null>;
  meeting: (id: string) => Promise<string | null>;
  /** How an agent of the project is called (its name or its template's). */
  agent: (projectId: string, agentId: string) => Promise<string | null>;
};

const SETTINGS = { label: "Configuración", href: "/app/ai" };

const SECTION_PAGES: Record<string, { parent: Crumb; label: string }> = {
  ai: { parent: SETTINGS, label: "IA" },
  runs: { parent: SETTINGS, label: "Ejecuciones" },
  users: { parent: SETTINGS, label: "Usuarios" },
  exclusions: { parent: SETTINGS, label: "Exclusiones" },
  audit: { parent: SETTINGS, label: "Auditoría" },
};

const PROJECT_TABS: Record<string, string> = {
  prospects: "Tablas",
  sales: "Ventas",
  knowledge: "Conocimiento",
  conversations: "Conversaciones",
  meetings: "Reuniones",
  settings: "Ajustes",
  rules: "Ajustes",
  offer: "Ventas",
};

function agentPageLabel(page: string) {
  switch (page) {
    case "instructions":
      return "Configuración";
    case "channels":
      return "Herramientas";
    case "approvals":
      return "Aprobaciones";
    case "automation":
      return "Configuración";
    case "log":
      return "Log";
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

  // Mi cuenta, Integraciones and Conversaciones are pages of their own.
  if (first === "account" || first === "connections" || first === "conversations") return [];

  // Knowledge of the whole account: a source hangs from «Conocimiento».
  if (first === "knowledge") {
    const [id] = rest;
    if (!id) return [];
    return [
      { label: "Conocimiento", href: "/app/knowledge" },
      { label: (await names.source(id)) ?? "Documento" },
    ];
  }

  // A table, with a project or on its own: under «Tablas».
  if (first === "tables") {
    const [id] = rest;
    if (!id) return [];
    return [{ label: "Tablas", href: "/app/tables" }, { label: (await names.base(id)) ?? "Tabla" }];
  }

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
      const agent = {
        label: (await names.agent(id, sub)) ?? "Agente",
        href: `${base}/agents/${sub}`,
      };
      const page = subsub ? agentPageLabel(subsub) : null;
      return page ? [project, agent, { label: page }] : [project, agent];
    }
    // «Ventas» has sub-tabs under the project's header, like Ajustes: no trail.
    if (tab === "sales") return [];
    const tabLabel = PROJECT_TABS[tab];
    if (!tabLabel) return [project];
    const tabCrumb = {
      label: tabLabel,
      href: tab === "rules" ? `${base}/settings` : tab === "offer" ? `${base}/sales` : `${base}/${tab}`,
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
