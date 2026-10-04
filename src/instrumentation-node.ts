/**
 * Local convenience: with the embedded database (PGlite) migrations run when
 * the server starts, so `pnpm dev` works with zero setup. Real Postgres
 * databases are migrated explicitly with `pnpm db:migrate`.
 *
 * Skipped during `next build` (parallel workers; PGlite is single-process) and
 * on serverless hosts. A failure here is logged, never fatal: a crashing
 * instrumentation hook turns every request into a 500.
 */
import { getDb } from "./server/db/client";
import { runMigrations } from "./server/db/migrate";
import { env, isServerless } from "./server/env";

try {
  const url = env().DATABASE_URL;
  if (url.startsWith("pglite:") && !isServerless() && process.env.NEXT_PHASE !== "phase-production-build") {
    await runMigrations(getDb(), url);
  }
} catch (err) {
  console.error("[salesmate] Local migrations skipped:", err);
}
