import path from "node:path";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Db } from "./client";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(db: Db, url: string): Promise<void> {
  if (url.startsWith("pglite:")) {
    await migratePglite(db as unknown as PgliteDatabase, { migrationsFolder });
  } else {
    await migratePostgres(db as unknown as PostgresJsDatabase, { migrationsFolder });
  }
}
