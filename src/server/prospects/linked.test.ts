import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import { runProspecting } from "../agents/prospector";
import type { Db } from "../db/client";
import { agentConfigs, projects, prospects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { canSeeBase } from "../services/access";
import { addAgent, saveAgentInstructions, setAgentEnabled } from "../services/agents";
import {
  createBase,
  deleteBase,
  getBase,
  linkedRowsOf,
  listAllBases,
  listBases,
  removeColumn,
  saveColumn,
  setAgentBase,
  setBaseProjects,
  tablesByProject,
  type ProspectBase,
} from "./bases";
import { linkedRowsToSearch, recordLinkedSearches } from "./linked";
import {
  deleteProspects,
  getProspect,
  linkedRows,
  listProspects,
  saveProspects,
  searchRows,
  setProspectCell,
  tableForExport,
} from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
const projectIds: string[] = [];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Relaciones");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  for (const name of ["Swipoo", "Gestorías", "Flotas"]) {
    const [p] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name, timezone: "Europe/Madrid" }).returning(),
    );
    projectIds.push(p.id);
  }
});
afterAll(async () => close());

/** A table of companies and one of their people, related. */
async function companiesAndPeople(name: string) {
  const companies = await createBase(db, tenant, projectIds[0], {
    name: `${name} · empresas`,
    rowKind: "company",
    columns: [
      { name: "Ciudad", type: "text" },
      { name: "Fase", type: "stage", options: ["Nuevo", "Interesado"], filledBy: "person" },
    ],
  });
  const people = await createBase(db, tenant, projectIds[0], {
    name: `${name} · contactos`,
    rowKind: "person",
    columns: [{ name: "Cargo", type: "text" }],
  });
  const { column } = await saveColumn(db, tenant, people.id, {
    name: "Empresa relacionada",
    type: "link",
    linkBaseId: companies.id,
  });
  const { added } = await saveProspects(db, tenant, {
    baseId: companies.id,
    items: [
      {
        companyName: "Autos Ruiz",
        website: "autosruiz.es",
        fields: { ciudad: "Málaga", fase: "Interesado" },
      },
      { companyName: "Motor Sur", website: "motorsur.es", fields: { ciudad: "Sevilla", fase: "Nuevo" } },
      { companyName: "Coches Norte", website: "cochesnorte.es", fields: { fase: "Interesado" } },
    ],
  });
  const [ruiz, sur, norte] = added;
  return { companies, people: (await getBase(db, tenant, people.id))!, column, ruiz, sur, norte };
}

