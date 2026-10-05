import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { ingestDocumentText, ingestTableFile } from "../knowledge/service";
import { answerFromKnowledge, splitSources } from "./knowledge-answer";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let userId: string;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Ask");
  userId = seeded.userId;
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  projectId = await withTenant(db, tenant, async (tx) => {
    const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Gestoría" }).returning();
    return p.id;
  });
  await ingestDocumentText(db, tenant, {
    projectId,
    name: "Presentación",
    text: "Somos una gestoría especializada en automoción con más de 300 concesionarios.",
  });
  await ingestTableFile(db, tenant, {
    projectId,
    name: "Precios",
    filename: "precios.csv",
    data: Buffer.from("Trámite,Honorarios,Total con IVA\nTransferencia,30,98.59\nBaja,30,51.56\n"),
  });
});
afterAll(async () => close());

describe("answerFromKnowledge", () => {
  it("puts small tables in the prompt and returns the cited sources", async () => {
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "text",
            text: "Una transferencia cuesta **30 €** de honorarios; con tasas e IVA, 98,59 €.\n\nFuentes: S2",
          },
        ],
      },
    ]);
    const result = await answerFromKnowledge(
      { db, llm },
      { orgId: tenant.orgId, userId },
      { projectId, question: "¿Cuánto vale una transferencia?" },
    );
    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toContain("[S2] Tabla «Precios»");
    expect(system).toContain("- Trámite: Transferencia · Honorarios: 30 · Total con IVA: 98,59");
    expect(result.answer).toBe("Una transferencia cuesta **30 €** de honorarios; con tasas e IVA, 98,59 €.");
    expect(result.sources.map((s) => s.name)).toEqual(["Precios"]);
  });

  it("can search the documents", async () => {
    const { llm } = scriptedLlm([
      { blocks: [{ type: "tool_use", name: "search_knowledge", input: { query: "concesionarios" } }] },
      (req) => {
        const [hits] = lastToolResults(req) as { content: string }[][];
        expect(hits[0].content).toContain("300 concesionarios");
        return { blocks: [{ type: "text", text: "Trabajan con más de 300 concesionarios.\nFuentes: S1" }] };
      },
    ]);
    const result = await answerFromKnowledge(
      { db, llm },
      { orgId: tenant.orgId, userId },
      { projectId, question: "¿Con cuántos concesionarios trabajan?" },
    );
    expect(result.sources.map((s) => s.name)).toEqual(["Presentación"]);
  });
});

describe("splitSources", () => {
  it("separates the sources line in its usual shapes", () => {
    expect(splitSources("Hola.\n\n**Fuentes:** S1, S3")).toEqual({ answer: "Hola.", cited: ["S1", "S3"] });
    expect(splitSources("No lo sé.\nFuentes: ninguna")).toEqual({ answer: "No lo sé.", cited: [] });
    expect(splitSources("Sin línea de fuentes")).toEqual({ answer: "Sin línea de fuentes", cited: [] });
  });
});
