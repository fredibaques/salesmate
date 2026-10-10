import { createProject } from "./projects";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { saveGoogleConnection } from "../connectors/service";
import type { Db } from "../db/client";
import { connections, identities, projectConnections, projectIdentities, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { getProjectProcess, projectProcess } from "../playbooks/service";
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
  saveProjectProcess,
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

let inboundId: string;

describe("agents", () => {
  it("give the project a sales process from the template when one that talks to people is added", async () => {
    expect(await listProjectAgents(db, tenant, projectId)).toEqual([]);
    expect(await withTenant(db, tenant, (tx) => projectProcess(tx, projectId))).toBeNull();
    inboundId = (await addAgent(db, tenant, projectId, "inbound", "b2b_consultative")).id;

    const [agent] = await listProjectAgents(db, tenant, projectId);
    expect(agent.config.agentType).toBe("inbound");
    expect(agent.config.enabled).toBe(false);
    expect(agent.working).toBe(false);

    // The process is the project's: what the runtime follows.
    const process = await withTenant(db, tenant, (tx) => projectProcess(tx, projectId));
    expect(process?.agentConfigId).toBeNull();
    expect(process?.spec.nextSteps[0]).toBe("meeting");
  });

  it("don't give the project a process when they only find data", async () => {
    const project = await createProject(db, tenant, { name: "Solo prospección" });
    await addAgent(db, tenant, project.id, "prospecting");
    expect(await getProjectProcess(db, tenant, project.id)).toBeNull();
    // Saving it the first time creates it.
    await saveProjectProcess(db, tenant, project.id, {
      salesMotion: "b2c_assisted",
      process: { objective: "Recoger los datos" },
    });
    const process = await getProjectProcess(db, tenant, project.id);
    expect(process?.salesMotion).toBe("b2c_assisted");
    expect(process?.spec.objective).toBe("Recoger los datos");
  });

  it("gives the prospecting agent its template defaults", async () => {
    const project = await createProject(db, tenant, { name: "Con plantilla" });
    const added = await addAgent(db, tenant, project.id, "prospecting", "b2b_consultative");
    const agent = await getAgent(db, tenant, project.id, added.id);
    expect(agent?.config).toMatchObject({
      tools: { web: true },
      schedule: { time: "08:00", days: [1, 2, 3, 4, 5] },
      settings: { prospectsPerRun: 10 },
    });
    expect(agent?.config.instructions).toContain("fuentes públicas");
  });

  it("lets a project have several agents of a kind, numbered until they are named", async () => {
    const project = await createProject(db, tenant, { name: "Varios" });
    const first = await addAgent(db, tenant, project.id, "outbound");
    const second = await addAgent(db, tenant, project.id, "outbound");
    const third = await addAgent(db, tenant, project.id, "outbound");
    expect(first.name).toBeNull();
    expect(second.name).toBe("Agente outbound 2");
    expect(third.name).toBe("Agente outbound 3");
    const agents = await listProjectAgents(db, tenant, project.id);
    expect(agents.map((a) => a.config.id)).toEqual([first.id, second.id, third.id]);
    // Each one is its own: pausing one leaves the others as they are.
    await setAgentEnabled(db, tenant, project.id, second.id, true);
    expect((await getAgent(db, tenant, project.id, first.id))?.config.enabled).toBe(false);
    expect((await getAgent(db, tenant, project.id, second.id))?.config.enabled).toBe(true);
    // Agents are found by their id, and only in their project.
    expect(await getAgent(db, tenant, projectId, second.id)).toBeNull();
    expect(await getAgent(db, tenant, project.id, "outbound")).toBeNull();
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
    await saveProjectProcess(db, tenant, projectId, {
      salesMotion: "b2b_transactional",
      process: { objective: "Dar de alta al concesionario", nextSteps: ["send_quote", "handoff"] },
      notes: "Sin reunión",
    });

    const process = await getProjectProcess(db, tenant, projectId);
    expect(process?.salesMotion).toBe("b2b_transactional");
    expect(process?.currentVersion).toBe(2);
    expect(process?.spec.nextSteps).toEqual(["send_quote", "handoff"]);
    expect(process?.history.map((h) => h.version)).toEqual([2, 1]);

    const profile = await getSalesProfile(db, tenant, projectId);
    const text = renderPlaybook({
      name: process!.name,
      motion: process!.salesMotion,
      spec: process!.spec,
      profile,
    });
    expect(text).toContain("Qué vendemos: Gestión de transferencias de vehículos");
    expect(text).toContain("Tono: Cercano");
    expect(text).toContain("send_quote: Enviar presupuesto");
  });

  it("turns the agent's channels into what the project may use", async () => {
    await saveAgentChannels(db, tenant, projectId, inboundId, {
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
    await saveAgentChannels(db, tenant, projectId, inboundId, { mailboxId, readMailbox: true });
    [conn] = await withTenant(db, tenant, (tx) =>
      tx.select().from(projectConnections).where(eq(projectConnections.projectId, projectId)),
    );
    expect(conn.capabilities).toContain("email.list_messages");

    // Removing the agent removes what only it used.
    await setAgentEnabled(db, tenant, projectId, inboundId, true);
    await removeAgent(db, tenant, projectId, inboundId);
    links = await withTenant(db, tenant, (tx) =>
      tx.select().from(projectIdentities).where(eq(projectIdentities.projectId, projectId)),
    );
    expect(links).toEqual([]);
    expect(await listProjectAgents(db, tenant, projectId)).toEqual([]);
    // The process stays with the project.
    expect((await getProjectProcess(db, tenant, projectId))?.currentVersion).toBe(2);
  });

  it("keeps the project's process when an agent is added again", async () => {
    const added = await addAgent(db, tenant, projectId, "inbound", "b2c_assisted");
    const agent = await getAgent(db, tenant, projectId, added.id);
    expect(agent?.config.enabled).toBe(false);
    const process = await getProjectProcess(db, tenant, projectId);
    expect(process?.currentVersion).toBe(2);
    expect(process?.salesMotion).toBe("b2b_transactional");
  });
});

describe("agent tools", () => {
  it("adds and removes tools one by one, with the functions of an MCP server", async () => {
    const { id: agentId } = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
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
    const tools = async () => (await getAgent(db, tenant, projectId, agentId))!.config.tools;

    await addAgentTool(db, tenant, projectId, agentId, "web");
    await addAgentTool(db, tenant, projectId, agentId, `data:${hunter.id}`);
    await addAgentTool(db, tenant, projectId, agentId, `mcp:${mcp.id}`);
    expect(await tools()).toMatchObject({
      web: true,
      data: [hunter.id],
      mcp: [{ connectionId: mcp.id, tools: ["buscar", "crear"] }],
    });

    await setAgentMcpTools(db, tenant, projectId, agentId, mcp.id, ["buscar", "inventada"]);
    expect((await tools()).mcp).toEqual([{ connectionId: mcp.id, tools: ["buscar"] }]);
    await expect(setAgentMcpTools(db, tenant, projectId, agentId, mcp.id, [])).rejects.toThrow(
      "al menos una",
    );

    await removeAgentTool(db, tenant, projectId, agentId, `mcp:${mcp.id}`);
    await removeAgentTool(db, tenant, projectId, agentId, "web");
    expect(await tools()).toEqual({ web: false, mcp: [], data: [hunter.id] });
    await expect(
      addAgentTool(db, tenant, projectId, agentId, "data:00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("no encontrada");
  });
});
