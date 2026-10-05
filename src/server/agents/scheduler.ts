import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { agentConfigs, projects, type AgentSchedule } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
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

/**
 * Runs the scheduled agents whose time has come. Each slot is claimed with a
 * conditional update first, so two overlapping cron calls never run it twice.
 */
export async function runDueAgents(
  deps: AgentRunDeps,
  options: { limit?: number } = {},
): Promise<{ projectId: string; result: ProspectingResult | { error: string } }[]> {
  const now = deps.now?.() ?? new Date();
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
  const due = candidates
    .filter(({ agent, project }) => isDue(agent.schedule!, agent.lastScheduledRunAt, now, project.timezone))
    .slice(0, options.limit ?? 3);

  const report = [];
  for (const { agent, project } of due) {
    const tenant = { orgId: agent.orgId };
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
      const result = await runProspecting(deps, tenant, { projectId: project.id, trigger: "schedule" });
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
