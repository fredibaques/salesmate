import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { ConnectorDeps } from "../connectors/service";
import type { McpDeps } from "../connectors/mcp";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, projects, type AgentRunStep, type ProspectingMode } from "../db/schema";
import { withTenant } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { defineTool, runAgentLoop, type AgentLoopResult } from "../llm/agent-loop";
import type { LlmClient } from "../llm/client";
import { parseSalesProfile, renderSalesProfile } from "../playbooks/spec";
import {
  columnsPrompt,
  completeRowsSchema,
  completionPrompt,
  saveRowsSchema,
} from "../prospects/agent-schema";
import { ensureAgentBase } from "../prospects/bases";
import { completeProspects, rowsToComplete } from "../prospects/complete";
import { knownProspects, prospectInput, recentProspectNames, saveProspects } from "../prospects/service";
import { knowledgeTools, mcpTools, webTools, type AgentToolContext } from "./tools";

export type AgentRunDeps = {
  db: Db;
  llm: LlmClient;
  gateway: GatewayDeps;
  connectors?: Omit<ConnectorDeps, "db">;
  mcp?: McpDeps;
  now?: () => Date;
  /**
   * Time the run may take before it stops starting new turns. Vercel cuts a
   * function off at 300 s; the last turn (searches included) needs headroom.
   */
  timeBudgetMs?: number;
};

/** Default time budget of a run, well under the 300 s a serverless function gets. */
export const RUN_TIME_BUDGET_MS = 170_000;

/**
 * Searches per request. Searches run on the provider's side within one
 * request, so a high cap let a single turn outlast the whole budget with
 * nothing saved; a low one hands control back often.
 */
const SEARCHES_PER_TURN = 3;
/** Web searches and page reads in a row without saving before the agent is asked to save. */
const NUDGE_AFTER_WEB_CALLS = 8;
/** Time left when the agent is asked to stop searching and save what it has. */
const WRAP_UP_MS = 45_000;

const WEB_CALLS = new Set(["web_search", "web_fetch"]);

/** Tools that save what the agent found: new rows, or values for existing ones. */
const SAVE_TOOLS = new Set(["save_prospects", "update_prospects"]);

/**
 * What to tell the agent between turns so findings get saved as it goes:
 * near the end of the budget, stop and save; after a run of searches
 * without saving, save before going on. Each note is said once per streak.
 */
export function prospectingSteer(options: { deadline: number; now?: () => number }) {
  let wrappedUp = false;
  /** Index of the save that started the streak already nudged about (-1: before any save). */
  let nudgedAt: number | null = null;
  return ({ steps }: { steps: readonly AgentRunStep[] }): string | null => {
    const now = (options.now ?? Date.now)();
    if (!wrappedUp && options.deadline - now <= WRAP_UP_MS) {
      wrappedUp = true;
      return "Queda menos de un minuto de esta ejecución. No busques más: guarda ahora lo que ya tengas confirmado (save_prospects para filas nuevas, update_prospects para completar filas) y termina con el resumen. Si no tienes nada confirmado, termina sin guardar.";
    }
    let lastSave = -1;
    steps.forEach((step, i) => {
      if (step.type === "tool_call" && SAVE_TOOLS.has(step.name)) lastSave = i;
    });
    const webCalls = steps
      .slice(lastSave + 1)
      .filter((step) => step.type === "tool_call" && WEB_CALLS.has(step.name)).length;
    if (webCalls >= NUDGE_AFTER_WEB_CALLS && nudgedAt !== lastSave) {
      nudgedAt = lastSave;
      return `Llevas ${webCalls} búsquedas y lecturas sin guardar. Antes de seguir, guarda lo que ya tengas confirmado (save_prospects o update_prospects): lo que no esté guardado se pierde si se acaba el tiempo.`;
    }
    return null;
  };
}

export type ProspectingResult = {
  runId: string;
  status: AgentLoopResult["status"] | "failed";
  /** New rows saved. */
  added: number;
  /** Empty cells of existing rows filled. */
  completed: number;
  summary: string;
  costUsd: number;
};

