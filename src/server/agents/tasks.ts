import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentConfigs, agentEvents, agentRuns, prospects, type RunTask } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { countPendingCells } from "../prospects/complete";
import { audit } from "../audit";
import { describeNextRun, localClock } from "./scheduler";

/**
 * An agent's tasks: what it is doing now (with how far along a request that
 * spans several runs is: «45 de 120 filas») and what it will do next (the
 * batches it queued itself, what arrived for it, its next scheduled run).
 */

export function isRunTask(value: unknown): value is RunTask {
  const t = value as RunTask | null;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.id === "string" &&
    (t.kind === "find" || t.kind === "complete") &&
    typeof t.total === "number" &&
    typeof t.done === "number"
  );
}

/** A run cut off by the platform stays «running»; after this long it isn't really working. */
export const RUN_STALE_MS = 10 * 60_000;

export type TaskProgress = { done: number; total: number; unit: "filas" | "celdas" };

export type AgentTask = {
  key: string;
  state: "running" | "planned";
  title: string;
  progress: TaskProgress | null;
  /** Running: when it started. */
  startedAt?: Date;
  /** Planned: when it will start, in words («en unos minutos», «el lunes a las 08:00»). */
  when?: string;
  /** The run doing it, to open its steps. */
  runId?: string;
  costUsd?: number;
  /** A queued task that can be called off (its event). */
  cancelId?: string;
};

/** What a person can plan, by kind of agent. */
export const PLANNABLE = {
  prospecting: ["find", "complete"],
  outbound: ["outreach"],
} as const;
export type PlannedKind = "find" | "complete" | "outreach";

/** A planned task's title. */
export function plannedTitle(kind: PlannedKind, find?: number): string {
  if (kind === "find") return `Buscar ${find === 1 ? "1 fila nueva" : `${find ?? ""} filas nuevas`.trim()}`;
  if (kind === "complete") return "Completar los vacíos de la tabla";
  return "Ronda de primeros contactos";
}

/** «lun 20 oct, 09:00», in the project's time zone. */
export function formatWhen(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

const unitOf = (task: RunTask) => (task.kind === "find" ? "filas" : "celdas");

export function taskTitle(task: RunTask, total = task.total): string {
  return task.kind === "find"
    ? `Buscar ${total === 1 ? "1 fila nueva" : `${total} filas nuevas`}`
    : "Completar los vacíos de la tabla";
}

function clampProgress(task: RunTask, done: number): TaskProgress {
  return { done: Math.max(0, Math.min(task.total, done)), total: task.total, unit: unitOf(task) };
}

const RUN_TITLES: Record<string, string> = {
  manual: "Trabajo lanzado a mano",
  schedule: "Trabajo programado",
  event: "Atender lo que ha llegado",
  inbound_event: "Atender un contacto",
  copilot: "Respuesta del copiloto",
};

/** What a scheduled run of this kind of agent does, for the planned list. */
const SCHEDULED_TITLES: Record<string, string> = {
  prospecting: "Ronda programada: buscar y completar filas",
  outbound: "Ronda programada: primeros contactos",
  inbound: "Ronda programada",
};

/**
 * A run in progress as a task: a request's progress counts what earlier runs
 * did and what this one has done so far.
 */
export async function runningTask(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  run: { id: string; trigger: string; task: unknown; startedAt: Date; costUsd: number },
  baseId: string | null,
): Promise<AgentTask> {
  const task = isRunTask(run.task) ? run.task : null;
  let progress: TaskProgress | null = null;
  if (task?.kind === "find") {
    const [{ n }] = await withTenant(db, tenant, (tx) =>
      tx.select({ n: count() }).from(prospects).where(eq(prospects.runId, run.id)),
    );
    progress = clampProgress(task, task.done + Number(n));
  } else if (task?.kind === "complete" && baseId) {
    const pending = await countPendingCells(db, tenant, baseId);
    progress = clampProgress(task, task.total - pending);
  }
  return {
    key: run.id,
    state: "running",
    title: task ? taskTitle(task) : (RUN_TITLES[run.trigger] ?? "Trabajando"),
    progress,
    startedAt: run.startedAt,
    runId: run.id,
    costUsd: run.costUsd,
  };
}

export async function agentTasks(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  input: { agentId: string; timezone: string; projectPaused: boolean; now?: Date },
): Promise<{ running: AgentTask[]; planned: AgentTask[] }> {
  const now = input.now ?? new Date();
  const { agent, runs, events } = await withTenant(db, tenant, async (tx) => {
    const [agent] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, input.agentId));
    const runs = await tx
      .select({
        id: agentRuns.id,
        trigger: agentRuns.trigger,
        task: agentRuns.task,
        startedAt: agentRuns.startedAt,
        costUsd: agentRuns.costUsd,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.agentConfigId, input.agentId),
          eq(agentRuns.status, "running"),
          gt(agentRuns.startedAt, new Date(now.getTime() - RUN_STALE_MS)),
        ),
      )
      .orderBy(desc(agentRuns.startedAt));
    const events = await tx
      .select()
      .from(agentEvents)
      .where(and(eq(agentEvents.agentConfigId, input.agentId), isNull(agentEvents.processedAt)))
      .orderBy(sql`coalesce(${agentEvents.dueAt}, ${agentEvents.createdAt}) asc`, asc(agentEvents.createdAt));
    return { agent, runs, events };
  });
  if (!agent) return { running: [], planned: [] };
  const baseId = agent.prospectBaseId;

  const running = await Promise.all(runs.map((run) => runningTask(db, tenant, run, baseId)));

  // Planned: what is queued for it, in the order it will be taken, then its next scheduled run.
  const works = agent.enabled && !input.projectPaused;
  const soon = works ? "en unos minutos" : "cuando actives el agente";
  const planned: AgentTask[] = [];
  const newRows = events.filter((e) => e.kind === "new_rows");
  const notices = events.filter((e) => e.kind === "webhook");
  for (const e of events.filter((x) => x.kind === "continue")) {
    const task = isRunTask(e.payload.task) ? e.payload.task : null;
    const find = typeof e.payload.find === "number" ? e.payload.find : null;
    const left = typeof e.payload.left === "number" ? e.payload.left : null;
    // Planned by a person for a moment: it says when (and waits for it).
    const dated = e.dueAt && e.dueAt.getTime() > now.getTime() ? formatWhen(e.dueAt, input.timezone) : null;
    const when = dated ? (works ? dated : `${dated} (si activas el agente)`) : soon;
    planned.push({
      key: e.id,
      state: "planned",
      title: e.payload.planned
        ? plannedTitle(
            agent.agentType === "outbound" ? "outreach" : find !== null ? "find" : "complete",
            find ?? undefined,
          )
        : task
          ? `${taskTitle(task)}: siguiente tanda`
          : find !== null
            ? `Buscar ${find} filas nuevas más`
            : `Seguir completando la tabla${left ? ` (${left} celdas)` : ""}`,
      progress: task ? clampProgress(task, task.done) : null,
      when,
      cancelId: e.id,
    });
  }
  if (newRows.length) {
    const rows = new Set(
      newRows.flatMap((e) => (Array.isArray(e.payload.rowIds) ? (e.payload.rowIds as string[]) : [])),
    ).size;
    planned.push({
      key: "new_rows",
      state: "planned",
      title: rows === 1 ? "Completar 1 fila nueva" : `Completar ${rows} filas nuevas`,
      progress: null,
      when: soon,
    });
  }
  if (notices.length) {
    planned.push({
      key: "webhook",
      state: "planned",
      title: notices.length === 1 ? "Atender 1 aviso recibido" : `Atender ${notices.length} avisos recibidos`,
      progress: null,
      when: soon,
    });
  }
  const next =
    works && agent.schedule
      ? describeNextRun(agent.schedule, agent.lastScheduledRunAt, now, input.timezone)
      : null;
  if (next) {
    planned.push({
      key: "schedule",
      state: "planned",
      title: SCHEDULED_TITLES[agent.agentType] ?? "Ronda programada",
      progress: null,
      when: next,
    });
  }
  return { running, planned };
}

