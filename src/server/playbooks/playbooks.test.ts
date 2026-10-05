import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { ingestDocumentText } from "../knowledge/service";
import { draftPlaybook } from "./draft";
import {
  activePlaybookFor,
  createPlaybook,
  getPlaybook,
  savePlaybookVersion,
  setPlaybookStatus,
} from "./service";
import { PLAYBOOK_TEMPLATES, renderPlaybook } from "./spec";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Pb");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  [{ id: projectId }] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(projects)
      .values({ orgId: tenant.orgId, name: "Consultoría", description: "Consultoría para pymes" })
      .returning(),
  );
});
afterAll(async () => close());

describe("playbooks", () => {
  it("versions changes and resolves the active playbook per agent", async () => {
    const pb = await createPlaybook(db, tenant, { projectId, name: "Web", salesMotion: "b2c_assisted" });
    expect(await withTenant(db, tenant, (tx) => activePlaybookFor(tx, projectId, "inbound"))).toBeNull();
    await setPlaybookStatus(db, tenant, pb.id, "active");
    await savePlaybookVersion(db, tenant, pb.id, {
      spec: { ...PLAYBOOK_TEMPLATES.b2c_assisted, objective: "Presupuesto en 5 minutos" },
      notes: "Objetivo más concreto",
    });
    const active = await withTenant(db, tenant, (tx) => activePlaybookFor(tx, projectId, "inbound"));
    expect(active).toMatchObject({
      currentVersion: 2,
      spec: { objective: "Presupuesto en 5 minutos", customerType: "b2c" },
    });
    expect(await withTenant(db, tenant, (tx) => activePlaybookFor(tx, projectId, "outbound"))).toBeNull();
    const full = await getPlaybook(db, tenant, pb.id);
    expect(full?.history.map((h) => h.version)).toEqual([2, 1]);
    await expect(
      savePlaybookVersion(db, tenant, pb.id, { spec: { customerType: "b2b", nextSteps: [] } }),
    ).rejects.toThrow();
  });

  it("renders a readable prompt section", () => {
    const text = renderPlaybook({
      name: "Web",
      motion: "b2b_consultative",
      spec: PLAYBOOK_TEMPLATES.b2b_consultative,
    });
    expect(text).toContain("Modelo de venta: B2B consultivo");
    expect(text).toContain("meeting: Agendar reunión o demo");
    expect(text).toContain("(imprescindible)");
  });

  it("drafts a playbook from the project's knowledge with structured output", async () => {
    await ingestDocumentText(db, tenant, {
      projectId,
      name: "Presentación",
      text: "Ayudamos a pymes a ordenar su proceso de venta. Objeción habitual: ya tenemos consultor.",
    });
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "text",
            text: JSON.stringify({
              objective: "Reunión de diagnóstico con el gerente",
              customerType: "b2b",
              nextSteps: ["meeting", "handoff"],
              segmentInclude: ["Pymes de 10 a 50 empleados"],
              segmentExclude: [],
              geography: ["España"],
              decisionMakers: ["Gerente"],
              pains: ["Ventas desordenadas"],
              valueProposition: "Ordenamos tu proceso de venta",
              qualification: [{ criterion: "Tiene equipo comercial", required: true }],
              disqualifiers: [],
              requiredData: [],
              objections: [{ objection: "Ya tenemos consultor", response: "Complementamos su trabajo" }],
              rules: ["No dar precios cerrados"],
              handoff: [],
              tone: "Cercano",
              gaps: ["Rango de precios"],
            }),
          },
        ],
      },
    ]);
    const { spec, gaps } = await draftPlaybook({ db, llm }, tenant, {
      projectId,
      salesMotion: "b2b_consultative",
    });
    expect(spec).toMatchObject({
      objective: "Reunión de diagnóstico con el gerente",
      nextSteps: ["meeting", "handoff"],
      responseTimeMinutes: 30,
    });
    expect(gaps).toEqual(["Rango de precios"]);
    expect(requests[0].output_config?.format?.type).toBe("json_schema");
    expect(JSON.stringify(requests[0].messages)).toContain("ya tenemos consultor");
  });
});
