import { NextResponse } from "next/server";
import { agentRunDeps } from "@/server/agents/runtime";
import { runDueAgents } from "@/server/agents/scheduler";
import { env } from "@/server/env";
import { isLlmConfigured } from "@/server/llm/client";

export const maxDuration = 300;

/** Scheduler entry point for agents that work on their own (prospecting). Protected by CRON_SECRET. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isLlmConfigured()) return NextResponse.json({ ok: true, skipped: "llm_not_configured" });
  // One run per call: a run takes up to ~3 minutes and the function gets 5.
  const report = await runDueAgents(agentRunDeps(), { limit: 1 });
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
