import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { DEFAULT_COMPANY_COLUMNS, checkCell, type BaseColumn } from "@/lib/prospect-columns";
import type { Db } from "../db/client";
import { prospectBases, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent } from "../services/agents";
import { columnsPrompt, saveRowsSchema } from "./agent-schema";
import { ensureAgentBase, listBases, setAgentBase } from "./bases";
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
let other: TenantContext;
let projectId: string;
let baseId: string;

const COLUMNS: BaseColumn[] = [
  { id: "city", name: "Ciudad", type: "text", filledBy: "agent" },
  {
    id: "tipo",
    name: "Tipo de concesionario",
    type: "select",
    options: ["Oficial de marca", "Multimarca", "Compraventa"],
    filledBy: "agent",
    instructions: "Oficial si representa una marca.",
  },
  { id: "stock", name: "Vehículos en stock", type: "number", filledBy: "agent" },
  { id: "gestoria", name: "¿Gestoría propia?", type: "bool", filledBy: "agent" },
  { id: "email", name: "Email", type: "email", filledBy: "agent" },
  { id: "notas", name: "Notas del equipo", type: "long", filledBy: "person" },
];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Prosp");
  const b = await seedOrg(db, "Otra");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  other = { orgId: b.orgId, actorType: "user", actorId: b.userId };
  ({ projectId, baseId } = await withTenant(db, tenant, async (tx) => {
    const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Gestoría" }).returning();
    const [base] = await tx
      .insert(prospectBases)
      .values({ orgId: tenant.orgId, projectId: p.id, name: "Concesionarios", columns: COLUMNS })
      .returning();
    return { projectId: p.id, baseId: base.id };
  }));
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
    // People: the same person in the same company.
    expect(
      dedupeKey(
        { companyName: "Autos García", personName: "Luis García", website: "autosgarcia.es" },
        "person",
      ),
    ).toBe(
      dedupeKey(
        { companyName: "AUTOS GARCIA SL", personName: "luis garcia", website: "www.autosgarcia.es" },
        "person",
      ),
    );
  });
});

describe("column values", () => {
  it("checks each type and keeps only what fits", () => {
    const [city, tipo, stock, gestoria, email] = COLUMNS;
    expect(checkCell(tipo, "multimarca")).toEqual({ ok: true, value: "Multimarca" });
    expect(checkCell(tipo, "Taller")).toMatchObject({ ok: false });
    expect(checkCell(stock, "1.250")).toEqual({ ok: true, value: 1250 });
    expect(checkCell(gestoria, "sí")).toEqual({ ok: true, value: true });
    expect(checkCell(email, "VENTAS@x.es")).toEqual({ ok: true, value: "ventas@x.es" });
    expect(checkCell(email, "no-es-email")).toMatchObject({ ok: false });
    expect(checkCell(city, "  ")).toEqual({ ok: true, value: null });
  });
});

describe("saveProspects", () => {
  it("adds rows once with their column values and reports what didn't fit", async () => {
    const first = await saveProspects(db, tenant, {
      baseId,
      items: [
        {
          companyName: "Autos García",
          website: "https://autosgarcia.es",
          fitScore: 80,
          sources: ["https://autosgarcia.es/contacto"],
          fields: {
            city: "Málaga",
            tipo: "multimarca",
            stock: 140,
            "¿Gestoría propia?": false,
            email: "ventas@autosgarcia.es",
          },
        },
        { companyName: "Motor Sur", fields: { city: "Sevilla", tipo: "Taller", inventada: "x" } },
        { companyName: "" },
      ],
    });
    expect(first.added.map((p) => p.companyName)).toEqual(["Autos García", "Motor Sur"]);
    expect(first.invalid).toEqual([""]);
    const garcia = first.added[0];
    // Values by column id, whether sent by id or by name.
    expect(garcia.data).toEqual({
      city: "Málaga",
      tipo: "Multimarca",
      stock: 140,
      gestoria: false,
      email: "ventas@autosgarcia.es",
    });
    expect(garcia.cellMeta.city).toMatchObject({ by: "user" });
    // A value that doesn't fit is left out, not the whole row.
    expect(first.added[1].data).toEqual({ city: "Sevilla" });
    expect(first.fieldErrors).toEqual([
      expect.stringContaining("Tipo de concesionario"),
      expect.stringContaining("inventada: no es una columna"),
    ]);

    const second = await saveProspects(db, tenant, {
      baseId,
      items: [
        { companyName: "Autos Garcia SL", website: "www.autosgarcia.es" },
        { companyName: "Coches Norte", website: "cochesnorte.com" },
      ],
    });
    expect(second.added.map((p) => p.companyName)).toEqual(["Coches Norte"]);
    expect(second.duplicates).toEqual(["Autos Garcia SL"]);
    expect(
      await knownProspects(db, tenant, baseId, [
        { companyName: "Otra", website: "http://cochesnorte.com/" },
        { companyName: "Nueva" },
      ]),
    ).toEqual(["Otra"]);
  });

  it("lists, sorts by a column and searches", async () => {
    const byStock = await listProspects(db, tenant, baseId, { sort: "stock", dir: "desc" });
    expect(byStock.rows[0].companyName).toBe("Autos García");
    const found = await listProspects(db, tenant, baseId, { q: "norte" });
    expect(found.rows.map((r) => r.companyName)).toEqual(["Coches Norte"]);
    expect(found.matching).toBe(1);
    expect(found.total).toBe(3);
  });

  it("exports the base's columns as CSV and marks what it exported", async () => {
    const { rows } = await listProspects(db, tenant, baseId);
    await setProspectStatus(
      db,
      tenant,
      baseId,
      [rows.find((r) => r.companyName === "Motor Sur")!.id],
      "discarded",
    );
    const { csv, count } = await exportProspectsCsv(db, tenant, baseId, "pending");
    expect(count).toBe(2);
    expect(
      csv.startsWith(
        "﻿Empresa,Web,Ciudad,Tipo de concesionario,Vehículos en stock,¿Gestoría propia?,Email,Notas del equipo,Encaje",
      ),
    ).toBe(true);
    expect(csv).toContain(
      "Autos García,https://autosgarcia.es,Málaga,Multimarca,140,No,ventas@autosgarcia.es,,80",
    );
    expect(csv).not.toContain("Motor Sur");
    const after = await listProspects(db, tenant, baseId);
    expect(after.byStatus).toEqual({ exported: 2, discarded: 1 });
  });

  it("keeps bases out of other organizations' reach", async () => {
    expect(await listBases(db, other, projectId)).toEqual([]);
    await expect(listProspects(db, other, baseId)).rejects.toThrow(/no encontrada/);
  });
});

