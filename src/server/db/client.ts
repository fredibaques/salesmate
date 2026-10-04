import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/**
 * DATABASE_URL forms:
 *   postgres://user:pass@host/db  → real Postgres (Neon, Supabase, local)
 *   pglite:./.data/pglite         → embedded Postgres persisted on disk (local dev)
 *   pglite:memory                 → embedded, in-memory (tests)
 */
export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  if (url.startsWith("pglite:")) {
    const target = url.slice("pglite:".length);
    const client = new PGlite(target === "memory" ? undefined : target);
    return {
      db: drizzlePglite(client, { schema }) as unknown as Db,
      close: () => client.close(),
    };
  }
  const client = postgres(url, { max: 10, prepare: false });
  return {
    db: drizzlePostgres(client, { schema }) as unknown as Db,
    close: () => client.end(),
  };
}

const globalForDb = globalThis as unknown as { __salesmateDb?: Db };

/** Process-wide database handle (reused across hot reloads in dev). */
export function getDb(): Db {
  globalForDb.__salesmateDb ??= createDb(env().DATABASE_URL).db;
  return globalForDb.__salesmateDb;
}
