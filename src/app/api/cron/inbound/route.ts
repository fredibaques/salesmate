import { cronHandler } from "../cron-handler";

export const maxDuration = 300;

/** Reads new mail, runs the inbound agent on pending events and reads Meet transcripts (see `runCron`). */
export const GET = cronHandler("inbound");
