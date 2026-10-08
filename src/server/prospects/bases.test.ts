import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import { columnId } from "@/lib/prospect-columns";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent } from "../services/agents";
import {
  baseAgents,
  createBase,
  deleteBase,
  ensureAgentBase,
  getBase,
  listAllBases,
  listBases,
  moveColumn,
  removeColumn,
  renameBase,
  saveColumn,
  setAgentBase,
  setBaseProject,
  setColumnHidden,
} from "./bases";
import { proposeColumns } from "./propose-columns";
import { addProspectRow, getProspect, listProspects, saveProspects, updateProspectRow } from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Bases");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(projects)
      .values({ orgId: tenant.orgId, name: "Swipoo", description: "Transferencias de vehículos" })
      .returning(),
  );
  projectId = p.id;
});
afterAll(async () => close());

describe("column ids", () => {
  it("come from the name, unique and clear of the table's own keys", () => {
    expect(columnId("¿Gestoría propia?", [])).toBe("gestoria_propia");
    expect(columnId("Stock", ["stock"])).toBe("stock_2");
    expect(columnId("Web", [])).toBe("web_col");
    expect(columnId("¿?", [])).toBe("columna");
  });
});

describe("bases", () => {
  it("are created with their columns, renamed and deleted", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "Concesionarios",
      rowKind: "company",
      columns: [
        { name: "Provincia", type: "select", options: ["Málaga", "Sevilla", "Málaga"] },
        { name: "Vehículos en stock", type: "number", instructions: "Publicados en su web." },
      ],
    });
    expect(base.columns).toEqual([
      {
        id: "provincia",
        name: "Provincia",
        type: "select",
        options: ["Málaga", "Sevilla"],
        filledBy: "agent",
      },
      {
        id: "vehiculos_en_stock",
        name: "Vehículos en stock",
        type: "number",
        instructions: "Publicados en su web.",
        filledBy: "agent",
      },
    ]);
    await expect(
      createBase(db, tenant, projectId, {
        name: "Mal",
        rowKind: "company",
        columns: [{ name: "Tipo", type: "select", options: [] }],
      }),
    ).rejects.toThrow(/al menos una opción/);
    await expect(
      createBase(db, tenant, projectId, {
        name: "Repetida",
        rowKind: "company",
        columns: [
          { name: "Tipo", type: "text" },
          { name: "tipo", type: "text" },
        ],
      }),
    ).rejects.toThrow(/Ya hay una columna «tipo»/);

    expect((await renameBase(db, tenant, base.id, "Concesionarios Andalucía")).name).toBe(
      "Concesionarios Andalucía",
    );
    await deleteBase(db, tenant, base.id);
    expect(await getBase(db, tenant, base.id)).toBeNull();
  });

  it("send an agent back to another base of the project when its own is deleted", async () => {
    const [project] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name: "Agente" }).returning(),
    );
    const agent = await addAgent(db, tenant, project.id, "outbound", "b2b_consultative");
    const first = await ensureAgentBase(db, tenant, agent.id);
    const second = await createBase(db, tenant, project.id, { name: "Otra", rowKind: "person", columns: [] });
    await deleteBase(db, tenant, first.id);
    expect((await ensureAgentBase(db, tenant, agent.id)).id).toBe(second.id);
    expect(await listBases(db, tenant, project.id)).toMatchObject([{ name: "Otra", agents: ["outbound"] }]);
  });
});

