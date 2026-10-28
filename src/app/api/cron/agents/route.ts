import { cronHandler } from "../cron-handler";

export const maxDuration = 300;

/** Agents that work on their own (prospecting) and agents with pending events (see `runCron`). */
export const GET = cronHandler("agents");
