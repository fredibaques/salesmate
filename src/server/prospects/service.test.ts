import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import {
  dedupeKey,
  exportProspectsCsv,
  knownProspects,
  listProspects,
  normalizeDomain,
  saveProspects,
  setProspectStatus,
} from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Prosp");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  projectId = await withTenant(db, tenant, async (tx) => {
    const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Gestoría" }).returning();
    return p.id;
  });
});
afterAll(async () => close());

describe("dedupe", () => {
  it("normalizes websites and names", () => {
    expect(normalizeDomain("https://www.AutosGarcia.es/contacto")).toBe("autosgarcia.es");
    expect(normalizeDomain("autosgarcia.es")).toBe("autosgarcia.es");
    expect(normalizeDomain("no es una web")).toBeNull();
    expect(dedupeKey({ companyName: "Autos García S.L.", website: "www.autosgarcia.es" })).toBe(
      "web:autosgarcia.es",
    );
    expect(dedupeKey({ companyName: "Autos García, S.L.", city: "Málaga" })).toBe(
      dedupeKey({ companyName: "AUTOS GARCIA", city: "malaga" }),
    );
  });
});

describe("saveProspects", () => {
  it("adds new companies once and reports repeated and invalid ones", async () => {
    const first = await saveProspects(db, tenant, {
      projectId,
      items: [
        {
          companyName: "Autos García",
          website: "https://autosgarcia.es",
          city: "Málaga",
          email: "ventas@autosgarcia.es",
          fitScore: 80,
          sources: ["https://autosgarcia.es/contacto"],
        },
        { companyName: "Motor Sur", city: "Sevilla", email: "" },
        { companyName: "" },
      ],
    });
    expect(first.added.map((p) => p.companyName)).toEqual(["Autos García", "Motor Sur"]);
    expect(first.invalid).toEqual([""]);

    const second = await saveProspects(db, tenant, {
      projectId,
      items: [
        { companyName: "Autos Garcia SL", website: "www.autosgarcia.es" },
        { companyName: "Coches Norte", website: "cochesnorte.com" },
      ],
    });
    expect(second.added.map((p) => p.companyName)).toEqual(["Coches Norte"]);
    expect(second.duplicates).toEqual(["Autos Garcia SL"]);
    expect(
      await knownProspects(db, tenant, projectId, [
        { companyName: "Otra", website: "http://cochesnorte.com/" },
        { companyName: "Nueva" },
      ]),
    ).toEqual(["Otra"]);
  });

  it("exports as CSV and marks what it exported", async () => {
    const { rows } = await listProspects(db, tenant, projectId);
    await setProspectStatus(
      db,
      tenant,
      projectId,
      [rows.find((r) => r.companyName === "Motor Sur")!.id],
      "discarded",
    );
    const { csv, count } = await exportProspectsCsv(db, tenant, projectId, "pending");
    expect(count).toBe(2);
    expect(csv.startsWith("﻿Empresa,Web,")).toBe(true);
    expect(csv).toContain("Autos García,https://autosgarcia.es,");
    expect(csv).not.toContain("Motor Sur");
    const after = await listProspects(db, tenant, projectId);
    expect(after.byStatus).toEqual({ exported: 2, discarded: 1 });
  });
});