describe("a relation column", () => {
  it("points each row at a row of the other table, by name in the table", async () => {
    const { people, column, ruiz, sur } = await companiesAndPeople("Ver");
    expect(column).toMatchObject({ type: "link", linkBaseId: ruiz.baseId, filledBy: "agent" });
    const { added, fieldErrors } = await saveProspects(db, tenant, {
      baseId: people.id,
      items: [
        // Without a company of its own, a person linked to one works there.
        { personName: "Ana Ruiz", parentId: ruiz.id, fields: { cargo: "Gerente" } },
        { personName: "Luis Gil", companyName: "Motor Sur", fields: { [column.id]: sur.id } },
        // Not a row of the companies' table: saved, without the relation.
        { personName: "Eva Sanz", companyName: "Otra", parentId: people.id },
      ],
    });
    expect(added.map((r) => [r.personName, r.companyName, r.parentId])).toEqual([
      ["Ana Ruiz", "Autos Ruiz", ruiz.id],
      ["Luis Gil", "Motor Sur", sur.id],
      ["Eva Sanz", "Otra", null],
    ]);
    expect(fieldErrors).toEqual(["Eva Sanz · Empresa relacionada: no es una fila de la tabla relacionada"]);
    expect(added[0].data).toEqual({ cargo: "Gerente" });

    const listed = await listProspects(db, tenant, people.id, { sort: column.id, dir: "asc" });
    expect(listed.rows.map((r) => [r.personName, r.parentName])).toEqual([
      ["Ana Ruiz", "Autos Ruiz"],
      ["Luis Gil", "Motor Sur"],
      ["Eva Sanz", null],
    ]);
    const filtered = await listProspects(db, tenant, people.id, {
      filters: [{ key: column.id, op: "contains", value: "motor" }],
    });
    expect(filtered.rows.map((r) => r.personName)).toEqual(["Luis Gil"]);
    const grouped = await listProspects(db, tenant, people.id, { group: column.id });
    expect(grouped.groups).toEqual([
      { value: "Autos Ruiz", n: 1 },
      { value: "Motor Sur", n: 1 },
      { value: null, n: 1 },
    ]);

    const exported = await tableForExport(db, tenant, people.id);
    const at = exported.header.indexOf("Empresa relacionada");
    expect(exported.rows.map((r) => r[at])).toEqual(["Autos Ruiz", "Motor Sur", ""]);
  });

  it("is picked and changed from the table, only among the rows of the other table", async () => {
    const { people, column, ruiz, sur } = await companiesAndPeople("Editar");
    const [ana] = (
      await saveProspects(db, tenant, {
        baseId: people.id,
        items: [{ personName: "Ana", parentId: ruiz.id }],
      })
    ).added;
    expect((await searchRows(db, tenant, ruiz.baseId, "mot")).map((r) => r.name)).toEqual(["Motor Sur"]);

    await setProspectCell(db, tenant, people.id, ana.id, column.id, sur.id);
    const moved = await getProspect(db, tenant, people.id, ana.id);
    expect(moved?.parentId).toBe(sur.id);
    expect(moved?.cellMeta[column.id]).toMatchObject({ by: "user" });
    // The company it had stays: it was set when the relation was made.
    expect(moved?.companyName).toBe("Autos Ruiz");

    await expect(setProspectCell(db, tenant, people.id, ana.id, column.id, ana.id)).rejects.toThrow(
      /ya no está en la tabla relacionada/,
    );
    await expect(setProspectCell(db, tenant, people.id, ana.id, column.id, "Motor Sur")).rejects.toThrow(
      /elige una fila/,
    );
    await setProspectCell(db, tenant, people.id, ana.id, column.id, null);
    expect((await getProspect(db, tenant, people.id, ana.id))?.parentId).toBeNull();
  });

  it("is one per table, to another table", async () => {
    const { people, companies } = await companiesAndPeople("Una");
    await expect(
      saveColumn(db, tenant, people.id, { name: "Otra", type: "link", linkBaseId: companies.id }),
    ).rejects.toThrow(/solo puede tener una/);
    await expect(
      saveColumn(db, tenant, companies.id, { name: "Yo", type: "link", linkBaseId: companies.id }),
    ).rejects.toThrow(/consigo misma/);
    await expect(saveColumn(db, tenant, companies.id, { name: "Sin", type: "link" })).rejects.toThrow(
      /Elige la tabla/,
    );
  });

  it("unlinks every row when it points at another table or goes away", async () => {
    const { people, column, ruiz } = await companiesAndPeople("Quitar");
    const other = await createBase(db, tenant, null, { name: "Otras", rowKind: "company", columns: [] });
    await saveProspects(db, tenant, { baseId: people.id, items: [{ personName: "Ana", parentId: ruiz.id }] });
    await saveColumn(db, tenant, people.id, { ...column, linkBaseId: other.id }, column.id);
    expect((await listProspects(db, tenant, people.id)).rows.map((r) => r.parentId)).toEqual([null]);

    await saveColumn(db, tenant, people.id, { ...column, linkBaseId: ruiz.baseId }, column.id);
    const [ana] = (await listProspects(db, tenant, people.id)).rows;
    await setProspectCell(db, tenant, people.id, ana.id, column.id, ruiz.id);
    await removeColumn(db, tenant, people.id, column.id);
    expect((await listProspects(db, tenant, people.id)).rows.map((r) => r.parentId)).toEqual([null]);
  });
});