describe("columns", () => {
  it("are added, changed, moved, hidden and removed, keeping values that still fit", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "Columnas",
      rowKind: "company",
      columns: [{ name: "Tipo", type: "text" }],
    });
    await saveProspects(db, tenant, {
      baseId: base.id,
      items: [
        { companyName: "Autos García", fields: { tipo: "Multimarca" } },
        { companyName: "Motor Sur", fields: { tipo: "Taller" } },
      ],
    });

    const added = await saveColumn(db, tenant, base.id, { name: "Stock", type: "number", filledBy: "both" });
    expect(added.column).toMatchObject({ id: "stock", filledBy: "both" });
    await expect(saveColumn(db, tenant, base.id, { name: "STOCK", type: "text" })).rejects.toThrow(
      /Ya hay una columna/,
    );

    // Becoming a choice: values that are one of the options stay, the rest are cleared.
    const changed = await saveColumn(
      db,
      tenant,
      base.id,
      { name: "Tipo de concesionario", type: "select", options: ["Multimarca", "Oficial"] },
      "tipo",
    );
    expect(changed).toMatchObject({ column: { id: "tipo", name: "Tipo de concesionario" }, cleared: 1 });
    const { rows } = await listProspects(db, tenant, base.id, { sort: "name" });
    expect(rows.map((r) => r.data)).toEqual([{ tipo: "Multimarca" }, {}]);

    await moveColumn(db, tenant, base.id, "stock", -1);
    await setColumnHidden(db, tenant, base.id, "tipo", true);
    expect((await getBase(db, tenant, base.id))!.columns).toMatchObject([
      { id: "stock" },
      { id: "tipo", hidden: true },
    ]);

    await removeColumn(db, tenant, base.id, "tipo");
    expect((await getBase(db, tenant, base.id))!.columns.map((c) => c.id)).toEqual(["stock"]);
    const after = await listProspects(db, tenant, base.id, { sort: "name" });
    expect(after.rows.map((r) => [r.data, r.cellMeta])).toEqual([
      [{}, {}],
      [{}, {}],
    ]);
  });
});

describe("rows edited by people", () => {
  it("are added and changed by hand, marking who wrote each cell", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "A mano",
      rowKind: "company",
      columns: [
        { name: "Ciudad", type: "text" },
        { name: "Stock", type: "number" },
        { name: "Notas", type: "long", filledBy: "person" },
      ],
    });
    const added = await addProspectRow(db, tenant, base.id, {
      companyName: "Autos García",
      website: "autosgarcia.es",
      fields: { ciudad: "Málaga", stock: "", notas: "Llamar el lunes" },
    });
    expect(added.data).toEqual({ ciudad: "Málaga", notas: "Llamar el lunes" });
    await expect(
      addProspectRow(db, tenant, base.id, {
        companyName: "Autos Garcia SL",
        website: "www.autosgarcia.es",
        fields: {},
      }),
    ).rejects.toThrow(/Ya hay otra fila igual/);
    await expect(
      addProspectRow(db, tenant, base.id, { companyName: "Motor Sur", fields: { stock: "muchos" } }),
    ).rejects.toThrow(/Stock: debe ser un número/);

    // An agent row, then a person corrects one value and clears another.
    const { added: fromAgent } = await saveProspects(
      db,
      { ...tenant, actorType: "agent", actorId: "run" },
      { baseId: base.id, items: [{ companyName: "Motor Sur", fields: { ciudad: "Sevila", stock: 40 } }] },
    );
    const row = fromAgent[0];
    expect(row.cellMeta.ciudad).toMatchObject({ by: "agent" });
    const result = await updateProspectRow(db, tenant, base.id, row.id, {
      companyName: "Motor Sur",
      fitScore: 70,
      fields: { ciudad: "Sevilla", stock: "", notas: "" },
    });
    expect(result.changed).toBe(3);
    const saved = (await getProspect(db, tenant, base.id, row.id))!;
    expect(saved.data).toEqual({ ciudad: "Sevilla" });
    expect(saved.fitScore).toBe(70);
    expect(saved.cellMeta.ciudad).toMatchObject({ by: "user", userId: tenant.actorId });
    expect(saved.cellMeta.stock).toBeUndefined();

    // Becoming the same company as another row is refused.
    await expect(
      updateProspectRow(db, tenant, base.id, row.id, {
        companyName: "Motor Sur",
        website: "https://autosgarcia.es",
        fields: {},
      }),
    ).rejects.toThrow(/Ya hay otra fila igual/);
    await expect(
      updateProspectRow(db, tenant, base.id, row.id, { companyName: "", fields: {} }),
    ).rejects.toThrow(/Falta el nombre/);
  });
});

