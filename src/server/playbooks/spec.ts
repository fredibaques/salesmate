import { z } from "zod";
import type { SalesMotion } from "../db/schema";

/**
 * A playbook is how the user transfers *how they sell* to the agents.
 * It is data: versioned, editable, and rendered into the agent's context.
 * Nothing here is specific to a sector.
 */

export const NEXT_STEPS = [
  "meeting",
  "callback",
  "send_quote",
  "payment_link",
  "collect_data",
  "handoff",
  "nurture",
] as const;
export type NextStep = (typeof NEXT_STEPS)[number];

export const NEXT_STEP_LABELS: Record<NextStep, string> = {
  meeting: "Agendar reunión o demo",
  callback: "Agendar llamada (callback)",
  send_quote: "Enviar presupuesto o propuesta",
  payment_link: "Enviar enlace de pago o contratación",
  collect_data: "Recoger datos o documentación",
  handoff: "Derivar a una persona",
  nurture: "Nutrir hasta que muestre intención",
};

export const SALES_MOTION_LABELS: Record<SalesMotion, string> = {
  b2b_consultative: "B2B consultivo",
  b2b_transactional: "B2B transaccional",
  b2c_assisted: "B2C asistido",
  b2c_self_serve: "B2C autoservicio",
  custom: "Personalizado",
};

const lines = z.array(z.string().trim().min(1)).default([]);

export const playbookSpecSchema = z.object({
  /** What a successful conversation achieves, in one sentence. */
  objective: z.string().trim().default(""),
  customerType: z.enum(["b2b", "b2c"]),
  /** Allowed next steps, in order of preference. */
  nextSteps: z.array(z.enum(NEXT_STEPS)).min(1),
  segment: z
    .object({ include: lines, exclude: lines, geography: lines })
    .default({ include: [], exclude: [], geography: [] }),
  decisionMakers: lines,
  pains: lines,
  valueProposition: z.string().trim().default(""),
  qualification: z
    .array(
      z.object({
        criterion: z.string().trim().min(1),
        required: z.boolean().default(false),
      }),
    )
    .default([]),
  disqualifiers: lines,
  /** Data the agent must collect before the next step (e.g. for a quote). */
  requiredData: lines,
  objections: z
    .array(z.object({ objection: z.string().trim().min(1), response: z.string().trim().min(1) }))
    .default([]),
  /** Hard rules the agent must follow. */
  rules: lines,
  /** Situations that must go to a person. */
  handoff: lines,
  tone: z.string().trim().default(""),
  signature: z.string().trim().default(""),
  /** Meeting type used when the next step is a meeting or a callback. */
  meetingTypeId: z.string().uuid().optional(),
  /** Target time to have a reply ready, in minutes. */
  responseTimeMinutes: z.number().int().min(1).max(10_080).default(15),
});
export type PlaybookSpec = z.infer<typeof playbookSpecSchema>;

const base = {
  segment: { include: [], exclude: [], geography: [] },
  decisionMakers: [],
  pains: [],
  valueProposition: "",
  disqualifiers: [],
  requiredData: [],
  objections: [],
  handoff: ["Piden un precio o condición que no está en las fuentes de verdad", "Muestran enfado o hablan de temas legales"],
  signature: "",
} satisfies Partial<PlaybookSpec>;

