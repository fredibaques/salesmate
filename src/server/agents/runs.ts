import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addWeeks, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
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

export type RunFilter = {
  projectId?: string;
  agentType?: AgentType;
  /** One agent (a project may have several of a kind). */
  agentId?: string;
  since?: Date;
  until?: Date;
};

const AGENT_LABELS: Record<string, string> = { copilot: "Copilot" };

function label(agentType: string, name: string | null) {
  if (agentType in AGENT_INFO) return agentName(agentType as ProjectAgentKey, name);
  return AGENT_LABELS[agentType] ?? agentType;
}

const where = (f: RunFilter, before?: Date) =>
  and(
    f.projectId ? eq(agentRuns.projectId, f.projectId) : undefined,
    f.agentType ? eq(agentRuns.agentType, f.agentType) : undefined,
    f.agentId ? eq(agentRuns.agentConfigId, f.agentId) : undefined,
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
        agentId: agentRuns.agentConfigId,
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
      .leftJoin(agentConfigs, eq(agentConfigs.id, agentRuns.agentConfigId))
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
        agentId: agentRuns.agentConfigId,
        agentName: agentConfigs.name,
        icon: agentConfigs.icon,
        color: agentConfigs.color,
        runs: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
        webSearches: sql<number>`coalesce(sum(${agentRuns.webSearches}), 0)::int`,
      })
      .from(agentRuns)
      .innerJoin(projects, eq(projects.id, agentRuns.projectId))
      .leftJoin(agentConfigs, eq(agentConfigs.id, agentRuns.agentConfigId))
      .where(where(filter))
      .groupBy(
        agentRuns.projectId,
        projects.name,
        agentRuns.agentType,
        agentRuns.agentConfigId,
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

export const COST_BUCKETS = ["day", "week", "month"] as const;
export type CostBucket = (typeof COST_BUCKETS)[number];

/** How many buckets the chart shows for each grouping. */
const BUCKET_COUNT: Record<CostBucket, number> = { day: 30, week: 12, month: 12 };

function bucketStart(bucket: CostBucket, date: Date) {
  if (bucket === "day") return startOfDay(date);
  if (bucket === "week") return startOfWeek(date, { weekStartsOn: 1 });
  return startOfMonth(date);
}

function shift(bucket: CostBucket, date: Date, n: number) {
  if (bucket === "day") return addDays(date, n);
  if (bucket === "week") return addWeeks(date, n);
  return addMonths(date, n);
}

/**
 * What the runs cost, by day, week or month (in the given time zone),
 * ending with the current one; buckets without runs are 0.
 */
export async function costSeries(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  input: { projectId?: string; bucket: CostBucket; timeZone: string; now?: number },
) {
  const count = BUCKET_COUNT[input.bucket];
  const current = bucketStart(input.bucket, new TZDate(input.now ?? Date.now(), input.timeZone));
  const first = shift(input.bucket, current, -(count - 1));
  const unit = sql.raw(`'${input.bucket}'`);
  const local = sql`(${agentRuns.startedAt} AT TIME ZONE ${input.timeZone})`;
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        key: sql<string>`to_char(date_trunc(${unit}, ${local}), 'YYYY-MM-DD')`,
        costUsd: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
        runs: sql<number>`count(*)::int`,
      })
      .from(agentRuns)
      .where(where({ projectId: input.projectId, since: new Date(first.getTime()) }))
      .groupBy(sql`1`),
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Array.from({ length: count }, (_, i) => {
    const start = shift(input.bucket, first, i);
    const key = format(start, "yyyy-MM-dd");
    const row = byKey.get(key);
    return {
      key,
      start: new Date(start.getTime()),
      costUsd: Number(row?.costUsd ?? 0),
      runs: row?.runs ?? 0,
    };
  });
}
