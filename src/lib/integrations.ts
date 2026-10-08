/**
 * Catalog of external tools shown in «Integraciones». `available` ones have a
 * connector; the rest are planned and shown so users know what is coming.
 */

export type IntegrationCategory = "crm" | "email_calendar" | "messaging" | "data" | "workspace";

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
  workspace: "Documentos y gestión de tareas",
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
    id: "google_meet",
    name: "Google Meet",
    tagline: "Videollamadas y sus transcripciones",
    category: "email_calendar",
    status: "available",
    color: "#00897B",
    abilities: [
      "Las reuniones que agenda el agente en Google Calendar llevan su enlace de Meet",
      "Al acabar, trae la transcripción, la resume y anota los siguientes pasos en la conversación",
      "Necesita la transcripción activada en la llamada (Google Workspace de pago)",
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
    id: "slack",
    name: "Slack",
    tagline: "Avisos de los agentes en un canal",
    category: "messaging",
    status: "available",
    color: "#4A154B",
    abilities: [
      "Avisar en un canal cuando un agente termina, falla o llega a un límite",
      "Solo escribe en ese canal: no lee mensajes",
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    tagline: "Mensajes con clientes",
    category: "messaging",
    status: "available",
    color: "#25D366",
    abilities: [
      "Atender los mensajes que llegan a tu número de empresa (agente inbound)",
      "Responder por WhatsApp, siempre según las reglas del proyecto y con tu aprobación",
      "Usa la API oficial de Meta (WhatsApp Cloud API)",
    ],
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
    id: "apollo",
    name: "Apollo",
    tagline: "Base de datos de empresas y contactos B2B",
    category: "data",
    status: "available",
    color: "#2C2A9C",
    abilities: [
      "Encontrar empresas por sector, zona y tamaño",
      "Encontrar a quién decide en cada empresa (por cargo), sin gastar créditos",
      "Obtener su email de trabajo y teléfono para completar la base de prospectos",
      "Solo lee: no escribe nada en tu cuenta de Apollo",
    ],
  },
  {
    id: "hunter",
    name: "Hunter.io",
    tagline: "Emails de trabajo por empresa",
    category: "data",
    status: "available",
    color: "#FA5320",
    abilities: [
      "Encontrar quién trabaja en una empresa (por su web), con su cargo y su email de trabajo",
      "Encontrar el email de una persona concreta y verificar que existe",
      "Completar los datos de una empresa: sector, tamaño y ubicación",
      "Solo lee: no escribe nada en tu cuenta de Hunter",
    ],
  },
  {
    id: "lusha",
    name: "Lusha",
    tagline: "Datos de contacto B2B",
    category: "data",
    status: "available",
    color: "#5A4BFF",
    abilities: [
      "Obtener el email de trabajo y el teléfono de una persona concreta",
      "Completar los datos de una empresa: sector, tamaño, ubicación y LinkedIn",
      "No usa los teléfonos marcados como «no llamar»",
      "Solo lee: no escribe nada en tu cuenta de Lusha",
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
  {
    id: "google_docs",
    name: "Google Docs",
    tagline: "Documentos como conocimiento",
    category: "workspace",
    status: "available",
    color: "#4285F4",
    abilities: [
      "Importar un documento de Google Docs al conocimiento de un proyecto",
      "Solo lee los documentos que importes",
    ],
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    tagline: "Hojas como conocimiento y destino de tablas",
    category: "workspace",
    status: "available",
    color: "#34A853",
    abilities: [
      "Importar una hoja de cálculo como tabla de conocimiento (tarifas, catálogos…)",
      "Exportar una tabla de SalesMate a una hoja nueva de Google Sheets",
    ],
  },
  {
    id: "airtable",
    name: "Airtable",
    tagline: "Bases de datos colaborativas",
    category: "workspace",
    status: "available",
    color: "#18BFFF",
    abilities: [
      "Exportar una tabla de SalesMate a una tabla nueva de una base de Airtable",
      "Con un token personal: solo las bases a las que le des acceso",
    ],
  },
  {
    id: "trello",
    name: "Trello",
    tagline: "Tableros y tarjetas",
    category: "workspace",
    status: "available",
    color: "#0052CC",
    abilities: [
      "Exportar filas de una tabla como tarjetas de una lista",
      "Que los agentes creen tarjetas para el equipo (tareas de seguimiento), con las reglas del proyecto",
    ],
  },
  {
    id: "monday",
    name: "monday.com",
    tagline: "Tableros de trabajo",
    category: "workspace",
    status: "available",
    color: "#FF3D57",
    abilities: [
      "Exportar filas de una tabla como elementos de un tablero",
      "Que los agentes creen elementos para el equipo (tareas de seguimiento), con las reglas del proyecto",
    ],
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
  if (read.includes("data")) out.push("Buscar empresas y datos de contacto");
  if (read.includes("docs")) out.push("Leer documentos de Docs");
  if (read.includes("sheets")) out.push("Leer hojas de cálculo");
  if (write.includes("sheets")) out.push("Crear hojas de cálculo");
  if (read.includes("meet")) out.push("Leer transcripciones de Meet");
  if (write.includes("workspace")) out.push("Exportar tablas y crear tareas");
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
  "data.check": "Comprobar la cuenta",
  "data.search_people": "Buscar personas",
  "data.search_companies": "Buscar empresas",
  "data.enrich_person": "Datos de contacto de una persona",
  "data.enrich_company": "Datos de una empresa",
  "data.verify_email": "Verificar emails",
  "docs.read": "Leer documentos",
  "sheets.read": "Leer hojas de cálculo",
  "table.export": "Exportar tablas",
  "export.targets": "Ver bases, listas y tableros",
  "task.create": "Crear tareas para el equipo",
  "meet.transcript": "Leer transcripciones de Meet",
};
