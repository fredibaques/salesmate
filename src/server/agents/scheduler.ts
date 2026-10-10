import { runInboundSweep } from "./inbound-sweep";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { agentConfigs, agentRuns, projects, type AgentSchedule } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import type { LlmClient } from "../llm/client";
import { dayInWords } from "@/lib/schedule";
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

/** Days in a month (month 1–12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The day a monthly schedule runs in a given month: its day, or the last one if the month is shorter. */
function monthlyDay(schedule: { day: number }, year: number, month: number): number {
  return Math.min(schedule.day, daysInMonth(year, month));
}

/** Whether a recurring schedule works on a local calendar date ("YYYY-MM-DD", weekday 1–7). */
function worksOn(schedule: AgentSchedule, date: string, weekday: number): boolean {
  if (schedule.kind === "once") return false;
  if (schedule.kind === "daily") return true;
  if (schedule.kind === "monthly") {
    const [y, m, d] = date.split("-").map(Number);
    return d === monthlyDay(schedule, y, m);
  }
  return schedule.days.includes(weekday);
}

/**
 * Due when its time has come and it hasn't run for it yet: recurring
 * schedules once per working day, after their time; a single run once,
 * from its moment on.
 */
export function isDue(schedule: AgentSchedule, lastRunAt: Date | null, now: Date, timeZone: string): boolean {
  const today = localClock(now, timeZone);
  if (schedule.kind === "once") {
    if (`${today.date}T${today.time}` < schedule.at) return false;
    if (!lastRunAt) return true;
    const last = localClock(lastRunAt, timeZone);
    return `${last.date}T${last.time}` < schedule.at;
  }
  if (!worksOn(schedule, today.date, today.weekday)) return false;
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

export type ScheduledRun = {
  projectId: string;
  agentId: string;
  result: ProspectingResult | Awaited<ReturnType<typeof runInboundSweep>> | { error: string };
};
export type SkippedAgent = { projectId: string; reason: "no_ai" | "taken" | "over_limit" };

const SKIP_NOTES: Partial<Record<SkippedAgent["reason"], string>> = {
  no_ai: "No ha podido trabajar: la organización no tiene la IA conectada.",
};

/**
 * Runs the scheduled agents whose time has come, up to `limit` at once (in
 * parallel: each run has its own time budget). Each slot is claimed with a
 * conditional update first, so two overlapping scheduler calls never run it
 * twice. Every enabled agent is stamped as checked, and the reason a due
 * slot could not run is kept on the agent, so its page can say what is
 * happening.
 */
export async function runDueAgents(
  deps: Omit<AgentRunDeps, "llm"> & {
    /** The organization's model client; null skips its agents (no AI connected). */
    llmFor: (orgId: string) => Promise<LlmClient | null>;
  },
  options: { limit?: number } = {},
): Promise<{ runs: ScheduledRun[]; skipped: SkippedAgent[]; checked: number }> {
  const now = deps.now?.() ?? new Date();
  const limit = options.limit ?? 3;
  await closeStaleRuns(deps.db, now);
  const candidates = await withSystem(deps.db, (tx) =>
    tx
      .select({ agent: agentConfigs, project: projects })
      .from(agentConfigs)
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(
        and(
          inArray(agentConfigs.agentType, ["outbound", "inbound"]),
          eq(agentConfigs.enabled, true),
          isNotNull(agentConfigs.addedAt),
          isNotNull(agentConfigs.schedule),
          eq(projects.agentsPaused, false),
        ),
      ),
  );
  if (candidates.length) {
    await withSystem(deps.db, (tx) =>
      tx
        .update(agentConfigs)
        // Keep updated_at: a check is not an edit.
        .set({ scheduleCheckedAt: now, updatedAt: sql`${agentConfigs.updatedAt}` })
        .where(
          inArray(
            agentConfigs.id,
            candidates.map((c) => c.agent.id),
          ),
        ),
    );
  }
  const due = candidates.filter(({ agent, project }) =>
    isDue(agent.schedule!, agent.lastScheduledRunAt, now, project.timezone),
  );

  const note = (agentId: string, orgId: string, text: string | null) =>
    withTenant(deps.db, { orgId }, (tx) =>
      tx
        .update(agentConfigs)
        .set({ scheduleNote: text, updatedAt: sql`${agentConfigs.updatedAt}` })
        .where(eq(agentConfigs.id, agentId)),
    );

  const skipped: SkippedAgent[] = [];
  const claimed: { agent: (typeof due)[number]["agent"]; projectId: string; llm: LlmClient }[] = [];
  const clients = new Map<string, LlmClient | null>();
  for (const { agent, project } of due) {
    if (claimed.length >= limit) {
      // Picked up by the next call.
      skipped.push({ projectId: project.id, reason: "over_limit" });
      continue;
    }
    if (!clients.has(agent.orgId)) clients.set(agent.orgId, await deps.llmFor(agent.orgId));
    const llm = clients.get(agent.orgId);
    if (!llm) {
      // The slot stays unclaimed and runs once the key is added.
      skipped.push({ projectId: project.id, reason: "no_ai" });
      await note(agent.id, agent.orgId, SKIP_NOTES.no_ai!);
      continue;
    }
    const won = await withTenant(deps.db, { orgId: agent.orgId }, (tx) =>
      tx
        .update(agentConfigs)
        .set({ lastScheduledRunAt: now })
        .where(
          and(
            eq(agentConfigs.id, agent.id),
            agent.lastScheduledRunAt
              ? // Postgres keeps microseconds, JavaScript dates only milliseconds:
                // compare at millisecond precision or the claim never matches.
                sql`date_trunc('milliseconds', ${agentConfigs.lastScheduledRunAt}) = ${agent.lastScheduledRunAt.toISOString()}::timestamptz`
              : isNull(agentConfigs.lastScheduledRunAt),
          ),
        )
        .returning({ id: agentConfigs.id }),
    );
    if (won.length === 0) {
      skipped.push({ projectId: project.id, reason: "taken" });
      continue;
    }
    claimed.push({ agent, projectId: project.id, llm });
  }

  const runs = await Promise.all(
    claimed.map(async ({ agent, projectId, llm }): Promise<ScheduledRun> => {
      const tenant = { orgId: agent.orgId };
      try {
        // The inbound agent's run reads its mailbox and attends what is waiting.
        const result =
          agent.agentType === "inbound"
            ? await runInboundSweep({ ...deps, llm }, tenant, agent.id)
            : await runProspecting({ ...deps, llm }, tenant, { agentId: agent.id, trigger: "schedule" });
        await note(agent.id, agent.orgId, null);
        return { projectId, agentId: agent.id, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await note(agent.id, agent.orgId, `La última ejecución programada falló: ${message}`);
        return { projectId, agentId: agent.id, result: { error: message } };
      }
    }),
  );
  return { runs, skipped, checked: candidates.length };
}

const WEEKDAY_NAMES = [
  "",
  "el lunes",
  "el martes",
  "el miércoles",
  "el jueves",
  "el viernes",
  "el sábado",
  "el domingo",
];

/** The local date `days` after a "YYYY-MM-DD" date, with its weekday (1–7). */
function addDays(date: string, days: number): { date: string; weekday: number } {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return { date: at.toISOString().slice(0, 10), weekday: ((at.getUTCDay() + 6) % 7) + 1 };
}

/**
 * When a scheduled agent works next, in words ("hoy a las 08:00", "el
 * lunes a las 08:00", "el 15 de noviembre a las 08:00"); null when it won't
 * (no days chosen, or a single run that already happened).
 */
export function describeNextRun(
  schedule: AgentSchedule,
  lastRunAt: Date | null,
  now: Date,
  timeZone: string,
): string | null {
  const today = localClock(now, timeZone);
  if (schedule.kind === "once") {
    if (isDue(schedule, lastRunAt, now, timeZone)) return "ahora, en la próxima pasada del programador";
    // Its moment has passed and it ran.
    if (`${today.date}T${today.time}` >= schedule.at) return null;
    const [date, time] = schedule.at.split("T");
    if (date === today.date) return `hoy a las ${time}`;
    if (date === addDays(today.date, 1).date) return `mañana a las ${time}`;
    return `${dayInWords(date)} a las ${time}`;
  }
  if (schedule.kind !== "daily" && schedule.kind !== "monthly" && !schedule.days.length) return null;
  const ranToday = lastRunAt ? localClock(lastRunAt, timeZone).date === today.date : false;
  // A month and a bit covers every monthly schedule.
  for (let i = 0; i <= 62; i++) {
    const day = i === 0 ? today : addDays(today.date, i);
    if (!worksOn(schedule, day.date, day.weekday)) continue;
    if (i === 0) {
      if (ranToday) continue;
      if (today.time >= schedule.time) return "ahora, en la próxima pasada del programador";
      return `hoy a las ${schedule.time}`;
    }
    if (i === 1) return `mañana a las ${schedule.time}`;
    if (i < 7) return `${WEEKDAY_NAMES[day.weekday]} a las ${schedule.time}`;
    return `${dayInWords(day.date)} a las ${schedule.time}`;
  }
  return null;
}

/** The scheduler passes every 15 minutes (hourly at night): longer than this means it is not passing. */
export const SCHEDULER_STALE_MS = 75 * 60_000;
