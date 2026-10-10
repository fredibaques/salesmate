import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { mcpTools, type AgentToolContext } from "../agents/tools";
import type { Db } from "../db/client";
import { actions, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { decideAction } from "../gateway/gateway";
import { addAgent, saveAgentTools, listMcpServers } from "../services/agents";
import { ConnectorExecutor } from "./executor";
import { createMcpConnection, type McpDeps } from "./mcp";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;
const created: string[] = [];

/** A tiny directory server: one read-only search and one tool that writes. */
function server() {
  const s = new McpServer({ name: "directorio", version: "1.0.0" });
  s.registerTool(
    "buscar_empresas",
    {
      description: "Busca empresas por sector y ciudad",
      inputSchema: { sector: z.string(), ciudad: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ sector, ciudad }) => ({
      content: [{ type: "text", text: `Autos García (${sector}, ${ciudad})` }],
    }),
  );
  s.registerTool(
    "crear_lead",
    { description: "Crea un lead en el CRM", inputSchema: { empresa: z.string() } },
    async ({ empresa }) => {
      created.push(empresa);
      return { content: [{ type: "text", text: `Lead creado: ${empresa}` }] };
    },
  );
  return s;
}

const mcp: McpDeps = {
  transport: () => {
    const [client, srv] = InMemoryTransport.createLinkedPair();
    void server().connect(srv);
    return client;
  },
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Mcp");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  projectId = await withTenant(db, tenant, async (tx) => {
    const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "P" }).returning();
    return p.id;
  });
});
afterAll(async () => close());

describe("MCP servers", () => {
  it("lists a server's tools and lets an agent use them under the gateway", async () => {
    const conn = await createMcpConnection({ db, ...mcp }, tenant, {
      label: "Directorio",
      url: "https://mcp.example.com/mcp",
      token: "secreto",
    });
    const [listed] = await listMcpServers(db, tenant);
    expect(listed.tools.map((t) => [t.name, t.readOnly])).toEqual([
      ["buscar_empresas", true],
      ["crear_lead", false],
    ]);

    const agent = await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
    await saveAgentTools(db, tenant, projectId, agent.id, {
      web: true,
      mcp: [{ connectionId: conn.id, tools: ["buscar_empresas", "crear_lead", "no_existe"] }],
    });

    const ctx: AgentToolContext = {
      db,
      orgId: tenant.orgId,
      projectId,
      agentType: "outbound",
      runId: "00000000-0000-0000-0000-000000000001",
      gateway: { db, executor: new ConnectorExecutor({ db, mcp }) },
      mcp,
      timezone: "Europe/Madrid",
    };
    const tools = await mcpTools(ctx, [{ connectionId: conn.id, tools: ["buscar_empresas", "crear_lead"] }]);
    expect(tools.map((t) => t.name)).toEqual(["Directorio__buscar_empresas", "Directorio__crear_lead"]);
    expect(tools[0].jsonSchema).toMatchObject({ type: "object", required: ["sector", "ciudad"] });

    // Read-only: answers straight away.
    expect(await tools[0].run({ sector: "concesionarios", ciudad: "Málaga" })).toBe(
      "Autos García (concesionarios, Málaga)",
    );

    // Writes: proposed to the gateway; with the default autonomy it waits for approval.
    const proposed = (await tools[1].run({ empresa: "Autos García" })) as {
      actionId: string;
      outcome: string;
    };
    expect(proposed.outcome).toBe("pending_approval");
    expect(created).toEqual([]);

    await decideAction(
      { db, executor: new ConnectorExecutor({ db, mcp }) },
      { ...tenant, actorType: "user", actorId: tenant.actorId! },
      {
        actionId: proposed.actionId,
        decision: "approved",
      },
    );
    expect(created).toEqual(["Autos García"]);
    const [row] = await withTenant(db, tenant, (tx) =>
      tx.select().from(actions).where(eq(actions.id, proposed.actionId)),
    );
    expect(row).toMatchObject({ status: "succeeded", result: { result: "Lead creado: Autos García" } });
  });
});
