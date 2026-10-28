/**
 * Neon Function that runs SalesMate's agents next to the database, so the
 * minutes they spend waiting on the model don't run on Vercel. Two callers:
 *
 * - The app (`sendToWorker`): POST a job (`src/server/jobs/jobs.ts`) with
 *   `Authorization: Bearer <WORKER_SECRET>`. It answers 202 at once and runs
 *   the job afterwards, up to the platform's 15 minutes.
 * - Neon schedule triggers: run the scheduler's three passes and answer with
 *   what they did (these replace the app's /api/cron calls).
 *
 * Environment: the app's server variables (DATABASE_URL, ENCRYPTION_KEY,
 * GOOGLE_CLIENT_ID/SECRET, JINA_API_KEY, APP_URL…) plus WORKER_SECRET.
 * Build and deploy: see README.md.
 */
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@neon/functions";
import { getDb } from "@/server/db/client";
import { CRON_JOBS, parseJob, runCron, runJob } from "@/server/jobs/jobs";

function authorized(request: Request) {
  const secret = process.env.WORKER_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return (
    secret.length >= 32 &&
    given.length === secret.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  );
}

async function scheduled() {
  const db = getDb();
  const results = await Promise.all(
    CRON_JOBS.map(async (name) => {
      const started = Date.now();
      try {
        return { name, ms: Date.now() - started, result: await runCron(db, name) };
      } catch (err) {
        return { name, ms: Date.now() - started, error: String(err) };
      }
    }),
  );
  console.log(JSON.stringify({ scheduled: true, results }));
  // Always 200: the next tick retries whatever failed, so a trigger retry would only repeat work.
  return Response.json({ ok: results.every((r) => !("error" in r)), results });
}

const worker = {
  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    // Only Neon's trigger system can set this header (it strips client ones).
    if (request.headers.get("x-neon-trigger-invocation-id")) return scheduled();
    if (!authorized(request)) return new Response("unauthorized", { status: 401 });
    const job = parseJob(await request.json().catch(() => null));
    if (!job) return new Response("invalid job", { status: 400 });
    const started = Date.now();
    waitUntil(
      runJob(job).then(
        (result) =>
          console.log(JSON.stringify({ job: job.kind, ms: Date.now() - started, result }).slice(0, 2000)),
        (err) =>
          console.error(JSON.stringify({ job: job.kind, ms: Date.now() - started, error: String(err) })),
      ),
    );
    return new Response(null, { status: 202 });
  },
};

export default worker;
