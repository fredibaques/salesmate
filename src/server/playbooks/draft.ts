import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { knowledgeSources, knowledgeTables, projects, type SalesMotion } from "../db/schema";
import { withTenant } from "../db/tenant";
import { searchKnowledge } from "../knowledge/service";
import type { LlmClient } from "../llm/client";
import {
  NEXT_STEPS,
  PLAYBOOK_TEMPLATES,
  SALES_MOTION_LABELS,
  playbookSpecSchema,
  type PlaybookSpec,
} from "./spec";

/**
 * Drafts a playbook from what the project already knows (description,
 * documents, tables). The result is a proposal the user reviews and saves as
 * a new version; nothing is activated automatically.
 */

const stringList = { type: "array", items: { type: "string" } } as const;

// Structured-output schema: every object closed and every field required.
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "objective",
    "customerType",
    "nextSteps",
    "segmentInclude",
    "segmentExclude",
    "geography",
    "decisionMakers",
    "pains",
    "valueProposition",
    "qualification",
    "disqualifiers",
    "requiredData",
    "objections",
    "rules",
    "handoff",
    "tone",
    "gaps",
  ],
  properties: {
    objective: { type: "string" },
    customerType: { type: "string", enum: ["b2b", "b2c"] },
    nextSteps: { type: "array", items: { type: "string", enum: [...NEXT_STEPS] } },
    segmentInclude: stringList,
    segmentExclude: stringList,
    geography: stringList,
    decisionMakers: stringList,
    pains: stringList,
    valueProposition: { type: "string" },
    qualification: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "required"],
        properties: { criterion: { type: "string" }, required: { type: "boolean" } },
      },
    },
    disqualifiers: stringList,
    requiredData: stringList,
    objections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objection", "response"],
        properties: { objection: { type: "string" }, response: { type: "string" } },
      },
    },
    rules: stringList,
    handoff: stringList,
    tone: { type: "string" },
    gaps: { ...stringList, description: "Información que falta y la persona debería aportar" },
  },
} as const;

const draftOutput = z.object({
  objective: z.string(),
  customerType: z.enum(["b2b", "b2c"]),
  nextSteps: z.array(z.enum(NEXT_STEPS)).min(1),
  segmentInclude: z.array(z.string()),
  segmentExclude: z.array(z.string()),
  geography: z.array(z.string()),
  decisionMakers: z.array(z.string()),
  pains: z.array(z.string()),
  valueProposition: z.string(),
  qualification: z.array(z.object({ criterion: z.string(), required: z.boolean() })),
  disqualifiers: z.array(z.string()),
  requiredData: z.array(z.string()),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
  rules: z.array(z.string()),
  handoff: z.array(z.string()),
  tone: z.string(),
  gaps: z.array(z.string()),
});

export async function draftPlaybook(
  deps: { db: Db; llm: LlmClient },
  tenant: { orgId: string },
  input: { projectId: string; salesMotion: SalesMotion; current?: PlaybookSpec; instructions?: string },
): Promise<{ spec: PlaybookSpec; gaps: string[] }> {
  const context = await withTenant(deps.db, tenant, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
    const tables = await tx
      .select({ name: knowledgeTables.name, columns: knowledgeTables.columns, source: knowledgeSources.name })
      .from(knowledgeTables)
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeTables.sourceId))
      .where(eq(knowledgeSources.projectId, input.projectId));
    return { project, tables };
  });
  if (!context.project) throw new Error("Proyecto no encontrado.");

  const queries = [
    "propuesta de valor servicios clientes",
    "objeciones precio competencia",
    "proceso de venta condiciones",
  ];
  const seen = new Set<string>();
  const excerpts: string[] = [];
  for (const query of queries) {
    for (const hit of await searchKnowledge(deps.db, tenant, {
      projectId: input.projectId,
      query,
      limit: 4,
    })) {
      if (seen.has(hit.chunkId)) continue;
      seen.add(hit.chunkId);
      excerpts.push(`[${hit.sourceName}] ${hit.content}`);
    }
  }

  const base = input.current ?? PLAYBOOK_TEMPLATES[input.salesMotion];
  const prompt = [
    `Prepara el playbook de ventas del proyecto «${context.project.name}» para un modelo de venta ${SALES_MOTION_LABELS[input.salesMotion]}.`,
    `Descripción del proyecto: ${context.project.description ?? "(sin descripción)"}. Web: ${context.project.website ?? "—"}.`,
    excerpts.length
      ? `Extractos de su conocimiento:\n${excerpts.join("\n---\n")}`
      : "El proyecto todavía no tiene documentos.",
    context.tables.length
      ? `Tablas disponibles (los precios deben salir de ellas, no los copies al playbook):\n${context.tables
          .map((t) => `- ${t.name} (${t.source}): ${t.columns.map((c) => c.label).join(", ")}`)
          .join("\n")}`
      : "",
    `Punto de partida (mejóralo, no lo repitas sin más):\n${JSON.stringify(base)}`,
    input.instructions ? `Indicaciones de la persona: ${input.instructions}` : "",
    "Usa solo lo que se deduce de esta información; no inventes datos concretos del negocio. Lo que falte, anótalo en gaps. Escribe en español, en frases cortas y accionables.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await deps.llm.create({
    max_tokens: 16_000,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "high", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no ha podido generar el borrador.");
  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const draft = draftOutput.parse(JSON.parse(text));

  const spec = playbookSpecSchema.parse({
    ...base,
    objective: draft.objective,
    customerType: draft.customerType,
    nextSteps: draft.nextSteps,
    segment: { include: draft.segmentInclude, exclude: draft.segmentExclude, geography: draft.geography },
    decisionMakers: draft.decisionMakers,
    pains: draft.pains,
    valueProposition: draft.valueProposition,
    qualification: draft.qualification,
    disqualifiers: draft.disqualifiers,
    requiredData: draft.requiredData,
    objections: draft.objections,
    rules: draft.rules,
    handoff: draft.handoff,
    tone: draft.tone,
  });
  return { spec, gaps: draft.gaps };
}
