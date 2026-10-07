import { and, eq, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { isSchedulerCall } from "@/server/cron";
import { actions } from "@/server/db/schema";
import { withSystem } from "@/server/db/tenant";
import { releaseDueActions } from "@/server/gateway/gateway";
import { gatewayDeps } from "@/server/gateway/runtime";

/**
 * Scheduler entry point (e.g. Vercel Cron every 5 minutes): executes deferred
 * actions whose send window or daily limit has opened. Protected by the scheduler secrets.
 */
export async function GET(request: Request) {
  if (!(await isSchedulerCall(getDb(), request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const orgs = await withSystem(getDb(), (tx) =>
    tx
      .selectDistinct({ orgId: actions.orgId })
      .from(actions)
      .where(and(eq(actions.status, "deferred"), lte(actions.scheduledFor, now))),
  );
  const summary: Record<string, number> = {};
  for (const { orgId } of orgs) {
    const results = await releaseDueActions(gatewayDeps(), { orgId, actorType: "system", actorId: "cron" });
    summary[orgId] = results.length;
  }
  return NextResponse.json({ released: summary });
}
