import { NextResponse } from "next/server";
import { agentByHookToken, queueWebhookLead, recordAgentEvent } from "@/server/agents/events";
import { getDb } from "@/server/db/client";
import { dispatchJob } from "@/server/jobs/dispatch";

export const maxDuration = 300;

/** Largest notice accepted, in characters. */
const MAX_BODY = 20_000;

/**
 * An agent's webhook: any tool (a CRM, Zapier, Make…) posts a notice and
 * the agent works with it (the inbound agent attends it as a lead). The
 * token in the URL is the secret. The notice is stored and processed after
 * answering; if the agent is busy, the scheduler picks it up on its next pass.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/hooks/agents/[token]">) {
  const { token } = await ctx.params;
  const db = getDb();
  const agent = await agentByHookToken(db, token);
  if (!agent || !agent.settings.triggers?.webhook) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const text = (await request.text()).slice(0, MAX_BODY);
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Plain text is fine.
  }
  const tenant = { orgId: agent.orgId };
  // The inbound agent attends the notice as a new lead (its fields by name).
  if (agent.agentType === "inbound") {
    const queued = await queueWebhookLead(db, tenant, agent, body);
    if (!queued) return NextResponse.json({ error: "no_contact_data" }, { status: 422 });
    dispatchJob({ kind: "pending-inbound", orgId: agent.orgId, agentId: agent.id });
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  const stored = await recordAgentEvent(db, tenant, {
    agentConfigId: agent.id,
    kind: "webhook",
    payload: { body },
  });
  if (!stored) return NextResponse.json({ error: "too_many_pending" }, { status: 429 });
  dispatchJob({ kind: "agent-events", orgId: agent.orgId, agentId: agent.id });
  return NextResponse.json({ ok: true }, { status: 202 });
}