describe("deleting", () => {
  it("a company deletes its people, and the company shows them before", async () => {
    const { people, ruiz, sur } = await companiesAndPeople("Borrar");
    await saveProspects(db, tenant, {
      baseId: people.id,
      items: [
        { personName: "Ana", parentId: ruiz.id },
        { personName: "Pepe", parentId: ruiz.id },
        { personName: "Luis", parentId: sur.id },
      ],
    });
    const linked = await linkedRows(db, tenant, ruiz.id);
    expect(linked.total).toBe(2);
    expect(linked.rows.map((r) => [r.name, r.baseName])).toEqual([
      ["Ana", "Borrar · contactos"],
      ["Pepe", "Borrar · contactos"],
    ]);

    expect(await deleteProspects(db, tenant, ruiz.baseId, [ruiz.id])).toEqual({ deleted: 1, linked: 2 });
    expect((await listProspects(db, tenant, people.id)).rows.map((r) => r.personName)).toEqual(["Luis"]);
  });

  it("the companies' table deletes their people and the relation column", async () => {
    const { companies, people, column, sur } = await companiesAndPeople("Tabla");
    await saveProspects(db, tenant, {
      baseId: people.id,
      items: [{ personName: "Luis", parentId: sur.id }, { personName: "Sola" }],
    });
    expect(await linkedRowsOf(db, tenant, companies.id)).toEqual([
      { baseId: people.id, name: "Tabla · contactos", n: 1 },
    ]);
    await deleteBase(db, tenant, companies.id);
    const after = await getBase(db, tenant, people.id);
    expect(after?.columns.some((c) => c.id === column.id)).toBe(false);
    expect((await listProspects(db, tenant, people.id)).rows.map((r) => r.personName)).toEqual(["Sola"]);
  });
});

describe("tables shared between projects", () => {
  const [swipoo, gestorias, flotas] = [0, 1, 2];

  it("are one project's, some projects' or every project's", async () => {
    const base = await createBase(db, tenant, projectIds[swipoo], {
      name: "Compartida",
      rowKind: "company",
      columns: [],
    });
    const uses = async (p: number) =>
      (await listBases(db, tenant, projectIds[p], { shared: true })).some((b) => b.id === base.id);
    const inSidebar = async (p: number) =>
      ((await tablesByProject(db, tenant, projectIds)).get(projectIds[p]) ?? []).some(
        (t) => t.id === base.id,
      );

    expect([await uses(swipoo), await uses(gestorias), await uses(flotas)]).toEqual([true, false, false]);

    await setBaseProjects(db, tenant, base.id, [projectIds[swipoo], projectIds[gestorias]]);
    expect([await uses(swipoo), await uses(gestorias), await uses(flotas)]).toEqual([true, true, false]);
    expect([await inSidebar(swipoo), await inSidebar(gestorias), await inSidebar(flotas)]).toEqual([
      true,
      true,
      false,
    ]);
    const shared = (await getBase(db, tenant, base.id))!;
    expect(shared.projectId).toBeNull();
    expect(shared.projectIds.sort()).toEqual([projectIds[swipoo], projectIds[gestorias]].sort());
    const listed = (await listAllBases(db, tenant)).find((b) => b.id === base.id)!;
    expect(listed.projectName?.split(", ").sort()).toEqual(["Gestorías", "Swipoo"]);
    // Gestorías uses it too: its tab lists it.
    expect(
      (await listAllBases(db, tenant, { projectId: projectIds[gestorias] })).some((b) => b.id === base.id),
    ).toBe(true);

    // Someone who only sees Flotas doesn't see it; someone who sees Gestorías does.
    expect(canSeeBase([projectIds[flotas]], shared)).toBe(false);
    expect(canSeeBase([projectIds[gestorias]], shared)).toBe(true);

    await setBaseProjects(db, tenant, base.id, null);
    expect([await uses(swipoo), await uses(gestorias), await uses(flotas)]).toEqual([true, true, true]);
    expect(canSeeBase([projectIds[flotas]], (await getBase(db, tenant, base.id))!)).toBe(true);

    await setBaseProjects(db, tenant, base.id, [projectIds[gestorias]]);
    expect((await getBase(db, tenant, base.id))?.projectId).toBe(projectIds[gestorias]);
    expect(await uses(swipoo)).toBe(false);
    await expect(setBaseProjects(db, tenant, base.id, [])).rejects.toThrow(/al menos un proyecto/);
  });

  it("let agents of those projects fill them, and stop the others", async () => {
    const base = await createBase(db, tenant, null, {
      name: "De la cuenta",
      rowKind: "company",
      columns: [],
    });
    const agent = await addAgent(db, tenant, projectIds[flotas], "prospecting", "b2b_consultative");
    await setAgentBase(db, tenant, projectIds[flotas], agent.id, base.id);
    await setBaseProjects(db, tenant, base.id, [projectIds[swipoo], projectIds[gestorias]]);
    const [config] = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentConfigs).where(eq(agentConfigs.id, agent.id)),
    );
    expect(config.prospectBaseId).toBeNull();
    await expect(setAgentBase(db, tenant, projectIds[flotas], agent.id, base.id)).rejects.toThrow(
      /no usa esa tabla/,
    );
  });
});

