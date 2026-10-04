import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { member, organization, user } from "@/server/db/schema";
import { withSystem } from "@/server/db/tenant";

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const handle = createDb("pglite:memory");
  await runMigrations(handle.db, "pglite:memory");
  return handle;
}

/** Creates an organization with one owner user, bypassing RLS. */
export async function seedOrg(db: Db, name = "Org") {
  const orgId = randomUUID();
  const userId = randomUUID();
  await withSystem(db, async (tx) => {
    await tx.insert(user).values({
      id: userId,
      name: `${name} owner`,
      email: `${userId}@example.com`,
    });
    await tx.insert(organization).values({
      id: orgId,
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${orgId.slice(0, 6)}`,
      createdAt: new Date(),
    });
    await tx.insert(member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: new Date(),
    });
  });
  return { orgId, userId };
}
