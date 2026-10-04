import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { agentConfigs, connections, identities, projectIdentities, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction } from "../gateway/gateway";
import { ingestDocumentText, ingestTableFile, queryTable, searchKnowledge } from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;
let otherProjectId: string;
let tableId: string;

const CSV = [
  "Servicio,Segmento,Precio,Plazo (días)",
  "Alta básica,b2b,49,3",
  'Alta urgente,b2b,"89,50",1',
  "Plan particulares,b2c,19,5",
  "Revisión anual,b2c,120,10",
].join("\n");

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const { orgId, userId } = await seedOrg(db, "Know");
  tenant = { orgId, actorType: "user", actorId: userId };
  [projectId, otherProjectId] = await withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .insert(projects)
      .values([
        { orgId, name: "Uno" },
        { orgId, name: "Dos" },
      ])
      .returning();
    return rows.map((r) => r.id);
  });
  const { tables } = await ingestTableFile(db, tenant, {
    projectId,
    name: "Tarifas 2026",
    reliability: "truth",
    filename: "tarifas.csv",
    data: Buffer.from(CSV),
  });
  tableId = tables[0].id;
});

afterAll(async () => close());

describe("queryTable", () => {
  it("filters numerically and orders", async () => {
    const result = await queryTable(db, tenant, {
      tableId,
      filters: [{ column: "precio", op: "lte", value: 90 }],
      orderBy: { column: "precio", direction: "desc" },
    });
    expect(result.rows.map((r) => r.data.servicio)).toEqual([
      "Alta urgente",
      "Alta básica",
      "Plan particulares",
    ]);
    expect(result.source.reliability).toBe("truth");
  });

  it("matches text case-insensitively and supports contains/in", async () => {
    const eq = await queryTable(db, tenant, {
      tableId,
      filters: [{ column: "segmento", op: "eq", value: "B2C" }],
    });
    expect(eq.rows).toHaveLength(2);
    const contains = await queryTable(db, tenant, {
      tableId,
      filters: [{ column: "servicio", op: "contains", value: "alta" }],
    });
    expect(contains.rows).toHaveLength(2);
    const inList = await queryTable(db, tenant, {
      tableId,
      filters: [{ column: "servicio", op: "in", value: ["revisión anual", "Alta básica"] }],
    });
    expect(inList.rows).toHaveLength(2);
  });

  it("rejects unknown columns with the available ones", async () => {
    await expect(
      queryTable(db, tenant, { tableId, filters: [{ column: "coste", op: "eq", value: 1 }] }),
    ).rejects.toThrow(/plazo_dias/);
  });

  it("is invisible to other organizations", async () => {
    const other = await seedOrg(db, "Otra");
    await expect(queryTable(db, { orgId: other.orgId }, { tableId })).rejects.toThrow(/no encontrada/);
  });
});

describe("searchKnowledge", () => {
  beforeAll(async () => {
    await ingestDocumentText(db, tenant, {
      projectId,
      name: "Objeciones",
      reliability: "reference",
      text: "Si el cliente dice que ya tiene gestoría, recuerda que la reunión inicial es gratuita.\n\nSobre el precio: comparamos el coste total, no la tarifa.",
    });
    await ingestDocumentText(db, tenant, {
      projectId: otherProjectId,
      name: "Otro proyecto",
      reliability: "reference",
      text: "La reunión de este otro proyecto no debe aparecer.",
    });
  });

  it("finds chunks ignoring accents and cites the source", async () => {
    const hits = await searchKnowledge(db, tenant, { projectId, query: "reunion gratuita" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceName: "Objeciones", documentTitle: "Objeciones", position: 0 });
  });

  it("falls back to any-word matching", async () => {
    const hits = await searchKnowledge(db, tenant, { projectId, query: "tarifa descuento" });
    expect(hits.map((h) => h.sourceName)).toEqual(["Objeciones"]);
  });

  it("stays within the project", async () => {
    const hits = await searchKnowledge(db, tenant, { projectId: otherProjectId, query: "gratuita" });
    expect(hits).toEqual([]);
  });
});

describe("knowledge backs figures in outbound messages", () => {
  it("lets a cited truth table support a price in an email", async () => {
    const identityId = await withTenant(db, tenant, async (tx) => {
      const [conn] = await tx
        .insert(connections)
        .values({ orgId: tenant.orgId, provider: "google", label: "Mail", accountRef: "ventas@uno.com" })
        .returning();
      const [identity] = await tx
        .insert(identities)
        .values({
          orgId: tenant.orgId,
          kind: "email",
          provider: "google",
          address: "ventas@uno.com",
          connectionId: conn.id,
        })
        .returning();
      await tx.insert(projectIdentities).values({ orgId: tenant.orgId, projectId, identityId: identity.id });
      await tx
        .insert(agentConfigs)
        .values({ orgId: tenant.orgId, projectId, agentType: "inbound", autonomy: { default: 3 } });
      return identity.id;
    });
    const { rows, table } = await queryTable(db, tenant, {
      tableId,
      filters: [{ column: "servicio", op: "eq", value: "Alta básica" }],
    });
    const deps = {
      db,
      executor: { execute: async () => ({ ok: true }) },
      now: () => new Date("2026-10-07T09:00:00Z"),
    };
    const agent = { ...tenant, actorType: "agent" as const, actorId: "run" };
    const email = (to: string) => ({
      identityId,
      to: [to],
      subject: "Precio",
      body: `La alta básica cuesta ${rows[0].data.precio} € (IVA no incluido).`,
    });

    const uncited = await proposeAction(deps, agent, {
      projectId,
      type: "email.send",
      agentType: "inbound",
      payload: email("a@cliente.com"),
    });
    expect(uncited.outcome).toBe("pending_approval");

    const cited = await proposeAction(deps, agent, {
      projectId,
      type: "email.send",
      agentType: "inbound",
      payload: email("b@cliente.com"),
      citations: [{ sourceId: table.sourceId, ref: rows[0].id }],
    });
    expect(cited.outcome).toBe("executed");
  });
});
