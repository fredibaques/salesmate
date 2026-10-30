import { and, eq, inArray, lte, or } from "drizzle-orm";
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
import { actions, connections, inboundEvents, type ProspectingMode } from "../db/schema";
import { withSystem } from "../db/tenant";
import { releaseDueActions } from "../gateway/gateway";
import { gatewayDeps } from "../gateway/runtime";
import { orgLlm } from "../llm/org-ai";
import { syncPendingTranscripts } from "../meetings/service";

/**
 * Background work: agent runs and the scheduler's passes, as plain data that
 * `dispatchJob` runs after the response and the cron routes run in place.
 */
export type CronJob = "inbound" | "agents" | "release-deferred";

export type Job =
  /** «Buscar ahora», «Completar vacíos» or one row's «Completar esta fila». */
  | {
      kind: "prospecting";
      orgId: string;
      agentId: string;
      triggerRef?: string;
      mode?: ProspectingMode;
      rowIds?: string[];
      allPending?: boolean;
      wanted?: number;
    }
  /** «Ejecutar ahora» of the outbound agent. */
  | { kind: "outreach"; orgId: string; agentId: string; triggerRef?: string }
  /** «Ejecutar ahora» of the inbound agent: reads its mailbox and attends what waits. */
  | { kind: "inbound-sweep"; orgId: string; agentId: string }
  /** An agent's pending events (rows added, webhook notices). */
  | { kind: "agent-events"; orgId: string; agentId: string }
  /** The inbound agent's pending leads (a notice on its webhook). */
  | { kind: "pending-inbound"; orgId: string; agentId: string }
  /** Queued inbound events (a web form, WhatsApp messages). */
  | { kind: "inbound-events"; orgId: string; eventIds: string[] }
  /** New rows of a table, for the agents that listen to them (see `rowsAdded`). */
  | { kind: "rows-added"; orgId: string; prospecting: string[]; inbound: string[] }
  /** One of the scheduler's passes. */
  | { kind: "cron"; name: CronJob };

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
