import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import {
  getBusinessProfile,
  getProjectAudience,
  getSalesProfile,
  projectSales,
  saveBusinessProfile,
  saveProjectAudience,
} from "./business";
import { createProject } from "./projects";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let other: TenantContext;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const a = await seedOrg(db, "Swipoo");
  const b = await seedOrg(db, "Otra");
  tenant = { orgId: a.orgId, actorType: "user", actorId: a.userId };
  other = { orgId: b.orgId, actorType: "user", actorId: b.userId };
});
afterAll(async () => close());

describe("business and project", () => {
  it("shares the business with every project and lets each narrow who it's for", async () => {
    // A project from before «Tu negocio» keeps its own profile until the business is described.
    const old = await createProject(db, tenant, { name: "Antiguo" });
    await withTenant(db, tenant, (tx) =>
      tx
        .update(projects)
        .set({ salesProfile: { offer: "Lo de antes", segment: { include: ["Talleres"] } } })
        .where(eq(projects.id, old.id)),
    );
    expect(await getBusinessProfile(db, tenant)).toBeNull();
    expect((await getSalesProfile(db, tenant, old.id)).offer).toBe("Lo de antes");

    await saveBusinessProfile(db, tenant, {
      website: "https://swipoo.com",
      offer: "Transferencias de vehículos en 24 h",
      segment: { include: ["Concesionarios"], exclude: ["Particulares"] },
      tone: "Cercano",
    });
    const project = await createProject(db, tenant, { name: "Andalucía", description: "20 reuniones" });
    await saveProjectAudience(db, tenant, project.id, {
      audience: { segment: { include: [], exclude: [], geography: ["Andalucía"] } },
    });
    const sales = await projectSales(db, tenant, { salesProfile: project.salesProfile, website: null });
    expect(sales.website).toBe("https://swipoo.com");

    // Empty audience: the business's customer, with the project's zones.
    let profile = await getSalesProfile(db, tenant, project.id);
    expect(profile).toMatchObject({
      offer: "Transferencias de vehículos en 24 h",
      tone: "Cercano",
      segment: { include: ["Concesionarios"], exclude: ["Particulares"], geography: ["Andalucía"] },
    });

    await saveProjectAudience(db, tenant, project.id, {
      goal: "30 reuniones con compraventas",
      audience: { segment: { include: ["Compraventas"], exclude: [], geography: [] } },
    });
    profile = await getSalesProfile(db, tenant, project.id);
    expect(profile.segment).toEqual({ include: ["Compraventas"], exclude: ["Particulares"], geography: [] });
    expect(await getProjectAudience(db, tenant, project.id)).toMatchObject({
      goal: "30 reuniones con compraventas",
    });
    // Once the business is described, the old project sells what the business sells.
    expect((await getSalesProfile(db, tenant, old.id)).offer).toBe("Transferencias de vehículos en 24 h");
  });

  it("keeps each organization's business to itself", async () => {
    expect(await getBusinessProfile(db, other)).toBeNull();
    await saveBusinessProfile(db, other, { offer: "Otra cosa" });
    expect((await getBusinessProfile(db, tenant))?.offer).toBe("Transferencias de vehículos en 24 h");
  });
});
