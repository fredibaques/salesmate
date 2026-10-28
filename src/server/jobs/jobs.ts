import { and, eq, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import { processAgentEvents, runPendingEvents } from "../agents/events";
import { pollMailboxes } from "../agents/gmail-poller";
import { processInboundEvent, processPendingInbound } from "../agents/inbound";
import { runInboundSweep } from "../agents/inbound-sweep";
import { runOutreach } from "../agents/outreach";
import { runProspecting } from "../agents/prospector";
import { agentRunDeps, inboundDeps } from "../agents/runtime";
import { runDueAgents } from "../agents/scheduler";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import { PROSPECTING_MODES, actions, connections, inboundEvents } from "../db/schema";
import { withSystem } from "../db/tenant";
import { releaseDueActions } from "../gateway/gateway";
import { gatewayDeps } from "../gateway/runtime";
import { orgLlm } from "../llm/org-ai";
import { syncPendingTranscripts } from "../meetings/service";

/**
 * Background work: agent runs and the scheduler's passes. Each job is plain
 * JSON, so it can run here after a response or be sent to the worker (a Neon
 * Function, see `dispatch.ts` and scripts/neon-worker), which keeps the long
 * waits on the model off the web app's functions.
 */
const id = z.string().min(1).max(100);
const ids = z.array(id).max(500);

export const CRON_JOBS = ["inbound", "agents", "release-deferred"] as const;
export type CronJob = (typeof CRON_JOBS)[number];

const jobSchema = z.discriminatedUnion("kind", [
  /** «Buscar ahora», «Completar vacíos» or one row's «Completar esta fila». */
  z.object({
    kind: z.literal("prospecting"),
    orgId: id,
    agentId: id,
    triggerRef: id.optional(),
    mode: z.enum(PROSPECTING_MODES).optional(),
    rowIds: ids.optional(),
    allPending: z.boolean().optional(),
    wanted: z.number().int().positive().optional(),
  }),
  /** «Ejecutar ahora» of the outbound agent. */
  z.object({ kind: z.literal("outreach"), orgId: id, agentId: id, triggerRef: id.optional() }),
  /** «Ejecutar ahora» of the inbound agent: reads its mailbox and attends what waits. */
  z.object({ kind: z.literal("inbound-sweep"), orgId: id, agentId: id }),
  /** An agent's pending events (rows added, webhook notices). */
  z.object({ kind: z.literal("agent-events"), orgId: id, agentId: id }),
  /** The inbound agent's pending leads (a notice on its webhook). */
  z.object({ kind: z.literal("pending-inbound"), orgId: id, agentId: id }),
  /** Queued inbound events (a web form, WhatsApp messages). */
  z.object({ kind: z.literal("inbound-events"), orgId: id, eventIds: ids }),
  /** New rows of a table, for the agents that listen to them (see `rowsAdded`). */
  z.object({ kind: z.literal("rows-added"), orgId: id, prospecting: ids, inbound: ids }),
  /** One of the scheduler's passes. */
  z.object({ kind: z.literal("cron"), name: z.enum(CRON_JOBS) }),
]);

export type Job = z.infer<typeof jobSchema>;

/** A job from the outside (the worker's request body); null when it isn't one. */
export function parseJob(value: unknown): Job | null {
  const parsed = jobSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Runs a job to the end. Without the organization's AI, agent work waits for the scheduler. */
export async function runJob(job: Job): Promise<unknown> {
  const db = getDb();
  if (job.kind === "cron") return runCron(db, job.name);
  const tenant = { orgId: job.orgId };
  const llm = await orgLlm(db, tenant);
  if (!llm) return { skipped: "ai_not_connected" };
  switch (job.kind) {
    case "prospecting": {
      const { kind: _, orgId: __, triggerRef, ...options } = job;
      return runProspecting(agentRunDeps(llm), tenant, {
        trigger: "manual",
        triggerRef,
        ...options,
      });
    }
    case "outreach":
      return runOutreach(agentRunDeps(llm), tenant, {
        agentId: job.agentId,
        trigger: "manual",
        triggerRef: job.triggerRef,
      });
    case "inbound-sweep":
      return runInboundSweep(inboundDeps(llm), tenant, job.agentId);
    case "agent-events":
      return processAgentEvents(agentRunDeps(llm), tenant, job.agentId);
    case "pending-inbound":
      return processPendingInbound(inboundDeps(llm), job.orgId, 5, { agentId: job.agentId });
    case "inbound-events": {
      const out = [];
      for (const eventId of job.eventIds)
        out.push(await processInboundEvent(inboundDeps(llm), job.orgId, eventId));
      return out;
    }
    case "rows-added": {
      // The prospecting agents complete them; the inbound agents attend each person.
      const runs = await Promise.all(
        job.prospecting.map((agentId) => processAgentEvents(agentRunDeps(llm), tenant, agentId)),
      );
      const attended = [];
      for (const agentId of job.inbound)
        attended.push(await processPendingInbound(inboundDeps(llm), job.orgId, 5, { agentId }));
      return { runs, attended };
    }
  }
}

/** The scheduler's passes: each decides what is due and claims it, so calling one twice is harmless. */
export async function runCron(db: Db, name: CronJob): Promise<Record<string, unknown>> {
  if (name === "inbound") return cronInbound(db);
  if (name === "agents") return cronAgents(db);
  return cronReleaseDeferred(db);
}

/**
 * Reads new mail from connected mailboxes, runs the inbound agent on
 * pending events and reads the transcripts of ended Meet calls.
 */
async function cronInbound(db: Db) {
  const orgs = await withSystem(db, async (tx) => {
    const withMail = await tx
      .selectDistinct({ orgId: connections.orgId })
      .from(connections)
      .where(eq(connections.provider, "google"));
    const withPending = await tx
      .selectDistinct({ orgId: inboundEvents.orgId })
      .from(inboundEvents)
      .where(or(eq(inboundEvents.status, "pending"), inArray(inboundEvents.status, ["error"])));
    return [...new Set([...withMail, ...withPending].map((r) => r.orgId))];
  });

  const report: Record<string, unknown> = {};
  for (const orgId of orgs) {
    const polled = await pollMailboxes({ db }, orgId);
    const llm = await orgLlm(db, { orgId });
    const processed = llm ? await processPendingInbound(inboundDeps(llm), orgId, 5) : [];
    report[orgId] = {
      queued: polled.queued,
      errors: polled.errors,
      processed: llm ? processed.map((p) => p.status) : "ai_not_connected",
    };
  }
  // Transcripts of Meet calls that have ended.
  const transcripts = await syncPendingTranscripts({ db, llmFor: (orgId) => orgLlm(db, { orgId }) });
  return { ok: true, report, transcripts };
}

/** Agents that work on their own (prospecting) and agents with pending events. */
async function cronAgents(db: Db) {
  // Up to three runs at once, in parallel: each takes up to ~3 minutes and
  // the function gets 5. Organizations without their own AI are skipped.
  // Agents with pending events (rows added, webhook notices) work alongside, two at most.
  const deps = { db, gateway: gatewayDeps(), llmFor: (orgId: string) => orgLlm(db, { orgId }) };
  const [report, events] = await Promise.all([
    runDueAgents(deps, { limit: 3 }),
    runPendingEvents(deps, { limit: 2 }),
  ]);
  return {
    ok: true,
    checked: report.checked,
    events,
    skipped: report.skipped,
    runs: report.runs.map((r) => ({
      projectId: r.projectId,
      agentId: r.agentId,
      ...("error" in r.result
        ? { error: r.result.error }
        : "outcomes" in r.result
          ? { queued: r.result.queued, leads: r.result.outcomes.map((o) => o.status) }
          : "proposed" in r.result
            ? { status: r.result.status, proposed: r.result.proposed, costUsd: r.result.costUsd }
            : { status: r.result.status, added: r.result.added, costUsd: r.result.costUsd }),
    })),
  };
}

/** Executes deferred actions whose send window or daily limit has opened. */
async function cronReleaseDeferred(db: Db) {
  const now = new Date();
  const orgs = await withSystem(db, (tx) =>
    tx
      .selectDistinct({ orgId: actions.orgId })
      .from(actions)
      .where(and(eq(actions.status, "deferred"), lte(actions.scheduledFor, now))),
  );
  const released: Record<string, number> = {};
  for (const { orgId } of orgs) {
    const results = await releaseDueActions(gatewayDeps(), { orgId, actorType: "system", actorId: "cron" });
    released[orgId] = results.length;
  }
  return { released };
}
