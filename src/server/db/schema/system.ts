import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Platform-level settings, not tenant data: no org_id, and RLS on with no
 * policy, so the app role (salesmate_app) can't read them; only system paths
 * (withSystem, as the database owner) can.
 */

/**
 * Keys of the external schedulers allowed to call /api/cron/* (the Neon
 * Function in scripts/neon-scheduler). Only the SHA-256 of each key is
 * stored; the key itself lives in the scheduler's environment.
 */
export const schedulerKeys = pgTable("scheduler_keys", {
  name: text("name").primaryKey(),
  keyHash: text("key_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
