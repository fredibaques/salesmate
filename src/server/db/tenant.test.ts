import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "./client";
import { auditLog, projects } from "./schema";
import { withSystem, withTenant } from "./tenant";

let db: Db;
let close: () => Promise<void>;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  orgA = (await seedOrg(db, "A")).orgId;
  orgB = (await seedOrg(db, "B")).orgId;
});

afterAll(async () => close());

/** Drizzle wraps driver errors; the Postgres message lives in `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error },
  );
  expect(err, "expected the query to fail").not.toBeNull();
  expect(`${err!.message} ${err!.cause?.message ?? ""}`).toMatch(pattern);
}

describe("tenant isolation (RLS)", () => {
  it("only shows rows of the current organization", async () => {
    await withTenant(db, { orgId: orgA }, (tx) =>
      tx.insert(projects).values({ orgId: orgA, name: "Project A" }),
    );
    await withTenant(db, { orgId: orgB }, (tx) =>
      tx.insert(projects).values({ orgId: orgB, name: "Project B" }),
    );

    const seenByA = await withTenant(db, { orgId: orgA }, (tx) => tx.select().from(projects));
    expect(seenByA.map((p) => p.name)).toEqual(["Project A"]);

    const all = await withSystem(db, (tx) => tx.select().from(projects));
    expect(all).toHaveLength(2);
  });

  it("rejects writes into another organization", async () => {
    await expectDbError(
      withTenant(db, { orgId: orgA }, (tx) => tx.insert(projects).values({ orgId: orgB, name: "Sneaky" })),
      /row-level security/,
    );
  });

  it("cannot update or delete rows of another organization", async () => {
    const [b] = await withSystem(db, (tx) => tx.select().from(projects).where(eq(projects.orgId, orgB)));
    const updated = await withTenant(db, { orgId: orgA }, (tx) =>
      tx.update(projects).set({ name: "Hacked" }).where(eq(projects.id, b.id)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(db, { orgId: orgA }, (tx) =>
      tx.delete(projects).where(eq(projects.id, b.id)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("sees nothing when no organization is set", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role salesmate_app`);
      return tx.select().from(projects);
    });
    expect(rows).toHaveLength(0);
  });

  it("keeps the audit log append-only", async () => {
    await withTenant(db, { orgId: orgA }, (tx) =>
      tx.insert(auditLog).values({ orgId: orgA, actorType: "system", event: "test" }),
    );
    await expectDbError(
      withTenant(db, { orgId: orgA }, (tx) => tx.update(auditLog).set({ event: "changed" })),
      /permission denied/,
    );
    await expectDbError(
      withTenant(db, { orgId: orgA }, (tx) => tx.delete(auditLog)),
      /permission denied/,
    );
  });
});
