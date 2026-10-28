import { NextResponse } from "next/server";
import { isSchedulerCall } from "@/server/cron";
import { getDb } from "@/server/db/client";
import { sendToWorker } from "@/server/jobs/dispatch";
import { runCron, type CronJob } from "@/server/jobs/jobs";

/**
 * A scheduler entry point, protected by the scheduler secrets. The pass runs
 * in the worker when there is one (the answer comes back at once), here otherwise.
 */
export function cronHandler(name: CronJob) {
  return async function GET(request: Request) {
    if (!(await isSchedulerCall(getDb(), request))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (await sendToWorker({ kind: "cron", name })) return NextResponse.json({ ok: true, worker: true });
    return NextResponse.json(await runCron(getDb(), name));
  };
}
