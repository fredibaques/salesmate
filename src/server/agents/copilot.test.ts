import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { connections, projectConnections, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { ingestDocumentText } from "../knowledge/service";
import { askCopilot } from "./copilot";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Cop");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  projectId = await withTenant(db, tenant, async (tx) => {
    const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Proyecto" }).returning();
    const [crm] = await tx
      .insert(connections)
      .values({ orgId: tenant.orgId, provider: "twenty", label: "CRM", accountRef: "https://crm.test" })
      .returning();
    await tx
      .insert(projectConnections)
      .values({
        orgId: tenant.orgId,
        projectId: p.id,
        connectionId: crm.id,
        capabilities: ["crm.create_task"],
      });
    return p.id;
  });
  await ingestDocumentText(db, tenant, {
    projectId,
    name: "Objeciones",
    text: "Si dicen que es caro: compara con el coste de hacerlo internamente.",
  });
});
afterAll(async () => close());

describe("copilot", () => {
  it("answers from knowledge and turns requests into pending actions", async () => {
    const { llm } = scriptedLlm([
      { blocks: [{ type: "tool_use", name: "search_knowledge", input: { query: "caro" } }] },
      (req) => {
        const [hits] = lastToolResults(req) as { content: string }[][];
        expect(hits[0].content).toContain("coste de hacerlo internamente");
        return {
          blocks: [
            {
              type: "tool_use",
              name: "propose_action",
              input: {
                type: "crm.create_task",
                payload: { title: "Llamar a Ana" },
                reason: "Lo ha pedido el usuario",
              },
            },
          ],
        };
      },
      {
        blocks: [
          {
            type: "text",
            text: "Compáralo con el coste interno (Objeciones). He dejado la tarea en tu bandeja.",
          },
        ],
      },
    ]);
    const executed: string[] = [];
    const answer = await askCopilot(
      {
        db,
        llm,
        gateway: { db, executor: { execute: async ({ action }) => (executed.push(action.id), {}) } },
      },
      { orgId: tenant.orgId, userId: tenant.actorId! },
      {
        projectId,
        history: [],
        question: "¿Qué respondo si me dicen que es caro? Y crea una tarea para llamar a Ana.",
      },
    );
    expect(answer.status).toBe("completed");
    expect(answer.answer).toContain("coste interno");
    expect(answer.proposedActions).toEqual([{ actionId: expect.any(String), outcome: "pending_approval" }]);
    expect(executed).toEqual([]);
  });
});
