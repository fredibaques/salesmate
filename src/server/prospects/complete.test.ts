import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import { runProspecting } from "../agents/prospector";
import type { Db } from "../db/client";
import { agentEvents, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent, saveAgentInstructions } from "../services/agents";
import { createBase, setAgentBase } from "./bases";
import { completeProspects, countPendingCells, rowsToComplete } from "./complete";
import { getProspect, saveProspects, setProspectStatus, updateProspectRow } from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;
let baseId: string;
let agentId: string;
const ids: Record<string, string> = {};
const agentActor = (): TenantContext => ({ ...tenant, actorType: "agent", actorId: "run" });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Completar");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx.insert(projects).values({ orgId: tenant.orgId, name: "Swipoo" }).returning(),
  );
  projectId = p.id;
  const base = await createBase(db, tenant, projectId, {
    name: "Concesionarios",
    rowKind: "company",
    columns: [
      { name: "Ciudad", type: "text" },
      { name: "Stock", type: "number" },
      { name: "Email", type: "email", filledBy: "both" },
      { name: "Notas", type: "long", filledBy: "person" },
    ],
  });
  baseId = base.id;
  const { added } = await saveProspects(db, agentActor(), {
    baseId,
    items: [
      { companyName: "Autos García", website: "autosgarcia.es", fitScore: 90, fields: { ciudad: "Málaga" } },
      { companyName: "Motor Sur", fitScore: 60, fields: { ciudad: "Sevilla", stock: 40 } },
      { companyName: "Coches Norte", fitScore: 75, fields: { stock: 10 } },
      { companyName: "Descartada", fitScore: 99 },
    ],
  });
  for (const row of added) ids[row.companyName] = row.id;
  await setProspectStatus(db, tenant, baseId, [ids["Descartada"]], "discarded");
});
afterAll(async () => close());

describe("cells to complete", () => {
  it("counts the empty cells the agent fills, in rows still in play", async () => {
    // García: stock, email · Motor Sur: email · Coches Norte: ciudad, email. Notas is for people.
    expect(await countPendingCells(db, tenant, baseId)).toBe(5);
  });

  it("picks rows best fit first, up to the cells of a run", async () => {
    const { rows, cells } = await rowsToComplete(db, tenant, baseId, { limit: 3 });
    expect(rows.map((r) => [r.companyName, r.columns])).toEqual([
      ["Autos García", ["stock", "email"]],
      ["Coches Norte", ["ciudad", "email"]],
    ]);
    expect(cells).toBe(4);
  });
});

describe("completeProspects", () => {
  it("fills empty cells with their source, keeps values and locked cells, and marks what isn't published", async () => {
    // A person writes García's email: locked for the agent.
    await updateProspectRow(db, tenant, baseId, ids["Autos García"], {
      companyName: "Autos García",
      website: "autosgarcia.es",
      fitScore: 90,
      fields: { email: "ventas@autosgarcia.es" },
    });
    const result = await completeProspects(db, agentActor(), {
      baseId,
      items: [
        {
          id: ids["Autos García"],
          fields: { stock: "1.250", email: "otro@autosgarcia.es", ciudad: "Marbella" },
          sources: { stock: "https://autosgarcia.es/stock" },
        },
        { id: ids["Coches Norte"], fields: { email: "no-es-email" }, notFound: ["ciudad"] },
        { id: "00000000-0000-0000-0000-000000000000", fields: { stock: 1 } },
      ],
    });
    expect(result).toMatchObject({
      filled: 1,
      notFound: 1,
      kept: ["Autos García · Email", "Autos García · Ciudad"],
      fieldErrors: [expect.stringContaining("Email: no es un email")],
      unknownRows: ["00000000-0000-0000-0000-000000000000"],
    });
    const garcia = (await getProspect(db, tenant, baseId, ids["Autos García"]))!;
    expect(garcia.data).toMatchObject({ ciudad: "Málaga", stock: 1250, email: "ventas@autosgarcia.es" });
    expect(garcia.cellMeta.stock).toMatchObject({ by: "agent", source: "https://autosgarcia.es/stock" });
    expect(garcia.cellMeta.email).toMatchObject({ by: "user" });
    const norte = (await getProspect(db, tenant, baseId, ids["Coches Norte"]))!;
    expect(norte.cellMeta.ciudad).toMatchObject({ by: "agent", notFound: true });
    // Not found isn't pending any more; asking for that row looks again.
    expect(await countPendingCells(db, tenant, baseId)).toBe(2);
    const retry = await rowsToComplete(db, tenant, baseId, { limit: 10, rowIds: [ids["Coches Norte"]] });
    expect(retry.rows[0].columns).toEqual(["ciudad", "email"]);
  });

  it("keeps the source of each value an agent saves in a new row", async () => {
    const { added } = await saveProspects(db, agentActor(), {
      baseId,
      items: [
        {
          companyName: "Talleres Pérez",
          fields: { ciudad: "Jaén" },
          fieldSources: { Ciudad: "https://talleresperez.es/contacto", stock: "no es url" },
        },
      ],
    });
    expect(added[0].cellMeta.ciudad).toMatchObject({ source: "https://talleresperez.es/contacto" });
  });
});

