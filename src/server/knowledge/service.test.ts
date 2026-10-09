import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { agentConfigs, connections, identities, projectIdentities, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction } from "../gateway/gateway";
import {
  getSourceDetail,
  getSourceFile,
  ingestDocumentText,
  ingestTableFile,
  isEditableText,
  queryTable,
  reprocessTableSource,
  searchKnowledge,
  setSourceProject,
  updateSourceText,
} from "./service";
import { listKnowledge } from "../services/projects";

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
    expect(result.source.name).toBe("Tarifas 2026");
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
      text: "Si el cliente dice que ya tiene gestoría, recuerda que la reunión inicial es gratuita.\n\nSobre el precio: comparamos el coste total, no la tarifa.",
    });
    await ingestDocumentText(db, tenant, {
      projectId: otherProjectId,
      name: "Otro proyecto",
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

  it("also finds table rows, with their column names", async () => {
    const hits = await searchKnowledge(db, tenant, { projectId, query: "alta urgente precio" });
    expect(hits[0].sourceName).toBe("Tarifas 2026");
    expect(hits[0].content).toContain("Servicio: Alta urgente · Segmento: b2b · Precio: 89,5");
  });

  it("stays within the project", async () => {
    const hits = await searchKnowledge(db, tenant, { projectId: otherProjectId, query: "gratuita" });
    expect(hits).toEqual([]);
  });
});

describe("knowledge of the whole account", () => {
  it("is used by every project, next to each project's own, and can move to one project", async () => {
    const { source } = await ingestDocumentText(db, tenant, {
      projectId: null,
      name: "Presentación de la empresa",
      text: "Somos una consultora fundada en 2009 con oficinas en Valencia y Bilbao.",
    });
    for (const id of [projectId, otherProjectId]) {
      const hits = await searchKnowledge(db, tenant, { projectId: id, query: "oficinas bilbao" });
      expect(hits.map((h) => h.sourceName)).toEqual(["Presentación de la empresa"]);
    }
    expect((await listKnowledge(db, tenant, null)).map((s) => s.name)).toEqual([
      "Presentación de la empresa",
    ]);
    expect((await listKnowledge(db, tenant, projectId)).map((s) => s.name)).not.toContain(
      "Presentación de la empresa",
    );

    await setSourceProject(db, tenant, source.id, projectId);
    expect(
      await searchKnowledge(db, tenant, { projectId: otherProjectId, query: "oficinas bilbao" }),
    ).toEqual([]);
    expect(await searchKnowledge(db, tenant, { projectId, query: "oficinas bilbao" })).toHaveLength(1);
    await setSourceProject(db, tenant, source.id, null);
  });
});

describe("knowledge backs figures in outbound messages", () => {
  it("lets a cited table support a price in an email", async () => {
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

describe("original files and source detail", () => {
  it("keeps the uploaded file and the full text", async () => {
    const { source } = await ingestDocumentText(db, tenant, {
      projectId,
      name: "Guion",
      text: "Primer párrafo.\n\nSegundo párrafo.",
      file: { filename: "guion.md", data: Buffer.from("# Guion") },
    });
    const file = await getSourceFile(db, tenant, source.id);
    expect(file).toMatchObject({ filename: "guion.md", mimeType: "text/markdown", size: 7 });
    expect(file!.data.toString("utf8")).toBe("# Guion");
    const detail = await getSourceDetail(db, tenant, source.id);
    expect(detail?.text).toBe("Primer párrafo.\n\nSegundo párrafo.");
    expect(detail?.file?.filename).toBe("guion.md");
  });

  it("edits text knowledge: agents read the new text, and a text file's original goes", async () => {
    const { source } = await ingestDocumentText(db, tenant, {
      projectId,
      name: "Objeciones",
      text: "Si dicen que es caro, habla del ahorro.",
      file: { filename: "objeciones.txt", data: Buffer.from("x") },
    });
    await updateSourceText(db, tenant, source.id, {
      name: "Respuestas a objeciones",
      text: "Si dicen que es caro, recuerda la garantía de devolución.",
    });
    const detail = await getSourceDetail(db, tenant, source.id);
    expect(detail?.source.name).toBe("Respuestas a objeciones");
    expect(detail?.text).toBe("Si dicen que es caro, recuerda la garantía de devolución.");
    expect(detail?.file).toBeNull();
    const hits = await searchKnowledge(db, tenant, { projectId, query: "garantía devolución" });
    expect(hits.some((h) => h.sourceId === source.id)).toBe(true);
    expect(
      (await searchKnowledge(db, tenant, { projectId, query: "ahorro" })).some(
        (h) => h.sourceId === source.id,
      ),
    ).toBe(false);
  });

  it("doesn't edit tables or PDFs as text", async () => {
    const pdf = await ingestDocumentText(db, tenant, {
      projectId,
      name: "Catálogo",
      text: "Texto del catálogo.",
      file: { filename: "catalogo.pdf", data: Buffer.from("%PDF") },
    });
    expect(isEditableText(pdf.source, { mimeType: "application/pdf" })).toBe(false);
    await expect(
      updateSourceText(db, tenant, pdf.source.id, { name: "Catálogo", text: "Otro" }),
    ).rejects.toThrow(/no se puede editar/);
    await expect(updateSourceText(db, tenant, pdf.source.id, { name: " ", text: "x" })).rejects.toThrow(
      /nombre/,
    );
  });
});

describe("reprocessTableSource", () => {
  it("rebuilds a sheet imported with a merged title as its header", async () => {
    // How the old parser stored a sheet whose first row was a merged title.
    const csv = [
      "Precios base,Precios base,Precios base",
      "Precios sin compromiso.,Precios sin compromiso.,Precios sin compromiso.",
      "Trámite,Honorarios,Total con IVA",
      "↪ Transferencia,30,98.5945",
      "↪ Matriculación,40,154.7645",
      "› Los precios no incluyen IVA,,",
    ].join("\n");
    const { source } = await ingestTableFile(db, tenant, {
      projectId: otherProjectId,
      name: "Precios",
      filename: "precios.csv",
      data: Buffer.from(csv),
    });
    const tables = await reprocessTableSource(db, tenant, source.id);
    expect(tables.map((t) => t.name)).toEqual(["Precios base"]);
    const result = await queryTable(db, tenant, { tableId: tables[0].id });
    expect(result.rows.map((r) => r.data)).toEqual([
      { tramite: "Transferencia", honorarios: 30, total_con_iva: 98.5945 },
      { tramite: "Matriculación", honorarios: 40, total_con_iva: 154.7645 },
    ]);
    const detail = await getSourceDetail(db, tenant, source.id);
    expect(detail?.tables[0].description).toBe("Precios sin compromiso.");
    expect(detail?.source.exposedObjects.notes).toEqual(["Los precios no incluyen IVA"]);
  });
});
