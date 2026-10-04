/**
 * Local convenience: with the embedded database (PGlite) migrations run when
 * the server starts, so `pnpm dev` works with zero setup. Real Postgres
 * databases are migrated explicitly with `pnpm db:migrate`.
 *
 * Skipped during `next build`: build workers run in parallel and PGlite is a
 * single-process database.
 */
import { getDb } from "./server/db/client";
import { runMigrations } from "./server/db/migrate";

const url = process.env.DATABASE_URL ?? "pglite:./.data/pglite";
if (url.startsWith("pglite:") && process.env.NEXT_PHASE !== "phase-production-build") {
  await runMigrations(getDb(), url);
}