describe("an agent filling a related table", () => {
  let tables: Awaited<ReturnType<typeof companiesAndPeople>>;
  let agentId: string;

  beforeAll(async () => {
    tables = await companiesAndPeople("Agente");
    const agent = await addAgent(db, tenant, projectIds[0], "prospecting", "b2b_consultative");
    agentId = agent.id;
    await setAgentBase(db, tenant, projectIds[0], agentId, tables.people.id);
    await saveAgentInstructions(db, tenant, projectIds[0], agentId, {
      instructions: "Gerentes de concesionarios.",
      settings: { mode: "find", linked: { stages: ["Interesado"] } },
    });
    await setAgentEnabled(db, tenant, projectIds[0], agentId, true);
  });

  const peopleBase = (): ProspectBase => tables.people;

  it("goes through the companies not looked into yet, in the chosen phases", async () => {
    const next = await linkedRowsToSearch(db, tenant, peopleBase(), { stages: ["Interesado"] });
    expect(next?.table.name).toBe("Agente · empresas");
    expect(next?.rows.map((r) => r.name)).toEqual(["Autos Ruiz", "Coches Norte"]);
    expect(next?.rows[0].known).toContain("Ciudad: Málaga");
    const all = await linkedRowsToSearch(db, tenant, peopleBase());
    expect(all?.left).toBe(3);
  });

  it("saves people linked to the company they were found in, and moves on", async () => {
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "save_prospects",
            input: {
              prospects: [
                { linkedRef: "E1", personName: "Ana Ruiz", companyName: "", fields: { cargo: "Gerente" } },
                { personName: "Sin empresa", companyName: "X" },
              ],
            },
          },
        ],
      },
      { blocks: [{ type: "tool_use", name: "mark_linked_searched", input: { refs: ["E2"] } }] },
      { blocks: [{ type: "text", text: "Hecho." }] },
    ]);
    const result = await runProspecting({ db, llm, gateway: { db, executor: undefined as never } }, tenant, {
      agentId,
      trigger: "manual",
    });
    expect(result).toMatchObject({ status: "completed", added: 1 });
    const system = JSON.stringify(requests[0].system);
    expect(system).toContain("## Empresas en las que buscar");
    expect(system).toContain("E1 · Autos Ruiz · autosruiz.es");
    expect(system).toContain("E2 · Coches Norte");
    expect(system).not.toContain("Motor Sur");
    const saveTool = requests[0].tools?.find((t) => "name" in t && t.name === "save_prospects") as
      { input_schema: { properties: { prospects: { items: { required: string[] } } } } } | undefined;
    expect(saveTool?.input_schema.properties.prospects.items.required).toContain("linkedRef");
    expect(lastToolResults(requests[1])[0]).toMatchObject({
      saved: ["Ana Ruiz"],
      notSavedWithoutLinkedRef: ["Sin empresa"],
    });

    const [ana] = await withTenant(db, tenant, (tx) =>
      tx.select().from(prospects).where(eq(prospects.baseId, tables.people.id)),
    );
    expect([ana.personName, ana.companyName, ana.parentId]).toEqual([
      "Ana Ruiz",
      "Autos Ruiz",
      tables.ruiz.id,
    ]);

    // Both companies in the chosen phase are done: the next run has nothing left there.
    expect((await linkedRowsToSearch(db, tenant, peopleBase(), { stages: ["Interesado"] }))?.rows).toEqual(
      [],
    );
    const idle = await runProspecting(
      { db, llm: scriptedLlm([]).llm, gateway: { db, executor: undefined as never } },
      tenant,
      { agentId, trigger: "manual" },
    );
    expect(idle).toMatchObject({ status: "skipped", added: 0 });
    expect(idle.summary).toContain("Ya ha buscado en todas las filas de «Agente · empresas»");
  });

  it("records what it found in each company, and companies with people aren't searched again", async () => {
    await recordLinkedSearches(db, tenant, {
      baseId: tables.people.id,
      rows: [{ id: tables.sur.id, found: 0 }],
    });
    expect((await linkedRowsToSearch(db, tenant, peopleBase()))?.left).toBe(0);
  });
});