/** Default cap of empty cells to fill per run. */
export const DEFAULT_CELLS_PER_RUN = 20;
/** Cap when a person asks to complete specific rows. */
const ROWS_CELL_CAP = 100;

/**
 * One prospecting run on the base the agent works on. Depending on its mode
 * it looks for new companies (or people) that match the ideal customer,
 * fills the empty cells of rows already there, or both. Nothing is sent to anyone.
 */
export async function runProspecting(
  deps: AgentRunDeps,
  tenant: { orgId: string },
  input: {
    projectId: string;
    trigger: "schedule" | "manual";
    triggerRef?: string;
    /** Overrides the agent's mode for this run (e.g. «Completar vacíos»). */
    mode?: ProspectingMode;
    /** Complete only these rows (implies the complete mode). */
    rowIds?: string[];
  },
): Promise<ProspectingResult> {
  const startedAt = Date.now();
  const { project, agent, run } = await withTenant(deps.db, tenant, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
    if (!project) throw new Error("Proyecto no encontrado.");
    const [agent] = await tx
      .select()
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.projectId, project.id),
          eq(agentConfigs.agentType, "outbound"),
          isNotNull(agentConfigs.addedAt),
        ),
      );
    if (!agent) throw new Error("Este proyecto no tiene agente de prospección.");
    const [run] = await tx
      .insert(agentRuns)
      .values({
        orgId: tenant.orgId,
        projectId: project.id,
        agentType: "outbound",
        trigger: input.trigger,
        triggerRef: input.triggerRef,
        model: deps.llm.model,
      })
      .returning();
    await audit(
      tx,
      { orgId: tenant.orgId, actorType: "agent", actorId: run.id },
      {
        event: "agent.run_started",
        projectId: project.id,
        entityType: "agent_run",
        entityId: run.id,
        data: { agentType: "outbound", trigger: input.trigger },
      },
    );
    return { project, agent, run };
  });

  const finish = (values: Partial<typeof agentRuns.$inferInsert>) =>
    withTenant(deps.db, tenant, (tx) =>
      tx
        .update(agentRuns)
        .set({ ...values, finishedAt: new Date() })
        .where(eq(agentRuns.id, run.id)),
    );

  const target = agent.settings.prospectsPerRun ?? 10;
  const actor = { orgId: tenant.orgId, actorType: "agent" as const, actorId: run.id };
  let added = 0;
  let completed = 0;
  try {
    // Where the findings go: the base the agent works on, with its columns.
    const base = await ensureAgentBase(deps.db, actor, agent.id);
    let mode: ProspectingMode = input.rowIds?.length
      ? "complete"
      : (input.mode ?? agent.settings.mode ?? "find");
    const work =
      mode === "find"
        ? { rows: [], cells: 0 }
        : await rowsToComplete(deps.db, tenant, base.id, {
            limit: input.rowIds?.length
              ? ROWS_CELL_CAP
              : (agent.settings.cellsPerRun ?? DEFAULT_CELLS_PER_RUN),
            rowIds: input.rowIds,
          });
    if (work.rows.length === 0 && mode === "complete") {
      const summary = "No hay celdas por completar: no ha hecho falta buscar nada.";
      await finish({ status: "completed", summary, costUsd: 0 });
      return { runId: run.id, status: "completed", added, completed, summary, costUsd: 0 };
    }
    if (work.rows.length === 0) mode = "find";
    const finds = mode !== "complete";
    const completes = work.rows.length > 0;
    // Short references for the rows to complete: models copy them better than ids.
    const refs = new Map(work.rows.map((r, i) => [`F${i + 1}`, r.id]));
    const known = finds ? await recentProspectNames(deps.db, tenant, base.id) : [];

    const ctx: AgentToolContext = {
      db: deps.db,
      orgId: tenant.orgId,
      projectId: project.id,
      agentType: "outbound",
      runId: run.id,
      gateway: deps.gateway,
      connectors: deps.connectors,
      mcp: deps.mcp,
      timezone: project.timezone,
      now: deps.now,
    };

    const candidate = z.object({
      companyName: z.string(),
      personName: z.string().optional(),
      website: z.string().optional(),
      city: z.string().optional(),
    });
    const findTools = [
      defineTool({
        name: "check_prospects",
        description:
          "Comprueba cuáles de estas empresas (o personas) ya están en la base (por web, o por nombre y ciudad). Úsalo antes de investigar a fondo.",
        input: z.object({ companies: z.array(candidate).min(1).max(50) }),
        run: async ({ companies }) => ({
          alreadyKnown: await knownProspects(deps.db, tenant, base.id, companies),
        }),
      }),
      {
        ...defineTool({
          name: "save_prospects",
          description: `Guarda filas nuevas en la base «${base.name}»: lo que encaja con el cliente ideal, con los valores de sus columnas en fields y la URL de cada valor en fieldSources. Incluye en sources las URLs públicas de donde sale la fila. Las repetidas se ignoran.`,
          input: z.object({ prospects: z.array(prospectInput).min(1).max(25) }),
          run: async ({ prospects }) => {
            const result = await saveProspects(deps.db, actor, {
              baseId: base.id,
              agentConfigId: agent.id,
              runId: run.id,
              items: prospects,
            });
            added += result.added.length;
            return {
              saved: result.added.map((p) => p.personName ?? p.companyName),
              alreadyKnown: result.duplicates,
              invalid: result.invalid,
              // Values left out because they didn't fit their column: fix them in the next batch.
              fieldErrors: result.fieldErrors.slice(0, 20),
              savedThisRun: added,
              target,
            };
          },
        }),
        // The model sees the base's own columns, with their types and instructions.
        jsonSchema: saveRowsSchema(base.rowKind, base.columns),
      },
    ];
    const completeTools = [
      {
        ...defineTool({
          name: "update_prospects",
          description: `Guarda los valores que faltaban en filas que ya están en la base «${base.name}», por su referencia (F1, F2…). Solo rellena celdas vacías: las que ya tienen valor o ha escrito una persona no cambian.`,
          input: z.object({
            rows: z
              .array(
                z.object({
                  ref: z.string(),
                  fields: z.record(z.string(), z.unknown()).default({}),
                  fieldSources: z.record(z.string(), z.string()).default({}),
                  notFound: z.array(z.string()).default([]),
                }),
              )
              .min(1)
              .max(25),
          }),
          run: async ({ rows }) => {
            const unknownRefs = rows.filter((r) => !refs.has(r.ref.trim().toUpperCase())).map((r) => r.ref);
            const result = await completeProspects(deps.db, actor, {
              baseId: base.id,
              runId: run.id,
              items: rows
                .filter((r) => refs.has(r.ref.trim().toUpperCase()))
                .map((r) => ({
                  id: refs.get(r.ref.trim().toUpperCase())!,
                  fields: r.fields,
                  notFound: r.notFound,
                  sources: r.fieldSources,
                })),
            });
            completed += result.filled;
            return {
              filled: result.filled,
              notFound: result.notFound,
              keptAsTheyWere: result.kept.slice(0, 20),
              fieldErrors: result.fieldErrors.slice(0, 20),
              unknownRefs,
              filledThisRun: completed,
              cellsToFill: work.cells,
            };
          },
        }),
        jsonSchema: completeRowsSchema(base.columns),
      },
    ];
    const tools = [
      ...knowledgeTools(ctx),
      ...(finds ? findTools : []),
      ...(completes ? completeTools : []),
      ...(await mcpTools(ctx, agent.tools.mcp ?? [])),
    ];

    const what = base.rowKind === "person" ? "personas" : "empresas";
    const task = [
      completes
        ? `completas los datos que faltan en las filas de su base de prospectos${finds ? " y buscas" : ""}`
        : "buscas",
      finds
        ? ` ${base.rowKind === "person" ? "personas de empresas que podrían ser clientes (quienes deciden o influyen en la compra)" : "empresas que podrían ser clientes"} para guardarlas en ella`
        : "",
    ].join("");
    const system = [
      `Eres el agente de prospección del proyecto «${project.name}»: ${task}. No contactas con nadie.`,
      `## El proyecto\n${project.description ?? "(sin descripción)"}\nWeb: ${project.website ?? "—"}`,
      `## Oferta y cliente ideal\n${renderSalesProfile(parseSalesProfile(project.salesProfile))}`,
      agent.instructions ? `## Instrucciones de la persona responsable\n${agent.instructions}` : "",
      `## Cómo trabajas
${[
  completes && finds
    ? `- Primero completa las filas pendientes (abajo, ${work.cells} celdas). Después busca ${target} ${what} nuevas que encajen de verdad.`
    : completes
      ? `- Objetivo de esta ejecución: completar las filas pendientes de abajo (${work.cells} celdas).`
      : `- Objetivo de esta ejecución: ${target} prospectos nuevos que encajen de verdad. Mejor menos y buenos que muchos dudosos.`,
  !agent.tools.web
    ? "- No tienes búsqueda web: usa solo las herramientas conectadas."
    : "- Busca en la web y lee las páginas que encuentres (web_search, y web_fetch si lo tienes). Usa fuentes públicas: webs de empresas, directorios, asociaciones del sector, registros y noticias. No uses LinkedIn como fuente.",
  finds
    ? "- Antes de investigar a fondo una empresa nueva, comprueba con check_prospects que no la tenemos ya."
    : "",
  "- Trabaja por tandas de 2 o 3 filas: confirma sus datos y guárdalos antes de seguir con las siguientes. Lo que no hayas guardado se pierde si se acaba el tiempo de la ejecución.",
  "- Guarda solo datos que hayas podido confirmar, cada uno con la URL de donde sale. No inventes datos: si no encuentras un dato público, déjalo vacío.",
  finds
    ? "- Puntúa el encaje de cada fila nueva (fitScore 0-100) y explica en una frase por qué encaja (fitReason)."
    : "",
  "- Datos de contacto: solo los que se publican para ser contactado (email y teléfono generales o de ventas). No recojas datos personales privados.",
  "- Cuando termines o no encuentres más, acaba con un resumen breve: qué has guardado o completado y qué fuentes han funcionado mejor.",
]
  .filter(Boolean)
  .join("\n")}`,
      columnsPrompt(base),
      completes
        ? completionPrompt(
            base,
            work.rows.map((r, i) => ({ ...r, ref: `F${i + 1}` })),
            work.cells,
          )
        : "",
      finds
        ? known.length
          ? `## Ya están en la base (no los repitas)\n${known.join("\n")}`
          : "## Ya están en la base\n(Todavía ninguno.)"
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const local = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: project.timezone }).format(
      deps.now?.() ?? new Date(),
    );
    const ask = completes
      ? finds
        ? `Completa las filas pendientes y busca ${target} prospectos nuevos para el proyecto.`
        : "Completa los datos que faltan en las filas pendientes."
      : `Busca ${target} prospectos nuevos para el proyecto y guárdalos.`;
    const deadline = startedAt + (deps.timeBudgetMs ?? RUN_TIME_BUDGET_MS);
    const result = await runAgentLoop({
      llm: deps.llm,
      system,
      messages: [{ role: "user", content: `(${local}) ${ask}` }],
      tools,
      serverTools: !agent.tools.web ? [] : webTools(SEARCHES_PER_TURN),
      effort: "medium",
      // Short turns: more of them fit in the budget.
      maxTurns: 40,
      deadline,
      steer: prospectingSteer({ deadline }),
    });
    // Out of time is a normal end: what was found is already saved.
    const outOfTime = result.status === "deadline";
    const tally = [
      finds ? `${added} prospectos nuevos` : null,
      completes ? `${completed} celdas completadas` : null,
    ]
      .filter(Boolean)
      .join(" y ");
    const summary = outOfTime
      ? `Se acabó el tiempo de esta ejecución con ${tally}; la próxima seguirá.`
      : result.finalText || `Guardado: ${tally}.`;
    await finish({
      status:
        result.status === "refused"
          ? "refused"
          : result.status === "completed" || outOfTime
            ? "completed"
            : "failed",
      model: result.model,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheReadTokens: result.usage.cacheRead,
      costUsd: result.costUsd,
      steps: result.steps,
      summary,
    });
    return { runId: run.id, status: result.status, added, completed, summary, costUsd: result.costUsd };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: message });
    return { runId: run.id, status: "failed", added, completed, summary: message, costUsd: 0 };
  }
}
