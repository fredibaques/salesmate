import { TZDate } from "@date-fns/tz";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { AGENT_INFO, agentName, type ProjectAgentKey } from "@/lib/agents";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, projects, type AgentType } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { costBreakdown } from "../llm/client";

/**
 * The agents' runs, as a log: what started each one, how it ended, how
 * long it took and what it cost, item by item. For one agent (its «Log»
 * tab) or the whole organization (Configuración → Ejecuciones).
 */

/** The first moment of this month (or `offset` months away) in a time zone. */
export function monthStart(timeZone: string, offset = 0, now = Date.now()) {
  const today = new TZDate(now, timeZone);
  return new TZDate(today.getFullYear(), today.getMonth() + offset, 1, timeZone);
}

export type RunFilter = { projectId?: string; agentType?: AgentType; since?: Date; until?: Date };

const AGENT_LABELS: Record<string, string> = { copilot: "Copilot" };

function label(agentType: string, name: string | null) {
  if (agentType in AGENT_INFO) return agentName(agentType as ProjectAgentKey, name);
  return AGENT_LABELS[agentType] ?? agentType;
}

const where = (f: RunFilter, before?: Date) =>
  and(
    f.projectId ? eq(agentRuns.projectId, f.projectId) : undefined,
    f.agentType ? eq(agentRuns.agentType, f.agentType) : undefined,
    f.since ? gte(agentRuns.startedAt, f.since) : undefined,
    before ? lt(agentRuns.startedAt, before) : undefined,
    f.until ? lt(agentRuns.startedAt, f.until) : undefined,
  );

export async function listRuns(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  filter: RunFilter & { before?: Date; limit?: number } = {},
) {
  const limit = filter.limit ?? 50;
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: agentRuns.id,
        projectId: agentRuns.projectId,
        projectName: projects.name,
        agentType: agentRuns.agentType,
        agentName: agentConfigs.name,
        icon: agentConfigs.icon,
        color: agentConfigs.color,
        trigger: agentRuns.trigger,
        status: agentRuns.status,
        model: agentRuns.model,
        inputTokens: agentRuns.inputTokens,
        outputTokens: agentRuns.outputTokens,
        cacheReadTokens: agentRuns.cacheReadTokens,
        cacheWriteTokens: agentRuns.cacheWriteTokens,
        webSearches: agentRuns.webSearches,
        costUsd: agentRuns.costUsd,
        summary: agentRuns.summary,
        error: agentRuns.error,
        steps: sql<number>`jsonb_array_length(${agentRuns.steps})`,
        startedAt: agentRuns.startedAt,
        finishedAt: agentRuns.finishedAt,
      })
      .from(agentRuns)
      .innerJoin(projects, eq(projects.id, agentRuns.projectId))
      .leftJoin(
        agentConfigs,
        and(eq(agentConfigs.projectId, agentRuns.projectId), eq(agentConfigs.agentType, agentRuns.agentType)),
      )
      .where(where(filter, filter.before))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit + 1),
  );
  return {
    runs: rows.slice(0, limit).map((r) => ({
      ...r,
      label: label(r.agentType, r.agentName),
      steps: Number(r.steps),
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      cost: costBreakdown(
        r.model,
        {
          input: r.inputTokens,
          output: r.outputTokens,
          cacheRead: r.cacheReadTokens,
          cacheWrite: r.cacheWriteTokens,
          webSearches: r.webSearches,
        },
        r.costUsd,
      ),
    })),
    /** Where the next page starts, if there is one. */
    next: rows.length > limit ? rows[limit - 1].startedAt : null,
  };
}
export type RunLogRow = Awaited<ReturnType<typeof listRuns>>["runs"][number];

/** Runs and spending since a date, in total and by agent (the most expensive first). */
export async function runTotals(db: Db, tenant: Pick<TenantContext, "orgId">, filter: RunFilter) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        projectId: agentRuns.projectId,
        projectName: projects.name,
        agentType: agentRuns.agentType,
        agentName: agentConfigs.name,
        icon: agentConfigs.icon,
        color: agentConfigs.color,
        runs: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
        webSearches: sql<number>`coalesce(sum(${agentRuns.webSearches}), 0)::int`,
      })
      .from(agentRuns)
      .innerJoin(projects, eq(projects.id, agentRuns.projectId))
      .leftJoin(
        agentConfigs,
        and(eq(agentConfigs.projectId, agentRuns.projectId), eq(agentConfigs.agentType, agentRuns.agentType)),
      )
      .where(where(filter))
      .groupBy(
        agentRuns.projectId,
        projects.name,
        agentRuns.agentType,
        agentConfigs.name,
        agentConfigs.icon,
        agentConfigs.color,
      ),
  );
  const byAgent = rows
    .map((r) => ({ ...r, label: label(r.agentType, r.agentName), costUsd: Number(r.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
  return {
    runs: byAgent.reduce((n, r) => n + r.runs, 0),
    costUsd: byAgent.reduce((n, r) => n + r.costUsd, 0),
    byAgent,
  };
}

/** One run with its steps (what the agent did, tool by tool). */
export async function getRun(db: Db, tenant: Pick<TenantContext, "orgId">, runId: string) {
  const [run] = await withTenant(db, tenant, (tx) =>
    tx.select().from(agentRuns).where(eq(agentRuns.id, runId)),
  );
  return run ?? null;
}
