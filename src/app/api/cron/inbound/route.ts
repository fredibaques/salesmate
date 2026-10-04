import { eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pollMailboxes } from "@/server/agents/gmail-poller";
import { processPendingInbound } from "@/server/agents/inbound";
import { inboundDeps } from "@/server/agents/runtime";
import { getDb } from "@/server/db/client";
import { connections, inboundEvents } from "@/server/db/schema";
import { withSystem } from "@/server/db/tenant";
import { env } from "@/server/env";
import { isLlmConfigured } from "@/server/llm/client";

export const maxDuration = 300;

/**
 * Scheduler entry point: reads new mail from connected mailboxes and runs the
 * inbound agent on pending events. Protected by CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
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
    const processed = isLlmConfigured() ? await processPendingInbound(inboundDeps(), orgId, 5) : [];
    report[orgId] = {
      queued: polled.queued,
      errors: polled.errors,
      processed: processed.map((p) => p.status),
    };
  }
  return NextResponse.json({ ok: true, report });
}
