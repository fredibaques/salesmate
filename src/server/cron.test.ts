import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import type { Db } from "./db/client";
import { schedulerKeys } from "./db/schema";
import { withSystem, withTenant } from "./db/tenant";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  process.env.CRON_SECRET = "secret-de-github-actions";
  ({ db, close } = await createTestDb());
  // The Neon Function's key: only its hash is stored (as the setup README does).
  await withSystem(db, (tx) =>
    tx.execute(
      sql`insert into scheduler_keys (name, key_hash) values ('neon', encode(sha256('clave-de-la-funcion-de-neon'::bytea), 'hex'))`,
    ),
  );
});

afterAll(async () => close());

describe("isSchedulerCall", () => {
  it("accepts the environment secret or a registered key, and nothing else", async () => {
    const { isSchedulerCall } = await import("./cron");
    const call = (auth?: string) =>
      isSchedulerCall(
        db,
        new Request("https://x/api/cron/agents", auth ? { headers: { authorization: auth } } : {}),
      );
    expect(await call("Bearer secret-de-github-actions")).toBe(true);
    expect(await call("Bearer clave-de-la-funcion-de-neon")).toBe(true);
    expect(await call("Bearer otra")).toBe(false);
    expect(await call("Bearer ")).toBe(false);
    expect(await call("clave-de-la-funcion-de-neon")).toBe(false);
    expect(await call()).toBe(false);
  });

  it("keeps the keys out of the app role's reach", async () => {
    const visible = await withTenant(db, { orgId: "any" }, (tx) => tx.select().from(schedulerKeys));
    expect(visible).toHaveLength(0);
  });
});
