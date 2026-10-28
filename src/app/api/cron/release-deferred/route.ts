import { cronHandler } from "../cron-handler";

/** Executes deferred actions whose send window or daily limit has opened (see `runCron`). */
export const GET = cronHandler("release-deferred");
