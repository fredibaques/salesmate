import { after } from "next/server";
import type { RowsAddedTo } from "../agents/events";
import { runJob, type Job } from "./jobs";

/** Runs a job in the background, after the response. */
export function dispatchJob(job: Job) {
  after(async () => {
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
