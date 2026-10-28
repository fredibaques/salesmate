import { after } from "next/server";
import type { RowsAddedTo } from "../agents/events";
import { env } from "../env";
import { runJob, type Job } from "./jobs";

/** How long the worker gets to take a job before it runs here instead. */
const HANDOFF_TIMEOUT_MS = 15_000;

/**
 * Hands a job to the worker (WORKER_URL, a Neon Function that runs it next to
 * the database for up to 15 minutes). Without a worker, or if it doesn't take
 * the job, it runs here after the response, as before. Returns whether the
 * worker took it.
 */
export async function sendToWorker(
  job: Job,
  deps: { fetch?: typeof fetch; url?: string; secret?: string } = {},
): Promise<boolean> {
  const url = deps.url ?? env().WORKER_URL;
  const secret = deps.secret ?? env().WORKER_SECRET;
  if (!url || !secret) return false;
  try {
    const response = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
    });
    if (response.status === 202) return true;
    console.error("worker refused the job", job.kind, response.status, (await response.text()).slice(0, 300));
  } catch (err) {
    console.error("worker unreachable", job.kind, err);
  }
  return false;
}

/** Runs a job in the background: the worker if there is one, this function otherwise. */
export function dispatchJob(job: Job) {
  after(async () => {
    if (await sendToWorker(job)) return;
    try {
      await runJob(job);
    } catch (err) {
      console.error(`${job.kind} job failed`, err);
    }
  });
}

/**
 * New rows of a table: the agents that listen to them work on them in the
 * background. Whatever can't run now (no AI, a busy agent) the scheduler picks up later.
 */
export function workOnAddedRows(tenant: { orgId: string }, added: RowsAddedTo) {
  if (!added.prospecting.length && !added.inbound.length) return false;
  dispatchJob({ kind: "rows-added", orgId: tenant.orgId, ...added });
  return true;
}
