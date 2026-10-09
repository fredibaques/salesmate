import { pollMailboxes } from "./gmail-poller";
import { processPendingInbound, type InboundDeps, type InboundOutcome } from "./inbound";

/** Leads one run of the inbound agent attends at most. */
const LEADS_PER_RUN = 10;

/**
 * One run of the inbound agent, by hand («Ejecutar ahora») or on its
 * schedule: it reads the mailboxes it was told to read and attends what is
 * waiting for it in its project (forms, emails, WhatsApp, rows of its table,
 * notices from other tools). Each lead is its own agent run.
 */
export async function runInboundSweep(
  deps: InboundDeps,
  tenant: { orgId: string },
  projectId: string,
): Promise<{ queued: number; outcomes: InboundOutcome[] }> {
  const polled = await pollMailboxes({ db: deps.db, connectors: deps.connectors }, tenant.orgId);
  const outcomes = await processPendingInbound(deps, tenant.orgId, LEADS_PER_RUN, projectId);
  return { queued: polled.queued, outcomes };
}
