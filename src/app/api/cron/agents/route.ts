import { NextResponse } from "next/server";
import { runDueAgents } from "@/server/agents/scheduler";
import { env } from "@/server/env";
import { gatewayDeps } from "@/server/gateway/runtime";
import { getDb } from "@/server/db/client";
import { orgLlm } from "@/server/llm/org-ai";

export const maxDuration = 300;

/** Scheduler entry point for agents that work on their own (prospecting). Protected by CRON_SECRET. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  // One run per call: a run takes up to ~3 minutes and the function gets 5.
  // Organizations without their own AI are skipped.
  const report = await runDueAgents(
    { db, gateway: gatewayDeps(), llmFor: (orgId) => orgLlm(db, { orgId }) },
    { limit: 1 },
  );
  return NextResponse.json({
    ok: true,
    runs: report.map((r) => ({
      projectId: r.projectId,
      ...("error" in r.result
        ? { error: r.result.error }
        : { status: r.result.status, added: r.result.added, costUsd: r.result.costUsd }),
    })),
  });
}