describe("bases of people", () => {
  it("needs the person's name and finds duplicates by person and company", async () => {
    const people = await withTenant(db, tenant, async (tx) => {
      const [b] = await tx
        .insert(prospectBases)
        .values({ orgId: tenant.orgId, projectId, name: "Responsables", rowKind: "person", columns: [] })
        .returning();
      return b.id;
    });
    const result = await saveProspects(db, tenant, {
      baseId: people,
      items: [
        { companyName: "Autos García", personName: "Luis García", website: "autosgarcia.es" },
        { companyName: "Autos García", personName: "Ana Ruiz", website: "autosgarcia.es" },
        { companyName: "Sin nombre de persona" },
      ],
    });
    expect(result.added.map((p) => p.personName)).toEqual(["Luis García", "Ana Ruiz"]);
    expect(result.invalid).toEqual(["Sin nombre de persona"]);
  });
});

describe("the agent's view of a base", () => {
  it("describes the columns it fills, not the ones for people", () => {
    const schema = saveRowsSchema("company", COLUMNS) as {
      properties: {
        prospects: { items: { properties: { fields: { properties: Record<string, { enum?: string[] }> } } } };
      };
    };
    const fields = schema.properties.prospects.items.properties.fields.properties;
    expect(Object.keys(fields)).toEqual(["city", "tipo", "stock", "gestoria", "email"]);
    expect(fields.tipo.enum).toEqual(["Oficial de marca", "Multimarca", "Compraventa"]);
    const prompt = columnsPrompt({ name: "Concesionarios", rowKind: "company", columns: COLUMNS });
    expect(prompt).toContain(
      "Tipo de concesionario (`tipo`, Selección única: Oficial de marca / Multimarca / Compraventa): Oficial si representa una marca.",
    );
    expect(prompt).not.toContain("Notas del equipo");
  });

  it("gives a new prospecting agent a base of its project", async () => {
    const [project] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name: "Nuevo" }).returning(),
    );
    const config = await addAgent(db, tenant, project.id, "outbound", "b2b_consultative");
    const bases = await listBases(db, tenant, project.id);
    expect(bases).toMatchObject([{ name: "Prospectos", rowKind: "company", agents: ["outbound"] }]);
    expect(bases[0].columns.map((c) => c.id)).toEqual(DEFAULT_COMPANY_COLUMNS.map((c) => c.id));
    expect((await ensureAgentBase(db, tenant, config.id)).id).toBe(bases[0].id);

    // It can be pointed at another base of its project, not at one of another project.
    const [second] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(prospectBases)
        .values({ orgId: tenant.orgId, projectId: project.id, name: "Talleres", columns: [] })
        .returning(),
    );
    await setAgentBase(db, tenant, project.id, config.id, second.id);
    expect((await ensureAgentBase(db, tenant, config.id)).id).toBe(second.id);
    await expect(setAgentBase(db, tenant, project.id, config.id, baseId)).rejects.toThrow(
      /es de otro proyecto/,
    );
  });
});