describe("a run that completes the base", () => {
  it("fills the pending cells by reference and doesn't look for new rows", async () => {
    const agent = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
    agentId = agent.id;
    await setAgentBase(db, tenant, projectId, agent.id, baseId);
    await saveAgentInstructions(db, tenant, projectId, agentId, {
      instructions: "",
      schedule: { time: "08:00", days: [1] },
      settings: { mode: "complete", cellsPerRun: 10 },
    });
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "update_prospects",
            input: {
              rows: [
                {
                  // Coches Norte (fit 75) is F1; Motor Sur (fit 60) comes next.
                  ref: "F2",
                  fields: { email: "info@motorsur.es" },
                  fieldSources: { email: "https://motorsur.es" },
                },
                { ref: "F9", fields: { stock: 3 } },
              ],
            },
          },
        ],
      },
      (req) => {
        expect(lastToolResults(req)[0]).toMatchObject({ filled: 1, unknownRefs: ["F9"] });
        return { blocks: [{ type: "text", text: "He completado 1 celda." }] };
      },
    ]);
    const gateway = { db, executor: { execute: async () => ({}) } };
    // A short run: with little time left it isn't asked to go on.
    const result = await runProspecting({ db, llm, gateway, timeBudgetMs: 50_000 }, tenant, {
      agentId,
      trigger: "manual",
    });
    expect(result).toMatchObject({ status: "completed", added: 0, completed: 1 });
    const tools = requests[0].tools?.map((t) => ("name" in t ? t.name : t.type));
    expect(tools).toContain("update_prospects");
    expect(tools).not.toContain("save_prospects");
    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toContain("## Filas por completar");
    expect(system).toMatch(/F1 · Coches Norte[\s\S]*F2 · Motor Sur/);
    expect((await getProspect(db, tenant, baseId, ids["Motor Sur"]))!.data.email).toBe("info@motorsur.es");

    // «Completar vacíos» of the whole table: cells left after a run that made progress → next batch queued.
    const batch = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "update_prospects",
            input: { rows: [{ ref: "F1", fields: { email: "info@cochesnorte.es" } }] },
          },
        ],
      },
      { blocks: [{ type: "text", text: "Una más." }] },
    ]);
    const first = await runProspecting({ db, llm: batch.llm, gateway, timeBudgetMs: 50_000 }, tenant, {
      agentId,
      trigger: "manual",
      allPending: true,
    });
    expect(first.completed).toBe(1);
    expect(first.summary).toMatch(/Quedan \d+ celdas por completar/);
    const queued = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentEvents).where(eq(agentEvents.agentConfigId, agentId)),
    );
    expect(queued.map((e) => e.kind)).toEqual(["continue"]);

    // Nothing left to fill: the run ends without calling the model.
    const rest = await rowsToComplete(db, tenant, baseId, { limit: 50 });
    await completeProspects(db, agentActor(), {
      baseId,
      items: rest.rows.map((r) => ({ id: r.id, notFound: r.columns })),
    });
    const idle = await runProspecting({ db, llm: scriptedLlm([]).llm, gateway }, tenant, {
      agentId,
      trigger: "manual",
    });
    expect(idle).toMatchObject({ status: "completed", completed: 0 });
    expect(idle.summary).toContain("No hay celdas por completar");
  });
});
