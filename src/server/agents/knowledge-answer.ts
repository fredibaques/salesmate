import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentRuns, knowledgeRows, knowledgeSources, knowledgeTables, projects } from "../db/schema";
import { withTenant } from "../db/tenant";
import { rowToText } from "../knowledge/tabular";
import { knowledgeOf } from "../knowledge/service";
import { runAgentLoop, type AgentLoopResult } from "../llm/agent-loop";
import type { LlmClient } from "../llm/client";
import { knowledgeTools } from "./tools";

export type KnowledgeAnswer = {
  answer: string;
  sources: { id: string; name: string; kind: string }[];
  status: AgentLoopResult["status"];
  costUsd: number;
};

/** Tables up to this size are put in the prompt whole, so prices are answered without searching. */
const INLINE_TABLE_ROWS = 120;
const INLINE_BUDGET_CHARS = 40_000;

/**
 * Answers a question about a project using only its knowledge: small tables
 * are read in full, documents are searched. The reply is short and says
 * which sources it comes from.
 */
export async function answerFromKnowledge(
  deps: { db: Db; llm: LlmClient },
  tenant: { orgId: string; userId: string },
  input: { projectId: string; question: string },
): Promise<KnowledgeAnswer> {
  const { project, sources, tables, run } = await withTenant(deps.db, tenant, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
    if (!project) throw new Error("Proyecto no encontrado.");
    const sources = await tx
      .select({ id: knowledgeSources.id, name: knowledgeSources.name, kind: knowledgeSources.kind })
      .from(knowledgeSources)
      .where(knowledgeOf(project.id))
      .orderBy(asc(knowledgeSources.createdAt));
    const tables =
      sources.length === 0
        ? []
        : await tx
            .select()
            .from(knowledgeTables)
            .where(
              inArray(
                knowledgeTables.sourceId,
                sources.map((s) => s.id),
              ),
            )
            .orderBy(asc(knowledgeTables.createdAt));
    const [run] = await tx
      .insert(agentRuns)
      .values({
        orgId: tenant.orgId,
        projectId: project.id,
        agentType: "copilot",
        trigger: "copilot",
        triggerRef: tenant.userId,
        model: deps.llm.model,
      })
      .returning();
    return { project, sources, tables, run };
  });

  // Short labels (S1, S2…) are easier for the model to cite than ids.
  const label = new Map(sources.map((s, i) => [s.id, `S${i + 1}`]));
  const byLabel = new Map(sources.map((s, i) => [`S${i + 1}`, s]));

  let budget = INLINE_BUDGET_CHARS;
  const inlined: string[] = [];
  for (const table of tables) {
    if (table.rowCount > INLINE_TABLE_ROWS) continue;
    const rows = await withTenant(deps.db, tenant, (tx) =>
      tx
        .select({ data: knowledgeRows.data })
        .from(knowledgeRows)
        .where(eq(knowledgeRows.tableId, table.id))
        .orderBy(asc(knowledgeRows.rowIndex)),
    );
    const text = [
      `### [${label.get(table.sourceId)}] Tabla «${table.name}»`,
      table.description ?? "",
      ...rows.map((r) => `- ${rowToText(table.columns, r.data)}`),
    ]
      .filter(Boolean)
      .join("\n");
    if (text.length > budget) continue;
    budget -= text.length;
    inlined.push(text);
  }

  const kindName: Record<string, string> = {
    document: "documento",
    table: "tabla",
    examples: "ejemplos",
    live: "fuente conectada",
  };
  const system = [
    `Respondes preguntas sobre el proyecto «${project.name}» usando solo su conocimiento: lo que la empresa ha subido (tarifas, presentaciones, condiciones…).`,
    `## Fuentes del proyecto\n${sources.map((s) => `- [${label.get(s.id)}] ${s.name} (${kindName[s.kind] ?? s.kind}, sourceId ${s.id})`).join("\n")}`,
    inlined.length ? `## Tablas (contenido completo)\n${inlined.join("\n\n")}` : "",
    `## Cómo respondes
- Primero mira las tablas de arriba. Si no basta, usa search_knowledge (busca en documentos y tablas) o query_table.
- Responde directamente a la pregunta, en español y en pocas frases. Si es un precio, da la cifra y de qué se compone, y di si lleva IVA o no cuando la fuente lo indique.
- No inventes nada. Si la respuesta no está en las fuentes, dilo y sugiere qué información faltaría subir.
- Termina siempre con una última línea con el formato exacto «Fuentes: S1, S3» con las fuentes que has usado (o «Fuentes: ninguna»).`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await runAgentLoop({
    llm: deps.llm,
    system,
    messages: [{ role: "user", content: input.question }],
    tools: knowledgeTools({ db: deps.db, orgId: tenant.orgId, projectId: project.id }),
    effort: "low",
    maxTurns: 6,
  });

  const { answer, cited } = splitSources(result.finalText);
  const sourcesUsed = cited
    .map((ref) => byLabel.get(ref) ?? sources.find((s) => s.id === ref))
    .filter((s): s is (typeof sources)[number] => Boolean(s));

  await withTenant(deps.db, tenant, (tx) =>
    tx
      .update(agentRuns)
      .set({
        status:
          result.status === "refused" ? "refused" : result.status === "completed" ? "completed" : "failed",
        model: result.model,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cacheReadTokens: result.usage.cacheRead,
        cacheWriteTokens: result.usage.cacheWrite,
        webSearches: result.usage.webSearches,
        costUsd: result.costUsd,
        steps: result.steps,
        summary: result.finalText,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id)),
  );

  return {
    answer:
      result.status === "refused"
        ? "No puedo responder a esta pregunta."
        : answer || "No he podido elaborar una respuesta.",
    sources: [...new Map(sourcesUsed.map((s) => [s.id, s])).values()],
    status: result.status,
    costUsd: result.costUsd,
  };
}

/** Separates the trailing «Fuentes: S1, S2» line from the answer. */
export function splitSources(text: string): { answer: string; cited: string[] } {
  const match = /\n?\s*\**Fuentes\**\s*:\s*([^\n]*)\s*$/i.exec(text.trim());
  if (!match) return { answer: text.trim(), cited: [] };
  const cited = match[1]
    .split(/[,;\s]+/)
    .map((s) => s.replace(/[[\]().*]/g, "").trim())
    .filter((s) => s && s.toLowerCase() !== "ninguna");
  return { answer: text.trim().slice(0, match.index).trim(), cited };
}
