import { createProject } from "./projects";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { saveGoogleConnection } from "../connectors/service";
import type { Db } from "../db/client";
import { connections, identities, projectConnections, projectIdentities, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { activePlaybookFor } from "../playbooks/service";
import { renderPlaybook } from "../playbooks/spec";
import {
  addAgent,
  addAgentTool,
  getAgent,
  getSalesProfile,
  listProjectAgents,
  removeAgent,
  removeAgentTool,
  saveAgentChannels,
  saveAgentProcess,
  saveSalesProfile,
  setAgentEnabled,
  setAgentMcpTools,
} from "./agents";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;
let mailboxId: string;
let calendarId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Agents");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [project] = await withTenant(db, tenant, (tx) =>
    tx.insert(projects).values({ orgId: tenant.orgId, name: "Concesionarios" }).returning(),
  );
  projectId = project.id;
  await saveGoogleConnection({ db }, tenant, {
    email: "ventas@empresa.com",
    name: "Ventas",
    ownerUserId: seeded.userId,
    credentials: {
      refreshToken: "r",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events",
      ].join(" "),
    },
  });
  const ids = await withTenant(db, tenant, (tx) => tx.select().from(identities));
  mailboxId = ids.find((i) => i.kind === "email")!.id;
  calendarId = ids.find((i) => i.kind === "calendar")!.id;
});

afterAll(async () => close());

describe("agents", () => {
  it("are added to a project with their own process from the template", async () => {
    expect(await listProjectAgents(db, tenant, projectId)).toEqual([]);
    await addAgent(db, tenant, projectId, "inbound", "b2b_consultative");

    const [agent] = await listProjectAgents(db, tenant, projectId);
    expect(agent.config.agentType).toBe("inbound");
    expect(agent.config.enabled).toBe(false);
    expect(agent.spec?.nextSteps[0]).toBe("meeting");

    // The added agent's process is what the runtime follows.
    const active = await withTenant(db, tenant, (tx) => activePlaybookFor(tx, projectId, "inbound"));
    expect(active?.id).toBe(agent.playbook?.id);
  });

  it("gives the prospecting agent its template defaults even when its row already exists", async () => {
    // createProject inserts every agent row up front, disabled and not added.
    const project = await createProject(db, tenant, { name: "Con filas previas" });
    await addAgent(db, tenant, project.id, "outbound", "b2b_consultative");
    const agent = await getAgent(db, tenant, project.id, "outbound");
    expect(agent?.config).toMatchObject({
      tools: { web: true },
      schedule: { time: "08:00", days: [1, 2, 3, 4, 5] },
      settings: { prospectsPerRun: 10 },
    });
    expect(agent?.config.instructions).toContain("fuentes públicas");
  });

  it("refuses agents that are not available yet", async () => {
    await expect(addAgent(db, tenant, projectId, "account_manager", "b2b_consultative")).rejects.toThrow(
      /todavía no está disponible/,
    );
  });

  it("saves the process without touching the project's sales profile", async () => {
    await saveSalesProfile(db, tenant, projectId, {
      offer: "Gestión de transferencias de vehículos",
      tone: "Cercano",
    });
    await saveAgentProcess(db, tenant, projectId, "inbound", {
      salesMotion: "b2b_transactional",
      process: { objective: "Dar de alta al concesionario", nextSteps: ["send_quote", "handoff"] },
      notes: "Sin reunión",
    });

    const agent = await getAgent(db, tenant, projectId, "inbound");
    expect(agent?.process?.salesMotion).toBe("b2b_transactional");
    expect(agent?.process?.currentVersion).toBe(2);
    expect(agent?.process?.spec.nextSteps).toEqual(["send_quote", "handoff"]);

    const profile = await getSalesProfile(db, tenant, projectId);
    const text = renderPlaybook({
      name: agent!.process!.name,
      motion: agent!.process!.salesMotion,
      spec: agent!.process!.spec,
      profile,
    });
    expect(text).toContain("Qué vendemos: Gestión de transferencias de vehículos");
    expect(text).toContain("Tono: Cercano");
    expect(text).toContain("send_quote: Enviar presupuesto");
  });

  it("turns the agent's channels into what the project may use", async () => {
    await saveAgentChannels(db, tenant, projectId, "inbound", {
      mailboxId,
      readMailbox: false,
      calendarId,
    });
    let links = await withTenant(db, tenant, (tx) =>
      tx.select().from(projectIdentities).where(eq(projectIdentities.projectId, projectId)),
    );
    expect(links.map((l) => l.identityId).sort()).toEqual([mailboxId, calendarId].sort());
    expect(links.every((l) => l.isDefault)).toBe(true);
    let [conn] = await withTenant(db, tenant, (tx) =>
      tx.select().from(projectConnections).where(eq(projectConnections.projectId, projectId)),
    );
    expect(conn.capabilities).toContain("email.send");
    expect(conn.capabilities).toContain("calendar.book");
    expect(conn.capabilities).not.toContain("email.list_messages");

    // Reading the mailbox adds the read capabilities.
    await saveAgentChannels(db, tenant, projectId, "inbound", { mailboxId, readMailbox: true });
    [conn] = await withTenant(db, tenant, (tx) =>
      tx.select().from(projectConnections).where(eq(projectConnections.projectId, projectId)),
    );
    expect(conn.capabilities).toContain("email.list_messages");

    // Removing the agent removes what only it used.
    await setAgentEnabled(db, tenant, projectId, "inbound", true);
    await removeAgent(db, tenant, projectId, "inbound");
    links = await withTenant(db, tenant, (tx) =>
      tx.select().from(projectIdentities).where(eq(projectIdentities.projectId, projectId)),
    );
    expect(links).toEqual([]);
    expect(await listProjectAgents(db, tenant, projectId)).toEqual([]);
    expect(await withTenant(db, tenant, (tx) => activePlaybookFor(tx, projectId, "inbound"))).toBeNull();
  });

  it("keeps the process when an agent is added again", async () => {
    await addAgent(db, tenant, projectId, "inbound", "b2c_assisted");
    const agent = await getAgent(db, tenant, projectId, "inbound");
    expect(agent?.config.enabled).toBe(false);
    expect(agent?.process?.currentVersion).toBe(2);
  });
});