/**
 * A task a person plans for a moment: new rows to find or the table's empty
 * cells (prospecting), or a round of first contacts (outbound). It waits in
 * the agent's queue (`agent_events.due_at`) until the scheduler's first pass
 * from then.
 */
export async function planTask(
  db: Db,
  tenant: TenantContext,
  input: { agentId: string; kind: PlannedKind; find?: number; dueAt: Date; now?: Date },
) {
  const now = input.now ?? new Date();
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("Elige el día y la hora.");
  if (input.dueAt.getTime() < now.getTime() - 60_000)
    throw new Error("Elige un momento que aún no haya pasado.");
  return withTenant(db, tenant, async (tx) => {
    const [agent] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, input.agentId));
    if (!agent?.addedAt) throw new Error("Agente no encontrado.");
    const allowed: readonly string[] = PLANNABLE[agent.agentType as keyof typeof PLANNABLE] ?? [];
    if (!allowed.includes(input.kind)) throw new Error("Este agente no puede hacer esa tarea.");
    const find =
      input.kind === "find"
        ? Math.min(MAX_PLANNED_FIND, Math.max(1, Math.round(input.find ?? 0)))
        : undefined;
    const [event] = await tx
      .insert(agentEvents)
      .values({
        orgId: tenant.orgId,
        projectId: agent.projectId,
        agentConfigId: agent.id,
        kind: "continue",
        payload: { planned: true, ...(find ? { find } : {}) },
        dueAt: input.dueAt,
      })
      .returning();
    await audit(tx, tenant, {
      event: "agent.task_planned",
      projectId: agent.projectId,
      entityType: "agent_config",
      entityId: agent.id,
      data: { kind: input.kind, find, dueAt: input.dueAt.toISOString() },
    });
    return event;
  });
}

/** Most new rows one planned task asks for (the agent goes on by batches). */
export const MAX_PLANNED_FIND = 200;

/** Calls off a queued task (planned, or the rest of a request) before the agent takes it. */
export async function cancelQueuedTask(db: Db, tenant: TenantContext, agentId: string, eventId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [gone] = await tx
      .delete(agentEvents)
      .where(
        and(
          eq(agentEvents.id, eventId),
          eq(agentEvents.agentConfigId, agentId),
          eq(agentEvents.kind, "continue"),
          isNull(agentEvents.processedAt),
        ),
      )
      .returning();
    if (!gone) throw new Error("Esa tarea ya no está en cola: puede que el agente ya la haya empezado.");
    await audit(tx, tenant, {
      event: "agent.task_cancelled",
      projectId: gone.projectId,
      entityType: "agent_config",
      entityId: agentId,
      data: { payload: gone.payload },
    });
  });
}

/** Tomorrow's date in a time zone: what «Planificar tarea» proposes. */
export function tomorrowIn(timeZone: string, now = new Date()): string {
  return localClock(new Date(now.getTime() + 24 * 3600_000), timeZone).date;
}
