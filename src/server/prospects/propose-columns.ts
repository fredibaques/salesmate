import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  COLUMN_TYPE_LABELS,
  COLUMN_TYPES,
  columnDraft,
  FILLED_BY,
  type ColumnDraft,
  type RowKind,
} from "@/lib/prospect-columns";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant } from "../db/tenant";
import type { LlmClient } from "../llm/client";
import { parseSalesProfile, renderSalesProfile } from "../playbooks/spec";

/** A column the AI proposes, and whether it recommends keeping it. */
export type ProposedColumn = ColumnDraft & { recommended: boolean };

const MAX_PROPOSALS = 12;

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: [...COLUMN_TYPES] },
          options: { type: "array", items: { type: "string" } },
          instructions: { type: "string" },
          filledBy: { type: "string", enum: [...FILLED_BY] },
          recommended: { type: "boolean" },
        },
        required: ["name", "type", "options", "instructions", "filledBy", "recommended"],
        additionalProperties: false,
      },
    },
  },
  required: ["columns"],
  additionalProperties: false,
} as const;

const proposalOutput = z.object({
  columns: z.array(z.object({ recommended: z.boolean().default(true) }).passthrough()),
});

/**
 * Columns for a new base, proposed from the project's offer and ideal
 * customer and what the person says they want to know. Each comes with
 * instructions for the agent; the person picks the ones to keep.
 */
export async function proposeColumns(
  deps: { db: Db; llm: LlmClient },
  tenant: { orgId: string },
  input: { projectId: string; rowKind: RowKind; name: string; brief?: string },
): Promise<ProposedColumn[]> {
  const [project] = await withTenant(deps.db, tenant, (tx) =>
    tx.select().from(projects).where(eq(projects.id, input.projectId)),
  );
  if (!project) throw new Error("Proyecto no encontrado.");
  const rows = input.rowKind === "person" ? "personas (con la empresa donde trabajan)" : "empresas";
  const prompt = [
    `Propón las columnas de una base de prospectos llamada «${input.name}» del proyecto «${project.name}». Cada fila es una de estas ${rows}. Un agente de IA rellenará las columnas buscando en fuentes públicas (webs de empresas, directorios, registros, noticias) y el equipo de ventas las usará para decidir a quién contactar y cómo.`,
    `## El proyecto\n${project.description ?? "(sin descripción)"}\nWeb: ${project.website ?? "—"}`,
    `## Oferta y cliente ideal\n${renderSalesProfile(parseSalesProfile(project.salesProfile))}`,
    input.brief ? `## Qué quiere saber la persona\n${input.brief}` : "",
    `## Cómo proponerlas
- Entre 6 y ${MAX_PROPOSALS} columnas, de las más útiles para cualificar y contactar a las menos.
- No incluyas lo que ya tiene toda fila: nombre${input.rowKind === "person" ? " de la persona, empresa" : ""}, web, puntuación de encaje, por qué encaja y fuentes.
- Tipos: ${COLUMN_TYPES.map((t) => `${t} (${COLUMN_TYPE_LABELS[t]})`).join(", ")}. Usa select o multi cuando los valores posibles se conocen de antemano, con sus opciones en options (si no, options vacío).
- instructions: qué poner y de dónde sacarlo, en una o dos frases para el agente. Si un dato suele no estar publicado, dilo y pide dejarlo vacío.
- filledBy: agent si se puede encontrar en fuentes públicas; person si solo lo sabe el equipo (notas, siguiente paso); both si el agente puede empezar y el equipo completar.
- Datos de contacto: solo los que se publican para ser contactado. Nada de datos personales privados.
- recommended: true para las imprescindibles; false para las útiles pero caras de conseguir o secundarias.
- Nombres cortos y en español.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await deps.llm.create({
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "low", format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no ha podido proponer columnas.");
  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const output = proposalOutput.parse(JSON.parse(text));

  // Keep what makes a valid column; a choice without options becomes text.
  const seen = new Set<string>();
  const proposals: ProposedColumn[] = [];
  for (const raw of output.columns) {
    const candidate = raw as Record<string, unknown>;
    const options = Array.isArray(candidate.options) ? candidate.options : [];
    const type =
      (candidate.type === "select" || candidate.type === "multi") && options.length === 0
        ? "text"
        : candidate.type;
    const parsed = columnDraft.safeParse({ ...candidate, type, options });
    if (!parsed.success) continue;
    const key = parsed.data.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({ ...parsed.data, recommended: raw.recommended });
    if (proposals.length === MAX_PROPOSALS) break;
  }
  return proposals;
}