describe("agent tools", () => {
  it("adds and removes tools one by one, with the functions of an MCP server", async () => {
    await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
    const [mcp, hunter] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(connections)
        .values([
          {
            orgId: tenant.orgId,
            provider: "mcp",
            transport: "mcp",
            label: "Directorio",
            accountRef: "https://mcp.example.com/mcp",
            credentialsEncrypted: "x",
            metadata: {
              tools: [
                { name: "buscar", description: "", readOnly: true },
                { name: "crear", description: "", readOnly: false },
              ],
            },
          },
          {
            orgId: tenant.orgId,
            provider: "hunter",
            transport: "api",
            label: "Hunter",
            accountRef: "hunter",
            credentialsEncrypted: "x",
            readScopes: ["data"],
          },
        ])
        .returning(),
    );
    const tools = async () => (await getAgent(db, tenant, projectId, "outbound"))!.config.tools;

    await addAgentTool(db, tenant, projectId, "outbound", "web");
    await addAgentTool(db, tenant, projectId, "outbound", `data:${hunter.id}`);
    await addAgentTool(db, tenant, projectId, "outbound", `mcp:${mcp.id}`);
    expect(await tools()).toMatchObject({
      web: true,
      data: [hunter.id],
      mcp: [{ connectionId: mcp.id, tools: ["buscar", "crear"] }],
    });

    await setAgentMcpTools(db, tenant, projectId, "outbound", mcp.id, ["buscar", "inventada"]);
    expect((await tools()).mcp).toEqual([{ connectionId: mcp.id, tools: ["buscar"] }]);
    await expect(setAgentMcpTools(db, tenant, projectId, "outbound", mcp.id, [])).rejects.toThrow(
      "al menos una",
    );

    await removeAgentTool(db, tenant, projectId, "outbound", `mcp:${mcp.id}`);
    await removeAgentTool(db, tenant, projectId, "outbound", "web");
    expect(await tools()).toEqual({ web: false, mcp: [], data: [hunter.id] });
    await expect(
      addAgentTool(db, tenant, projectId, "outbound", "data:00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("no encontrada");
  });
});
