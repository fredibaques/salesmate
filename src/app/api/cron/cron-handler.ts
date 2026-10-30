import { NextResponse } from "next/server";
import { isSchedulerCall } from "@/server/cron";
import { getDb } from "@/server/db/client";
import { runCron, type CronJob } from "@/server/jobs/jobs";

/** A scheduler entry point, protected by the scheduler secrets. */
export function cronHandler(name: CronJob) {
  return async function GET(request: Request) {
    if (!(await isSchedulerCall(getDb(), request))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await runCron(getDb(), name));
  };
}
