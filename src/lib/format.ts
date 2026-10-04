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
  copilot: "Copiloto",
};
