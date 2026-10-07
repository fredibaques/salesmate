import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { ConnectorDeps } from "../connectors/service";
import type { McpDeps } from "../connectors/mcp";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, projects, type AgentRunStep } from "../db/schema";
import { withTenant } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { defineTool, runAgentLoop, type AgentLoopResult } from "../llm/agent-loop";
import type { LlmClient } from "../llm/client";
import { parseSalesProfile, renderSalesProfile } from "../playbooks/spec";
import { columnsPrompt, saveRowsSchema } from "../prospects/agent-schema";
import { ensureAgentBase } from "../prospects/bases";
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
      return "Queda menos de un minuto de esta ejecución. No busques más: guarda ahora con save_prospects las empresas que ya tengas confirmadas y termina con el resumen. Si no tienes ninguna confirmada, termina sin guardar.";
    }
    let lastSave = -1;
    steps.forEach((step, i) => {
      if (step.type === "tool_call" && step.name === "save_prospects") lastSave = i;
    });
    const webCalls = steps
      .slice(lastSave + 1)
      .filter((step) => step.type === "tool_call" && WEB_CALLS.has(step.name)).length;
    if (webCalls >= NUDGE_AFTER_WEB_CALLS && nudgedAt !== lastSave) {
      nudgedAt = lastSave;
      return `Llevas ${webCalls} búsquedas y lecturas sin guardar. Antes de seguir, guarda con save_prospects las empresas que ya tengas confirmadas: lo que no esté guardado se pierde si se acaba el tiempo.`;
    }
    return null;
  };
}

export type ProspectingResult = {
  runId: string;
  status: AgentLoopResult["status"] | "failed";
  added: number;
  summary: string;
  costUsd: number;
};

/**
 * One prospecting run: looks for companies that match the project's ideal
 * customer, following the agent's instructions, and adds the new ones to
 * the base it works on, with the values of its columns. Nothing is sent to anyone.
 */
export async function runProspecting(
  deps: AgentRunDeps,
  tenant: { orgId: string },
  input: { projectId: string; trigger: "schedule" | "manual"; triggerRef?: string },
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

  const target = agent.settings.prospectsPerRun ?? 10;
  const actor = { orgId: tenant.orgId, actorType: "agent" as const, actorId: run.id };
  // Where the findings go: the base the agent works on, with its columns.
  const base = await ensureAgentBase(deps.db, actor, agent.id);
  const known = await recentProspectNames(deps.db, tenant, base.id);
  let added = 0;

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
  const tools = [
    ...knowledgeTools(ctx),
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
        description: `Guarda filas en la base «${base.name}»: lo que encaja con el cliente ideal, con los valores de sus columnas en fields. Incluye en sources las URLs públicas de donde sale cada dato. Las repetidas se ignoran.`,
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
    ...(await mcpTools(ctx, agent.tools.mcp ?? [])),
  ];

  const system = [
    `Eres el agente de prospección del proyecto «${project.name}». Buscas empresas que podrían ser clientes y las guardas en su base de prospectos. No contactas con nadie.`,
    `## El proyecto\n${project.description ?? "(sin descripción)"}\nWeb: ${project.website ?? "—"}`,
    `## Oferta y cliente ideal\n${renderSalesProfile(parseSalesProfile(project.salesProfile))}`,
    agent.instructions ? `## Instrucciones de la persona responsable\n${agent.instructions}` : "",
    `## Cómo trabajas
- Objetivo de esta ejecución: ${target} prospectos nuevos que encajen de verdad. Mejor menos y buenos que muchos dudosos.
- ${!agent.tools.web ? "No tienes búsqueda web: usa solo las herramientas conectadas." : "Busca en la web y lee las páginas que encuentres (web_search, y web_fetch si lo tienes). Usa fuentes públicas: webs de empresas, directorios, asociaciones del sector, registros y noticias. No uses LinkedIn como fuente."}
- Antes de investigar a fondo, comprueba con check_prospects que no los tenemos ya.
- Trabaja por tandas de 2 o 3 empresas: encuéntralas, confirma sus datos y guárdalas con save_prospects antes de buscar las siguientes. Lo que no hayas guardado se pierde si se acaba el tiempo de la ejecución.
- Guarda con los datos que hayas podido confirmar y las URLs de donde salen. No inventes datos: si no encuentras un dato público, deja su columna vacía.
- Puntúa el encaje (fitScore 0-100) y explica en una frase por qué encaja (fitReason).
- Datos de contacto: solo los que la propia empresa publica para ser contactada (email y teléfono generales o de ventas). No recojas datos personales privados.
- Cuando llegues al objetivo o no encuentres más, termina con un resumen breve: cuántos has guardado, de qué tipo y qué fuentes han funcionado mejor.`,
    columnsPrompt(base),
    known.length
      ? `## Ya están en la base (no los repitas)\n${known.join("\n")}`
      : "## Ya están en la base\n(Todavía ninguno.)",
  ]
    .filter(Boolean)
    .join("\n\n");

  const local = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: project.timezone }).format(
    deps.now?.() ?? new Date(),
  );
  let status: ProspectingResult["status"] = "failed";
  let summary = "";
  let costUsd = 0;
  const deadline = startedAt + (deps.timeBudgetMs ?? RUN_TIME_BUDGET_MS);
  try {
    const result = await runAgentLoop({
      llm: deps.llm,
      system,
      messages: [
        {
          role: "user",
          content: `(${local}) Busca ${target} prospectos nuevos para el proyecto y guárdalos.`,
        },
      ],
      tools,
      serverTools: !agent.tools.web ? [] : webTools(SEARCHES_PER_TURN),
      effort: "medium",
      // Short turns: more of them fit in the budget.
      maxTurns: 40,
      deadline,
      steer: prospectingSteer({ deadline }),
    });
    status = result.status;
    // Out of time is a normal end: what was found is already saved.
    const outOfTime = result.status === "deadline";
    summary = outOfTime
      ? `Se acabó el tiempo de esta ejecución con ${added} prospectos guardados; la próxima seguirá buscando.`
      : result.finalText;
    costUsd = result.costUsd;
    await withTenant(deps.db, tenant, (tx) =>
      tx
        .update(agentRuns)
        .set({
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
          summary: (outOfTime ? summary : result.finalText) || `Prospectos guardados: ${added}.`,
          finishedAt: new Date(),
        })
        .where(eq(agentRuns.id, run.id)),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary = message;
    await withTenant(deps.db, tenant, (tx) =>
      tx
        .update(agentRuns)
        .set({ status: "failed", error: message, finishedAt: new Date() })
        .where(eq(agentRuns.id, run.id)),
    );
  }
  return { runId: run.id, status, added, summary, costUsd };
}
