import { z } from "zod";
import { emailTargets } from "./targets";

/**
 * Everything an agent (or a person, or an MCP client) can do in the outside
 * world is declared here. The gateway only accepts registered action types.
 */
export type ActionDefinition<P = Record<string, unknown>> = {
  type: string;
  /** Capability the connector must provide to execute it (see connectors/capabilities.ts). */
  capability: string;
  label: string;
  /** Highest autonomy level allowed for this action whatever the project config says. */
  maxAutonomy: 0 | 1 | 2 | 3;
  /** Reaches a person outside the organization (send windows, cooldowns, notices apply). */
  outbound: boolean;
  /**
   * How the connection is chosen: through the identity in the payload, the
   * project's connections, or a `connectionId` in the payload (MCP servers).
   */
  connectionVia: "identity" | "project" | "payload";
  payloadSchema: z.ZodType<P>;
  targetKeys(payload: P): string[];
  /** Free text that content policies inspect (figures, mandatory notices). */
  textOf(payload: P): string;
  summary(payload: P): string;
};

const emailPayload = z.object({
  identityId: z.string().uuid(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
  inReplyToMessageId: z.string().optional(),
  threadId: z.string().optional(),
});
export type EmailPayload = z.infer<typeof emailPayload>;

const calendarBookPayload = z.object({
  identityId: z.string().uuid(),
  meetingTypeId: z.string().uuid().optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  title: z.string().min(1).max(300),
  description: z.string().max(8_000).default(""),
  location: z.string().optional(),
  attendees: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).min(1),
});
export type CalendarBookPayload = z.infer<typeof calendarBookPayload>;

const crmUpsertContactPayload = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1),
  lastName: z.string().default(""),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  companyName: z.string().optional(),
});
export type CrmUpsertContactPayload = z.infer<typeof crmUpsertContactPayload>;

const crmTaskPayload = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(8_000).default(""),
  dueAt: z.string().datetime({ offset: true }).optional(),
  personExternalId: z.string().optional(),
});
export type CrmTaskPayload = z.infer<typeof crmTaskPayload>;

const crmNotePayload = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
  personExternalId: z.string().optional(),
});
export type CrmNotePayload = z.infer<typeof crmNotePayload>;

const mcpCallPayload = z.object({
  connectionId: z.string().uuid(),
  /** Server name, for people reading the approval. */
  server: z.string().default(""),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
export type McpCallPayload = z.infer<typeof mcpCallPayload>;

function define<P>(def: ActionDefinition<P>): ActionDefinition<P> {
  return def;
}

export const ACTION_DEFINITIONS = {
  "email.send": define<EmailPayload>({
    type: "email.send",
    capability: "email.send",
    label: "Enviar email",
    maxAutonomy: 3,
    outbound: true,
    connectionVia: "identity",
    payloadSchema: emailPayload,
    targetKeys: (p) => emailTargets([...p.to, ...p.cc]),
    textOf: (p) => `${p.subject}\n${p.body}`,
    summary: (p) => `Email a ${p.to.join(", ")}: «${p.subject}»`,
  }),
  "email.create_draft": define<EmailPayload>({
    type: "email.create_draft",
    capability: "email.create_draft",
    label: "Crear borrador de email",
    maxAutonomy: 3,
    outbound: false,
    connectionVia: "identity",
    payloadSchema: emailPayload,
    targetKeys: (p) => emailTargets([...p.to, ...p.cc]),
    textOf: (p) => `${p.subject}\n${p.body}`,
    summary: (p) => `Borrador para ${p.to.join(", ")}: «${p.subject}»`,
  }),
  "calendar.book": define<CalendarBookPayload>({
    type: "calendar.book",
    capability: "calendar.book",
    label: "Reservar reunión",
    maxAutonomy: 3,
    outbound: true,
    connectionVia: "identity",
    payloadSchema: calendarBookPayload,
    targetKeys: (p) => emailTargets(p.attendees.map((a) => a.email)),
    textOf: (p) => `${p.title}\n${p.description}`,
    summary: (p) => `Reunión «${p.title}» el ${p.start} con ${p.attendees.map((a) => a.email).join(", ")}`,
  }),
  "crm.upsert_contact": define<CrmUpsertContactPayload>({
    type: "crm.upsert_contact",
    capability: "crm.upsert_contact",
    label: "Crear o actualizar contacto en el CRM",
    maxAutonomy: 3,
    outbound: false,
    connectionVia: "project",
    payloadSchema: crmUpsertContactPayload,
    targetKeys: (p) => (p.email ? emailTargets([p.email]) : []),
    textOf: () => "",
    summary: (p) => `Contacto ${p.firstName} ${p.lastName}`.trim() + (p.email ? ` <${p.email}>` : ""),
  }),
  "crm.create_task": define<CrmTaskPayload>({
    type: "crm.create_task",
    capability: "crm.create_task",
    label: "Crear tarea en el CRM",
    maxAutonomy: 3,
    outbound: false,
    connectionVia: "project",
    payloadSchema: crmTaskPayload,
    targetKeys: () => [],
    textOf: (p) => `${p.title}\n${p.body}`,
    summary: (p) => `Tarea «${p.title}»`,
  }),
  "crm.log_note": define<CrmNotePayload>({
    type: "crm.log_note",
    capability: "crm.log_note",
    label: "Registrar nota en el CRM",
    maxAutonomy: 3,
    outbound: false,
    connectionVia: "project",
    payloadSchema: crmNotePayload,
    targetKeys: () => [],
    textOf: (p) => `${p.title}\n${p.body}`,
    summary: (p) => `Nota «${p.title}»`,
  }),
  "mcp.call_tool": define<McpCallPayload>({
    type: "mcp.call_tool",
    capability: "mcp.call_tool",
    label: "Usar una herramienta conectada (MCP)",
    maxAutonomy: 3,
    outbound: false,
    connectionVia: "payload",
    payloadSchema: mcpCallPayload,
    targetKeys: () => [],
    textOf: (p) => JSON.stringify(p.arguments),
    summary: (p) => `«${p.tool}» en ${p.server || "un servidor MCP"}`,
  }),
} as const;

export type ActionType = keyof typeof ACTION_DEFINITIONS;

export function getActionDefinition(type: string): ActionDefinition<Record<string, unknown>> | null {
  const defs = ACTION_DEFINITIONS as unknown as Record<string, ActionDefinition<Record<string, unknown>>>;
  return Object.hasOwn(defs, type) ? defs[type] : null;
}
