import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { agentConfigs, agentRuns, projects, type AgentSchedule } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import type { LlmClient } from "../llm/client";
import { runProspecting, type AgentRunDeps, type ProspectingResult } from "./prospector";

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Calendar date, weekday (1 = Monday) and "HH:MM" of an instant in a time zone. */
export function localClock(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Due when today is one of its days, its time has passed and it hasn't run today. */
export function isDue(schedule: AgentSchedule, lastRunAt: Date | null, now: Date, timeZone: string): boolean {
  const today = localClock(now, timeZone);
  if (!schedule.days.includes(today.weekday)) return false;
  if (today.time < schedule.time) return false;
  return !lastRunAt || localClock(lastRunAt, timeZone).date < today.date;
}

/** A run still "running" after this long was cut off by the platform. */
const STALE_RUN_MS = 10 * 60_000;

/** Closes runs the platform cut off before they could finish, so nobody waits for them. */
export async function closeStaleRuns(db: AgentRunDeps["db"], now: Date): Promise<number> {
  const rows = await withSystem(db, (tx) =>
    tx
      .update(agentRuns)
      .set({
        status: "failed",
        error: "Interrumpida: el servidor la cortó antes de terminar. Lo que ya había guardado se conserva.",
        finishedAt: now,
      })
      .where(
        and(eq(agentRuns.status, "running"), lt(agentRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS))),
      )
      .returning({ id: agentRuns.id }),
  );
  return rows.length;
}

/**
 * Runs the scheduled agents whose time has come. Each slot is claimed with a
 * conditional update first, so two overlapping cron calls never run it twice.
 */
export async function runDueAgents(
  deps: Omit<AgentRunDeps, "llm"> & {
    /** The organization's model client; null skips its agents (no AI connected). */
    llmFor: (orgId: string) => Promise<LlmClient | null>;
  },
  options: { limit?: number } = {},
): Promise<{ projectId: string; result: ProspectingResult | { error: string } }[]> {
  const now = deps.now?.() ?? new Date();
  await closeStaleRuns(deps.db, now);
  const candidates = await withSystem(deps.db, (tx) =>
    tx
      .select({ agent: agentConfigs, project: projects })
      .from(agentConfigs)
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(
        and(
          eq(agentConfigs.agentType, "outbound"),
          eq(agentConfigs.enabled, true),
          isNotNull(agentConfigs.addedAt),
          isNotNull(agentConfigs.schedule),
          eq(projects.agentsPaused, false),
        ),
      ),
  );
  const due = candidates.filter(({ agent, project }) =>
    isDue(agent.schedule!, agent.lastScheduledRunAt, now, project.timezone),
  );

  const report = [];
  const clients = new Map<string, LlmClient | null>();
  for (const { agent, project } of due) {
    if (report.length >= (options.limit ?? 1)) break;
    const tenant = { orgId: agent.orgId };
    if (!clients.has(agent.orgId)) clients.set(agent.orgId, await deps.llmFor(agent.orgId));
    const llm = clients.get(agent.orgId);
    // No AI connected: the slot stays unclaimed and runs once the key is added.
    if (!llm) continue;
    const claimed = await withTenant(deps.db, tenant, (tx) =>
      tx
        .update(agentConfigs)
        .set({ lastScheduledRunAt: now })
        .where(
          and(
            eq(agentConfigs.id, agent.id),
            agent.lastScheduledRunAt
              ? eq(agentConfigs.lastScheduledRunAt, agent.lastScheduledRunAt)
              : isNull(agentConfigs.lastScheduledRunAt),
          ),
        )
        .returning({ id: agentConfigs.id }),
    );
    if (claimed.length === 0) continue;
    try {
      const result = await runProspecting({ ...deps, llm }, tenant, {
        projectId: project.id,
        trigger: "schedule",
      });
      report.push({ projectId: project.id, result });
    } catch (err) {
      report.push({
        projectId: project.id,
        result: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return report;
}
