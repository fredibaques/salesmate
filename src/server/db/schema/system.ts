import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

/**
 * Public web pages read by the completion engine, kept 30 days so the same
 * company's site is never read (or paid for, through Jina) twice in that
 * time, whatever table or organization asks. Only what any visitor sees.
 */
export const webPages = pgTable("web_pages", {
  /** The address asked for (normalized, no fragment). */
  url: text("url").primaryKey(),
  /** Where it ended after redirects. */
  finalUrl: text("final_url").notNull(),
  title: text("title").notNull().default(""),
  text: text("text").notNull(),
  /** The page's HTML, capped: the engine reads its links (mailto, tel, socials). */
  html: text("html").notNull().default(""),
  links: jsonb("links").$type<{ url: string; text: string }[]>().notNull().default([]),
  viaJina: boolean("via_jina").notNull().default(false),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