export const PLAYBOOK_TEMPLATES: Record<SalesMotion, PlaybookSpec> = {
  b2b_consultative: {
    ...base,
    objective: "Conseguir una reunión con la persona que decide.",
    customerType: "b2b",
    nextSteps: ["meeting", "send_quote", "handoff"],
    qualification: [
      { criterion: "Tiene una necesidad que resolvemos", required: true },
      { criterion: "Habla con quien decide o puede llevarnos a esa persona", required: false },
      { criterion: "Plazo para decidir", required: false },
    ],
    rules: ["No ofrezcas descuentos ni condiciones especiales", "Responde siempre en el idioma del contacto"],
    tone: "Profesional, cercano y breve. Personaliza con lo que diga el contacto.",
    responseTimeMinutes: 30,
  },
  b2b_transactional: {
    ...base,
    objective: "Enviar presupuesto o dar de alta al cliente sin necesidad de reunión.",
    customerType: "b2b",
    nextSteps: ["send_quote", "collect_data", "meeting", "handoff"],
    qualification: [{ criterion: "Necesita un servicio que ofrecemos", required: true }],
    rules: ["Los precios salen solo de las tablas de tarifas", "Responde siempre en el idioma del contacto"],
    tone: "Claro y resolutivo.",
    responseTimeMinutes: 15,
  },
  b2c_assisted: {
    ...base,
    objective: "Recoger los datos necesarios y enviar un presupuesto personalizado.",
    customerType: "b2c",
    nextSteps: ["collect_data", "send_quote", "callback", "payment_link", "handoff"],
    qualification: [{ criterion: "Ha pedido información o presupuesto", required: true }],
    rules: [
      "Contacta solo con quien lo ha solicitado",
      "Los precios salen solo de las tablas de tarifas",
      "Responde siempre en el idioma del contacto",
    ],
    tone: "Cercano, sencillo y breve. Sin tecnicismos.",
    responseTimeMinutes: 5,
  },
  b2c_self_serve: {
    ...base,
    objective: "Que el cliente complete la compra online.",
    customerType: "b2c",
    nextSteps: ["payment_link", "handoff"],
    qualification: [{ criterion: "Muestra intención de compra", required: true }],
    rules: ["Contacta solo con quien lo ha solicitado", "Responde siempre en el idioma del contacto"],
    tone: "Cercano y directo.",
    responseTimeMinutes: 5,
  },
  custom: {
    ...base,
    objective: "",
    customerType: "b2b",
    nextSteps: ["handoff"],
    qualification: [],
    rules: [],
    tone: "",
    responseTimeMinutes: 30,
  },
};

function bullet(items: string[]) {
  return items.map((i) => `- ${i}`).join("\n");
}

/** Renders a playbook as instructions for an agent's system prompt. */
export function renderPlaybook(input: { name: string; motion: SalesMotion; spec: PlaybookSpec }): string {
  const { spec } = input;
  const parts: string[] = [
    `## Playbook: ${input.name}`,
    `Modelo de venta: ${SALES_MOTION_LABELS[input.motion]} (cliente ${spec.customerType.toUpperCase()}).`,
  ];
  if (spec.objective) parts.push(`Objetivo: ${spec.objective}`);
  parts.push(
    `Siguientes pasos permitidos, por orden de preferencia:\n${bullet(spec.nextSteps.map((s) => `${s}: ${NEXT_STEP_LABELS[s]}`))}`,
  );
  if (spec.segment.include.length) parts.push(`A quién nos dirigimos:\n${bullet(spec.segment.include)}`);
  if (spec.segment.exclude.length) parts.push(`A quién NO:\n${bullet(spec.segment.exclude)}`);
  if (spec.segment.geography.length) parts.push(`Zona: ${spec.segment.geography.join(", ")}`);
  if (spec.decisionMakers.length) parts.push(`Quién decide:\n${bullet(spec.decisionMakers)}`);
  if (spec.pains.length) parts.push(`Problemas que resolvemos:\n${bullet(spec.pains)}`);
  if (spec.valueProposition) parts.push(`Propuesta de valor: ${spec.valueProposition}`);
  if (spec.qualification.length) {
    parts.push(
      `Cualificación:\n${bullet(spec.qualification.map((q) => `${q.criterion}${q.required ? " (imprescindible)" : ""}`))}`,
    );
  }
  if (spec.disqualifiers.length) parts.push(`Descarta si:\n${bullet(spec.disqualifiers)}`);
  if (spec.requiredData.length) parts.push(`Datos que hay que reunir:\n${bullet(spec.requiredData)}`);
  if (spec.objections.length) {
    parts.push(
      `Objeciones habituales:\n${spec.objections.map((o) => `- «${o.objection}» → ${o.response}`).join("\n")}`,
    );
  }
  if (spec.rules.length) parts.push(`Reglas que no puedes saltarte:\n${bullet(spec.rules)}`);
  if (spec.handoff.length) parts.push(`Deriva a una persona cuando:\n${bullet(spec.handoff)}`);
  if (spec.tone) parts.push(`Tono: ${spec.tone}`);
  if (spec.signature) parts.push(`Firma de los emails:\n${spec.signature}`);
  parts.push(`Tiempo objetivo de respuesta: ${spec.responseTimeMinutes} minutos.`);
  return parts.join("\n\n");
}
