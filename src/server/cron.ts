import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { schedulerKeys } from "./db/schema";
import { withSystem } from "./db/tenant";
import { env } from "./env";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function same(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Whether a scheduler call is genuine (`Authorization: Bearer <key>`): the
 * CRON_SECRET of the environment (GitHub Actions), or a key whose hash is in
 * `scheduler_keys` (the Neon Function in scripts/neon-scheduler).
 */
export async function isSchedulerCall(db: Db, request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const given = header.slice("Bearer ".length);
  if (!given) return false;
  const secret = env().CRON_SECRET;
  if (secret && same(given, secret)) return true;
  const hash = sha256(given);
  const [row] = await withSystem(db, (tx) =>
    tx.select({ keyHash: schedulerKeys.keyHash }).from(schedulerKeys).where(eq(schedulerKeys.keyHash, hash)),
  );
  return Boolean(row && same(row.keyHash, hash));
}
