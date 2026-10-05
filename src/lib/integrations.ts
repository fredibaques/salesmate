/**
 * Catalog of external tools shown in «Conexiones». `available` ones have a
 * connector; the rest are planned and shown so users know what is coming.
 */

export type IntegrationCategory = "crm" | "email_calendar" | "messaging" | "data";

export type Integration = {
  id: string;
  name: string;
  tagline: string;
  category: IntegrationCategory;
  status: "available" | "soon";
  /** Brand-ish colour for the letter avatar. */
  color: string;
  /** What the agents can do once connected, in plain words. */
  abilities?: string[];
};

export const INTEGRATION_CATEGORIES: Record<IntegrationCategory, string> = {
  crm: "CRM",
  email_calendar: "Correo y calendario",
  messaging: "Teléfono y mensajería",
  data: "Datos y otras herramientas",
};

export const INTEGRATIONS: Integration[] = [
  {
    id: "google",
    name: "Google Workspace",
    tagline: "Gmail y Google Calendar",
    category: "email_calendar",
    status: "available",
    color: "#4285F4",
    abilities: [
      "Consultar tu disponibilidad para ofrecer huecos reales",
      "Crear reuniones con invitación",
      "Preparar borradores y enviar emails desde tu buzón",
      "Leer los emails que llegan para responder leads",
    ],
  },
  {
    id: "twenty",
    name: "Twenty CRM",
    tagline: "CRM de código abierto",
    category: "crm",
    status: "available",
    color: "#141414",
    abilities: [
      "Buscar personas y empresas antes de contactar",
      "Crear o actualizar contactos",
      "Crear tareas y registrar notas",
      "Recibir avisos cuando cambia algo en el CRM",
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    tagline: "Outlook y calendario de Microsoft",
    category: "email_calendar",
    status: "soon",
    color: "#0078D4",
  },
  { id: "hubspot", name: "HubSpot", tagline: "CRM", category: "crm", status: "soon", color: "#FF7A59" },
  { id: "pipedrive", name: "Pipedrive", tagline: "CRM", category: "crm", status: "soon", color: "#1A1A1A" },
  { id: "salesforce", name: "Salesforce", tagline: "CRM", category: "crm", status: "soon", color: "#00A1E0" },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    tagline: "Mensajes con clientes",
    category: "messaging",
    status: "soon",
    color: "#25D366",
  },
  {
    id: "phone",
    name: "Telefonía",
    tagline: "Aircall, Ringover y similares",
    category: "messaging",
    status: "soon",
    color: "#00B388",
  },
  {
    id: "mcp",
    name: "Servidor MCP",
    tagline: "Cualquier herramienta que ofrezca MCP",
    category: "data",
    status: "available",
    color: "#6E56CF",
    abilities: [
      "Usar las herramientas que el servidor ofrezca: buscar, consultar o crear datos en esa aplicación.",
      "Tú eliges en cada agente qué herramientas puede usar.",
      "Las que solo leen se usan directamente; las que cambian algo pasan por las reglas del proyecto y, si así lo decides, por tu aprobación.",
    ],
  },
  {
    id: "database",
    name: "Base de datos",
    tagline: "Postgres, MySQL… como fuente de datos",
    category: "data",
    status: "soon",
    color: "#336791",
  },
];

export function getIntegration(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

/** Plain-language description of what a stored connection is allowed to do. */
export function describeScopes(read: string[], write: string[]): string[] {
  const out: string[] = [];
  if (read.includes("calendar")) out.push("Ver disponibilidad");
  if (write.includes("calendar")) out.push("Crear reuniones");
  if (read.includes("email")) out.push("Leer el correo");
  if (write.includes("email")) out.push("Redactar y enviar emails");
  if (read.includes("crm")) out.push("Leer el CRM");
  if (write.includes("crm")) out.push("Escribir en el CRM");
  return out;
}

export const CAPABILITY_LABELS: Record<string, string> = {
  "crm.search_people": "Buscar personas en el CRM",
  "crm.describe": "Ver la estructura del CRM",
  "crm.upsert_contact": "Crear o actualizar contactos",
  "crm.create_task": "Crear tareas",
  "crm.log_note": "Registrar notas",
  "email.list_messages": "Ver emails recibidos",
  "email.get_message": "Leer emails",
  "email.send": "Enviar emails",
  "email.create_draft": "Crear borradores",
  "calendar.free_busy": "Consultar disponibilidad",
  "calendar.book": "Crear reuniones",
};
