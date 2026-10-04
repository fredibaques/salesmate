import "dotenv/config";
import { createDb } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { env } from "../src/server/env";

async function main() {
  const url = env().DATABASE_URL;
  const { db, close } = createDb(url);
  await runMigrations(db, url);
  await close();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
