import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { knowledgeSources } from "../src/server/db/schema";
import { env } from "../src/server/env";
import { reprocessTableSource } from "../src/server/knowledge/service";

/**
 * Re-reads every spreadsheet source with the current parser (from the
 * original file when it was kept, otherwise from the stored rows). Run after
 * improving how sheets are read: `pnpm tsx scripts/reprocess-tables.ts`.
 */
async function main() {
  const { db, close } = createDb(env().DATABASE_URL);
  // Listing across organizations needs the owner connection; each rebuild runs inside its tenant.
  const sources = await db
    .select({ id: knowledgeSources.id, orgId: knowledgeSources.orgId, name: knowledgeSources.name })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.kind, "table"));
  for (const s of sources) {
    try {
      const tables = await reprocessTableSource(
        db,
        { orgId: s.orgId, actorType: "system", actorId: "reprocess-tables" },
        s.id,
      );
      console.log(`${s.name}: ${tables.map((t) => `${t.name} (${t.rowCount} filas)`).join(", ")}`);
    } catch (err) {
      console.error(`${s.name}: ${(err as Error).message}`);
    }
  }
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
