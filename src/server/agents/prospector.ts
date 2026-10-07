import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { ConnectorDeps } from "../connectors/service";
import type { McpDeps } from "../connectors/mcp";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, projects } from "../db/schema";
import { withTenant } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { defineTool, runAgentLoop, type AgentLoopResult } from "../llm/agent-loop";
import type { LlmClient } from "../llm/client";
import { parseSalesProfile, renderSalesProfile } from "../playbooks/spec";
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
 * the project's prospects. Nothing is sent to anyone.
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
  const known = await recentProspectNames(deps.db, tenant, project.id);
  const actor = { orgId: tenant.orgId, actorType: "agent" as const, actorId: run.id };
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
    website: z.string().optional(),
    city: z.string().optional(),
  });
  const tools = [
    ...knowledgeTools(ctx),
    defineTool({
      name: "check_prospects",
      description:
        "Comprueba cuáles de estas empresas ya están en la base de prospectos del proyecto (por web, o por nombre y ciudad). Úsalo antes de investigar a fondo una empresa.",
      input: z.object({ companies: z.array(candidate).min(1).max(50) }),
      run: async ({ companies }) => ({
        alreadyKnown: await knownProspects(deps.db, tenant, project.id, companies),
      }),
    }),
    defineTool({
      name: "save_prospects",
      description:
        "Guarda empresas que encajan con el cliente ideal en la base de prospectos del proyecto. Incluye en sources las URLs públicas de donde sale cada dato. Las repetidas se ignoran.",
      input: z.object({ prospects: z.array(prospectInput).min(1).max(25) }),
      run: async ({ prospects }) => {
        const result = await saveProspects(deps.db, actor, {
          projectId: project.id,
          agentConfigId: agent.id,
          runId: run.id,
          items: prospects,
        });
        added += result.added.length;
        return {
          saved: result.added.map((p) => p.companyName),
          alreadyKnown: result.duplicates,
          invalid: result.invalid,
          savedThisRun: added,
          target,
        };
      },
    }),
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
- Guarda con save_prospects en tandas, con los datos que hayas podido confirmar y las URLs de donde salen. No inventes datos: si no encuentras un teléfono o un email públicos, déjalos vacíos.
- Puntúa el encaje (fitScore 0-100) y explica en una frase por qué encaja (fitReason).
- Datos de contacto: solo los que la propia empresa publica para ser contactada (email y teléfono generales o de ventas). No recojas datos personales privados.
- Cuando llegues al objetivo o no encuentres más, termina con un resumen breve: cuántos has guardado, de qué tipo y qué fuentes han funcionado mejor.`,
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
      serverTools: !agent.tools.web ? [] : webTools(Math.max(5, target * 2)),
      effort: "medium",
      maxTurns: 30,
      deadline: startedAt + (deps.timeBudgetMs ?? RUN_TIME_BUDGET_MS),
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
