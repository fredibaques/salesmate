import { NextResponse } from "next/server";
import { runPendingEvents } from "@/server/agents/events";
import { runDueAgents } from "@/server/agents/scheduler";
import { isSchedulerCall } from "@/server/cron";
import { gatewayDeps } from "@/server/gateway/runtime";
import { getDb } from "@/server/db/client";
import { orgLlm } from "@/server/llm/org-ai";

export const maxDuration = 300;

/** Scheduler entry point for agents that work on their own (prospecting). Protected by the scheduler secrets. */
export async function GET(request: Request) {
  if (!(await isSchedulerCall(getDb(), request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  // Up to three runs at once, in parallel: each takes up to ~3 minutes and
  // the function gets 5. Organizations without their own AI are skipped.
  // Agents with pending events (rows added, webhook notices) work alongside, two at most.
  const deps = { db, gateway: gatewayDeps(), llmFor: (orgId: string) => orgLlm(db, { orgId }) };
  const [report, events] = await Promise.all([
    runDueAgents(deps, { limit: 3 }),
    runPendingEvents(deps, { limit: 2 }),
  ]);
  return NextResponse.json({
    ok: true,
    checked: report.checked,
    events,
    skipped: report.skipped,
    runs: report.runs.map((r) => ({
      projectId: r.projectId,
      ...("error" in r.result
        ? { error: r.result.error }
        : { status: r.result.status, added: r.result.added, costUsd: r.result.costUsd }),
    })),
  });
}