describe("proposeColumns", () => {
  it("asks for structured columns and keeps the ones that make sense", async () => {
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "text",
            text: JSON.stringify({
              columns: [
                {
                  name: "Tipo de concesionario",
                  type: "select",
                  options: ["Oficial de marca", "Multimarca"],
                  instructions: "Oficial si representa una marca.",
                  filledBy: "agent",
                  recommended: true,
                },
                {
                  name: "Provincia",
                  type: "select",
                  options: [],
                  instructions: "",
                  filledBy: "agent",
                  recommended: true,
                },
                {
                  name: "Notas",
                  type: "long",
                  options: [],
                  instructions: "",
                  filledBy: "person",
                  recommended: false,
                },
                {
                  name: "notas",
                  type: "text",
                  options: [],
                  instructions: "",
                  filledBy: "agent",
                  recommended: true,
                },
                {
                  name: "",
                  type: "text",
                  options: [],
                  instructions: "",
                  filledBy: "agent",
                  recommended: true,
                },
              ],
            }),
          },
        ],
      },
    ]);
    const proposals = await proposeColumns({ db, llm }, tenant, {
      projectId,
      rowKind: "company",
      name: "Concesionarios",
      brief: "Si tienen gestoría propia",
    });
    expect(proposals).toEqual([
      {
        name: "Tipo de concesionario",
        type: "select",
        options: ["Oficial de marca", "Multimarca"],
        instructions: "Oficial si representa una marca.",
        filledBy: "agent",
        recommended: true,
      },
      // A choice without options becomes text.
      { name: "Provincia", type: "text", filledBy: "agent", recommended: true },
      { name: "Notas", type: "long", filledBy: "person", recommended: false },
    ]);
    expect(requests[0].output_config?.format?.type).toBe("json_schema");
    const prompt = JSON.stringify(requests[0].messages);
    expect(prompt).toContain("Transferencias de vehículos");
    expect(prompt).toContain("Si tienen gestoría propia");
  });
});

describe("listAllBases", () => {
  it("lists the bases of every project, the most recently active first", async () => {
    const [other] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name: "Otro proyecto" }).returning(),
    );
    const quiet = await createBase(db, tenant, other.id, {
      name: "Sin movimiento",
      rowKind: "company",
      columns: [],
    });
    const busy = await createBase(db, tenant, projectId, {
      name: "Con filas",
      rowKind: "person",
      columns: [],
    });
    await new Promise((r) => setTimeout(r, 5));
    await saveProspects(db, tenant, {
      baseId: busy.id,
      items: [{ companyName: "Autos García", personName: "Luis García" }],
    });
    const all = await listAllBases(db, tenant);
    const mine = all.filter((b) => b.id === quiet.id || b.id === busy.id);
    expect(mine.map((b) => [b.name, b.projectName, b.rows])).toEqual([
      ["Con filas", "Swipoo", 1],
      ["Sin movimiento", "Otro proyecto", 0],
    ]);
  });
});

describe("tables on their own", () => {
  it("exist without a project, join one later with their rows, and agents of any project can use them", async () => {
    const solo = await createBase(db, tenant, null, {
      name: "Contactos web",
      rowKind: "person",
      columns: [],
    });
    expect(solo.projectId).toBeNull();
    await saveProspects(db, tenant, {
      baseId: solo.id,
      items: [{ companyName: "Autos García", personName: "Luis García" }],
    });
    const listed = (await listAllBases(db, tenant)).find((b) => b.id === solo.id)!;
    expect([listed.projectName, listed.rows]).toEqual([null, 1]);
    expect((await listBases(db, tenant, projectId)).some((b) => b.id === solo.id)).toBe(false);
    expect((await listBases(db, tenant, projectId, { standalone: true })).some((b) => b.id === solo.id)).toBe(
      true,
    );

    const agent = await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
    await setAgentBase(db, tenant, projectId, agent.id, solo.id);
    expect(await baseAgents(db, tenant, solo.id)).toEqual([
      expect.objectContaining({ projectId, agentType: "outbound", label: "Agente outbound" }),
    ]);

    await setBaseProject(db, tenant, solo.id, projectId);
    expect((await listAllBases(db, tenant, { projectId })).map((b) => b.id)).toContain(solo.id);
    const [row] = (await listProspects(db, tenant, solo.id, {})).rows;
    expect(row.projectId).toBe(projectId);
    await setBaseProject(db, tenant, solo.id, null);
    expect((await getBase(db, tenant, solo.id))!.projectId).toBeNull();
  });
});
