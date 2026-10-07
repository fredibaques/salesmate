/**
 * Neon Function that drives SalesMate's schedule. Two Neon schedule triggers
 * invoke it (every 15 minutes by day, hourly by night, UTC); it calls the
 * app's scheduler endpoints, which decide what is due. Neon triggers fire
 * reliably and need no server of our own; GitHub Actions stays as a backup
 * (every call is idempotent: slots are claimed in the database).
 *
 * Environment: APP_URL (e.g. https://salesmate-mu.vercel.app) and
 * SCHEDULER_SECRET (its key; the app keeps only its hash). Deploy: see README.md.
 */

const ENDPOINTS = ["inbound", "agents", "release-deferred"];

async function call(path) {
  const started = Date.now();
  try {
    const response = await fetch(`${process.env.APP_URL}/api/cron/${path}`, {
      headers: { authorization: `Bearer ${process.env.SCHEDULER_SECRET}` },
      // Vercel cuts the app's function at 5 minutes.
      signal: AbortSignal.timeout(6 * 60_000),
    });
    const body = await response.text();
    return { path, status: response.status, ms: Date.now() - started, body: body.slice(0, 2000) };
  } catch (err) {
    return { path, error: String(err), ms: Date.now() - started };
  }
}

const scheduler = {
  async fetch(request) {
    // Only Neon's trigger system can set this header (it strips client ones).
    if (request.method !== "POST" || !request.headers.get("x-neon-trigger-invocation-id")) {
      return new Response("forbidden", { status: 403 });
    }
    if (!process.env.APP_URL || !process.env.SCHEDULER_SECRET) {
      return Response.json({ ok: false, error: "APP_URL or SCHEDULER_SECRET missing" }, { status: 500 });
    }
    const payload = await request.json().catch(() => ({}));
    const results = await Promise.all(ENDPOINTS.map(call));
    const ok = results.every((r) => r.status === 200);
    console.log(JSON.stringify({ scheduledAt: payload?.data?.scheduled_at, ok, results }));
    // Always 200: the next tick retries whatever failed, so a trigger retry
    // would only repeat work.
    return Response.json({ ok, results });
  },
};

export default scheduler;
