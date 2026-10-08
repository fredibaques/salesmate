import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { agentConfigs, agentEvents, agentRuns, projects, type AgentEventKind } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import type { LlmClient } from "../llm/client";
import { runProspecting, type AgentRunDeps, type ProspectingResult } from "./prospector";

/**
 * Event triggers: besides its schedule and «Ejecutar ahora», an agent works
 * when something happens. Events are stored first (agent_events) and then
 * processed: right away when possible, otherwise by the scheduler's next
 * pass (the agent was busy, or the process was cut off).
 */

/** Pending events kept per agent; beyond this, new ones are dropped. */
const MAX_PENDING = 50;
/** Events handled by one run. */
const EVENTS_PER_RUN = 20;
/** A run still "running" after this long is not blocking anything. */
const BUSY_MS = 10 * 60_000;

const TRIGGER_FOR: Record<AgentEventKind, "newRows" | "webhook"> = {
  new_rows: "newRows",
  webhook: "webhook",
};

/**
 * Stores an event for the agent if it listens to that kind (its trigger is
 * on). Returns whether it was stored.
 */
export async function recordAgentEvent(
  db: AgentRunDeps["db"],
  tenant: { orgId: string },
  input: { agentConfigId: string; kind: AgentEventKind; payload: Record<string, unknown> },
): Promise<boolean> {
  return withTenant(db, tenant, async (tx) => {
    const [agent] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, input.agentConfigId));
    if (!agent?.addedAt || !agent.settings.triggers?.[TRIGGER_FOR[input.kind]]) return false;
    const [pending] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(agentEvents)
      .where(and(eq(agentEvents.agentConfigId, agent.id), isNull(agentEvents.processedAt)));
    if (Number(pending?.n ?? 0) >= MAX_PENDING) return false;
    await tx.insert(agentEvents).values({
      orgId: tenant.orgId,
      projectId: agent.projectId,
      agentConfigId: agent.id,
      kind: input.kind,
      payload: input.payload,
    });
    return true;
  });
}

/** Rows a person added to a base: an event for the agent that fills it, if it listens. */
export async function rowsAdded(
  db: AgentRunDeps["db"],
  tenant: { orgId: string },
  input: { baseId: string; rowIds: string[] },
): Promise<string | null> {
  if (!input.rowIds.length) return null;
  const agents = await withTenant(db, tenant, (tx) =>
    tx
      .select({ id: agentConfigs.id })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.prospectBaseId, input.baseId), isNotNull(agentConfigs.addedAt))),
  );
  for (const agent of agents) {
    if (
      await recordAgentEvent(db, tenant, {
        agentConfigId: agent.id,
        kind: "new_rows",
        payload: { rowIds: input.rowIds },
      })
    )
      return agent.id;
  }
  return null;
}

/** The agent behind a webhook token (any organization), or null. */
export async function agentByHookToken(db: AgentRunDeps["db"], token: string) {
  if (token.length < 20) return null;
  const [agent] = await withSystem(db, (tx) =>
    tx
      .select({ id: agentConfigs.id, orgId: agentConfigs.orgId, settings: agentConfigs.settings })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.hookToken, token), isNotNull(agentConfigs.addedAt))),
  );
  return agent ?? null;
}

export type EventRunOutcome =
  { status: "ran"; result: ProspectingResult; events: number } | { status: "idle" | "busy" | "paused" };

/**
 * Runs the agent on its pending events, if it can work now: it is active,
 * its project isn't paused and it isn't already working. The events are
 * claimed first, so two calls never handle the same ones.
 */
export async function processAgentEvents(
  deps: AgentRunDeps,
  tenant: { orgId: string },
  agentConfigId: string,
): Promise<EventRunOutcome> {
  const now = deps.now?.() ?? new Date();
  const state = await withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .select({ agent: agentConfigs, project: projects })
      .from(agentConfigs)
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(eq(agentConfigs.id, agentConfigId));
    if (!row?.agent.addedAt || !row.agent.enabled || row.project.agentsPaused) return null;
    const [last] = await tx
      .select({ status: agentRuns.status, startedAt: agentRuns.startedAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, row.agent.projectId), eq(agentRuns.agentType, row.agent.agentType)))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);
    const busy = last?.status === "running" && now.getTime() - last.startedAt.getTime() < BUSY_MS;
    return { agent: row.agent, busy };
  });
  if (!state) return { status: "paused" };
  if (state.busy) return { status: "busy" };

  const claimed = await withTenant(deps.db, tenant, async (tx) => {
    const ids = await tx
      .select({ id: agentEvents.id })
      .from(agentEvents)
      .where(and(eq(agentEvents.agentConfigId, agentConfigId), isNull(agentEvents.processedAt)))
      .orderBy(asc(agentEvents.createdAt))
      .limit(EVENTS_PER_RUN);
    if (!ids.length) return [];
    return tx
      .update(agentEvents)
      .set({ processedAt: now })
      .where(
        and(
          inArray(
            agentEvents.id,
            ids.map((r) => r.id),
          ),
          isNull(agentEvents.processedAt),
        ),
      )
      .returning();
  });
  if (!claimed.length) return { status: "idle" };

  const result = await runProspecting(deps, tenant, {
    projectId: state.agent.projectId,
    trigger: "event",
    triggerRef: [...new Set(claimed.map((e) => e.kind))].join(","),
    events: claimed.map((e) => ({ kind: e.kind, payload: e.payload })),
  });
  await withTenant(deps.db, tenant, (tx) =>
    tx
      .update(agentEvents)
      .set({ runId: result.runId })
      .where(
        inArray(
          agentEvents.id,
          claimed.map((e) => e.id),
        ),
      ),
  );
  return { status: "ran", result, events: claimed.length };
}

/** Agents with pending events that may work now, across organizations (scheduler). */
export async function agentsWithPendingEvents(db: AgentRunDeps["db"]) {
  return withSystem(db, (tx) =>
    tx
      .selectDistinct({ agentConfigId: agentEvents.agentConfigId, orgId: agentEvents.orgId })
      .from(agentEvents)
      .innerJoin(agentConfigs, eq(agentConfigs.id, agentEvents.agentConfigId))
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(
        and(
          isNull(agentEvents.processedAt),
          eq(agentConfigs.enabled, true),
          isNotNull(agentConfigs.addedAt),
          eq(projects.agentsPaused, false),
        ),
      ),
  );
}

/** Processes pending events of every agent (scheduler pass), up to `limit` runs. */
export async function runPendingEvents(
  deps: Omit<AgentRunDeps, "llm"> & { llmFor: (orgId: string) => Promise<LlmClient | null> },
  options: { limit?: number } = {},
) {
  const pending = await agentsWithPendingEvents(deps.db);
  // In parallel, like scheduled runs: each has its own time budget.
  return Promise.all(
    pending.slice(0, options.limit ?? 2).map(async ({ agentConfigId, orgId }) => {
      const llm = await deps.llmFor(orgId);
      if (!llm) return { agentConfigId, outcome: "no_ai" as const };
      const outcome = await processAgentEvents({ ...deps, llm }, { orgId }, agentConfigId);
      return { agentConfigId, outcome: outcome.status };
    }),
  );
}
