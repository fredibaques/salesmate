import { randomBytes } from "node:crypto";

/** Deterministic-enough secrets for tests that touch encryption. */
export function setTestEnv() {
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.DATABASE_URL ??= "pglite:memory";
}
