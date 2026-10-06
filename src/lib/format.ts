const dateTime = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(typeof value === "string" ? new Date(value) : value);
}

export function formatSlot(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(start);
}

export const ACTION_STATUS_LABELS: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "accent" }
> = {
  pending_approval: { label: "Pendiente", tone: "accent" },
  approved: { label: "Aprobada", tone: "neutral" },
  deferred: { label: "Programada", tone: "warning" },
  executing: { label: "Ejecutando", tone: "neutral" },
  succeeded: { label: "Hecha", tone: "success" },
  failed: { label: "Fallida", tone: "danger" },
  rejected: { label: "Rechazada", tone: "neutral" },
  blocked: { label: "Bloqueada", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const AUTONOMY_LABELS = [
  "0 · Sugerir",
  "1 · Borrador (aprobación)",
  "2 · Autónomo con límites",
  "3 · Autónomo",
];

export const AGENT_LABELS: Record<string, string> = {
  outbound: "Outbound",
  inbound: "Inbound",
  account_manager: "Account Manager",
  intelligence: "Inteligencia",
  copilot: "Copilot",
};

export const CONVERSATION_STATUS: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "accent" }
> = {
  open: { label: "Abierta", tone: "neutral" },
  waiting_us: { label: "Nos toca", tone: "accent" },
  waiting_customer: { label: "Esperando al contacto", tone: "neutral" },
  handed_off: { label: "Derivada", tone: "warning" },
  closed: { label: "Cerrada", tone: "neutral" },
};

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  engaged: "En conversación",
  qualified: "Cualificado",
  disqualified: "Descartado",
  customer: "Cliente",
  lost: "Perdido",
};

const dateOnly = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateOnly.format(typeof value === "string" ? new Date(value) : value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}

const EVENT_LABELS: Record<string, string> = {
  "project.created": "Proyecto creado",
  "project.updated": "Proyecto actualizado",
  "project.deleted": "Proyecto eliminado",
  "project.sales_profile_updated": "Oferta y cliente actualizados",
  "project.form_key_rotated": "Clave del formulario renovada",
  "project.connection_linked": "Conexión asignada al proyecto",
  "project.connection_unlinked": "Conexión retirada del proyecto",
  "agent.added": "Agente añadido",
  "agent.removed": "Agente quitado",
  "agent.enabled": "Agente activado",
  "agent.paused": "Agente en pausa",
  "agent.channels_updated": "Canales del agente actualizados",
  "agent.config_updated": "Aprobaciones del agente actualizadas",
  "agent.instructions_updated": "Instrucciones del agente actualizadas",
  "agent.tools_updated": "Herramientas del agente actualizadas",
  "agent.run_started": "Agente en marcha",
  "prospects.added": "Prospectos añadidos",
  "prospects.exported": "Prospectos exportados",
  "playbook.created": "Proceso de venta creado",
  "playbook.version_saved": "Proceso de venta guardado",
  "knowledge.source_added": "Conocimiento añadido",
  "knowledge.source_updated": "Conocimiento actualizado",
  "knowledge.source_deleted": "Conocimiento eliminado",
  "meeting_type.created": "Tipo de reunión creado",
  "meeting_type.deleted": "Tipo de reunión eliminado",
  "compliance_rule.added": "Regla añadida",
  "compliance_rule.removed": "Regla quitada",
  "suppression.added": "Exclusión añadida",
  "suppression.removed": "Exclusión quitada",
  "connection.saved": "Conexión guardada",
  "person.created": "Contacto creado",
};

/** Human label for an audit event code; unknown codes are shown as they are. */
export function describeEvent(event: string): string {
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];
  if (event.startsWith("action.")) {
    const status = ACTION_STATUS_LABELS[event.slice("action.".length)];
    if (status) return `Acción: ${status.label.toLowerCase()}`;
  }
  return event;
}
