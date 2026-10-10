import { pollMailboxes } from "./gmail-poller";
import { processPendingInbound, type InboundDeps, type InboundOutcome } from "./inbound";

/** Leads one run of the inbound agent attends at most. */
const LEADS_PER_RUN = 10;

/**
 * One run of an inbound agent, by hand («Ejecutar ahora») or on its
 * schedule: it reads the mailboxes it was told to read and attends what is
 * waiting for it (its own leads and the project's that no agent was given:
 * forms, emails, WhatsApp, rows of its table, notices from other tools).
 * Each lead is its own agent run.
 */
export async function runInboundSweep(
  deps: InboundDeps,
  tenant: { orgId: string },
  agentId: string,
): Promise<{ queued: number; outcomes: InboundOutcome[] }> {
  const polled = await pollMailboxes({ db: deps.db, connectors: deps.connectors }, tenant.orgId);
  const outcomes = await processPendingInbound(deps, tenant.orgId, LEADS_PER_RUN, { agentId });
  return { queued: polled.queued, outcomes };
}
