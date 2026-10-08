import { after, NextResponse } from "next/server";
import { agentByHookToken, processAgentEvents, recordAgentEvent } from "@/server/agents/events";
import { agentRunDeps } from "@/server/agents/runtime";
import { getDb } from "@/server/db/client";
import { orgLlm } from "@/server/llm/org-ai";

export const maxDuration = 300;

/** Largest notice accepted, in characters. */
const MAX_BODY = 20_000;

/**
 * An agent's webhook: any tool (a CRM, Zapier, Make…) posts a notice and
 * the agent works with it. The token in the URL is the secret. The notice
 * is stored and processed after answering; if the agent is busy, the
 * scheduler picks it up on its next pass.
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
  const stored = await recordAgentEvent(db, tenant, {
    agentConfigId: agent.id,
    kind: "webhook",
    payload: { body },
  });
  if (!stored) return NextResponse.json({ error: "too_many_pending" }, { status: 429 });
  after(async () => {
    try {
      const llm = await orgLlm(db, tenant);
      if (llm) await processAgentEvents(agentRunDeps(llm), tenant, agent.id);
    } catch (err) {
      console.error("webhook run failed", err);
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
