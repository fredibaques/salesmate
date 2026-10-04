import type { Lead } from "./conversations";

/**
 * Turns raw inbound payloads into a Lead. Form field names vary between
 * websites, so common names (Spanish and English) are recognised and the rest
 * is kept as extra context for the agent.
 */

const FIELD_ALIASES: Record<keyof Pick<Lead, "email" | "phone" | "firstName" | "lastName" | "companyName" | "subject" | "body">, string[]> & {
  fullName: string[];
  consent: string[];
} = {
  email: ["email", "e-mail", "correo", "correo_electronico", "mail"],
  phone: ["phone", "telefono", "teléfono", "tel", "movil", "móvil", "mobile", "whatsapp"],
  firstName: ["first_name", "firstname", "nombre"],
  lastName: ["last_name", "lastname", "apellidos", "apellido", "surname"],
  fullName: ["name", "full_name", "fullname", "nombre_completo", "your-name"],
  companyName: ["company", "empresa", "company_name", "organizacion", "organización", "negocio"],
  subject: ["subject", "asunto", "motivo", "tema"],
  body: ["message", "mensaje", "comments", "comentarios", "consulta", "description", "descripcion", "descripción", "your-message"],
  consent: ["consent", "consentimiento", "privacy", "privacidad", "acepto", "gdpr", "rgpd"],
};

function normalizeKey(key: string) {
  return key
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

function pick(fields: Map<string, string>, aliases: string[], used: Set<string>): string | null {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    const value = fields.get(key);
    if (value !== undefined && value.trim() !== "") {
      used.add(key);
      return value.trim();
    }
  }
  return null;
}

export function leadFromForm(raw: Record<string, unknown>): Lead {
  const fields = new Map<string, string>();
  const original = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_") || v === null || v === undefined) continue;
    const value = Array.isArray(v) ? v.join(", ") : String(v);
    fields.set(normalizeKey(k), value);
    original.set(normalizeKey(k), k);
  }
  const used = new Set<string>();
  let firstName = pick(fields, FIELD_ALIASES.firstName, used);
  let lastName = pick(fields, FIELD_ALIASES.lastName, used);
  const fullName = pick(fields, FIELD_ALIASES.fullName, used);
  // Spanish forms often use "nombre" for the full name.
  const whole = fullName ?? (!lastName && firstName?.includes(" ") ? firstName : null);
  if (whole) {
    const [first, ...rest] = whole.split(/\s+/);
    firstName = first;
    lastName = lastName ?? (rest.join(" ") || null);
  }
  const consentRaw = pick(fields, FIELD_ALIASES.consent, used);
  const lead: Lead = {
    channel: "form",
    email: pick(fields, FIELD_ALIASES.email, used),
    phone: pick(fields, FIELD_ALIASES.phone, used),
    firstName,
    lastName,
    companyName: pick(fields, FIELD_ALIASES.companyName, used),
    subject: pick(fields, FIELD_ALIASES.subject, used),
    body: pick(fields, FIELD_ALIASES.body, used) ?? "",
    extra: {},
    externalThreadId: null,
    externalMessageId: null,
    rfcMessageId: null,
    consent: consentRaw === null ? null : /^(on|true|1|si|sí|yes|acepto)$/i.test(consentRaw),
  };
  for (const [key, value] of fields) {
    if (!used.has(key)) lead.extra[original.get(key) ?? key] = value;
  }
  return lead;
}

export type GmailInboundPayload = {
  messageId: string;
  threadId: string;
  rfcMessageId: string | null;
  from: { email: string; name: string | null };
  to: string[];
  subject: string;
  text: string;
  date: string | null;
  autoSubmitted: boolean;
};

export function leadFromEmail(payload: GmailInboundPayload): Lead {
  const [firstName, ...rest] = (payload.from.name ?? "").split(/\s+/).filter(Boolean);
  return {
    channel: "email",
    email: payload.from.email,
    phone: null,
    firstName: firstName ?? null,
    lastName: rest.length ? rest.join(" ") : null,
    companyName: null,
    subject: payload.subject,
    body: stripQuotedReply(payload.text),
    extra: {},
    externalThreadId: payload.threadId,
    externalMessageId: payload.messageId,
    rfcMessageId: payload.rfcMessageId,
    consent: null,
  };
}

/** Drops the quoted previous message so the agent reads only what is new. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (l) =>
      /^(El|On) .{5,120}(escribió|wrote):\s*$/i.test(l.trim()) ||
      /^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/i.test(l.trim()) ||
      (/^De: .+$/i.test(l.trim()) && lines.some((x) => /^(Enviado|Sent):/i.test(x.trim()))),
  );
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">"));
  return kept.join("\n").trim();
}

const AUTO_SUBJECT = /(fuera de la oficina|out of office|respuesta autom[aá]tica|automatic reply|autoreply|delivery status notification|undeliverable|no se pudo entregar)/i;

export function looksAutomated(lead: Lead, autoSubmitted = false): boolean {
  return autoSubmitted || AUTO_SUBJECT.test(lead.subject ?? "") || /^(mailer-daemon|postmaster|no-?reply)@/i.test(lead.email ?? "");
}
