import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent, customizeAgent, listSidebarAgents } from "./agents";
import { getNavPreferences, inOrder, NAV_SECTIONS, saveNavPreferences, sectionOrder } from "./preferences";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext & { userId: string };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Menu");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId, userId: seeded.userId };
});
afterAll(async () => close());

describe("sidebar preferences", () => {
  it("puts what the person ordered first and keeps new items after", () => {
    expect(inOrder(["a", "b", "c", "d"], (x) => x, ["c", "a"])).toEqual(["c", "a", "b", "d"]);
    expect(inOrder(["a", "b"], (x) => x, undefined)).toEqual(["a", "b"]);
  });

  it("saves the order per person and organization", async () => {
    expect(await getNavPreferences(db, tenant)).toEqual({});
    await saveNavPreferences(db, tenant, { sections: ["inbox", "home"], projects: [] });
    expect((await getNavPreferences(db, tenant)).sections).toEqual(["inbox", "home"]);
    await saveNavPreferences(db, tenant, {});
    expect((await getNavPreferences(db, tenant)).sections).toEqual([]);
    await expect(saveNavPreferences(db, tenant, { sections: ["otra" as "home"] })).rejects.toThrow();
  });

  it("gives an agent its own icon and colour, ignoring unknown ones", async () => {
    const [p] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name: "P" }).returning(),
    );
    await addAgent(db, tenant, p.id, "outbound", "b2b_consultative");
    await customizeAgent(db, tenant, p.id, "outbound", { name: "Radar", icon: "radar", color: "violeta" });
    expect(await listSidebarAgents(db, tenant)).toEqual([
      expect.objectContaining({ name: "Radar", icon: "radar", color: "violeta" }),
    ]);
    await customizeAgent(db, tenant, p.id, "outbound", { name: "", icon: "nope", color: "fucsia" });
    expect(await listSidebarAgents(db, tenant)).toEqual([
      expect.objectContaining({ name: null, icon: null, color: null }),
    ]);
  });
});

describe("sectionOrder", () => {
  it("keeps the person's order and puts sections added later where they go by default", () => {
    expect(sectionOrder(undefined)).toEqual([...NAV_SECTIONS]);
    expect(sectionOrder(["inbox", "home", "tables", "settings"])).toEqual([
      "inbox",
      "home",
      "tables",
      "knowledge",
      "integrations",
      "settings",
    ]);
  });
});
