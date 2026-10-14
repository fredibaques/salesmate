import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent, setAgentEnabled } from "../services/agents";
import { agentsWithPendingEvents, processAgentEvents } from "./events";
import { zonedInstant } from "./scheduler";
import { agentTasks, cancelQueuedTask, planTask } from "./tasks";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Planes");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx.insert(projects).values({ orgId: tenant.orgId, name: "Motor", timezone: "Europe/Madrid" }).returning(),
  );
  projectId = p.id;
});
afterAll(async () => close());

describe("zonedInstant", () => {
  it("reads a wall-clock time in the project's zone, summer and winter", () => {
    expect(zonedInstant("2026-07-01", "09:00", "Europe/Madrid").toISOString()).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(zonedInstant("2026-12-01", "09:00", "Europe/Madrid").toISOString()).toBe(
      "2026-12-01T08:00:00.000Z",
    );
    expect(zonedInstant("2026-12-01", "09:00", "UTC").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("planned tasks", () => {
  it("waits in Planificadas until its moment, and can be called off", async () => {
    const agent = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
    await setAgentEnabled(db, tenant, projectId, agent.id, true);
    const now = new Date();
    const dueAt = new Date(now.getTime() + 3 * 3600_000);

    await expect(
      planTask(db, tenant, {
        agentId: agent.id,
        kind: "find",
        find: 50,
        dueAt: new Date(now.getTime() - 3600_000),
      }),
    ).rejects.toThrow(/aún no haya pasado/);
    await expect(planTask(db, tenant, { agentId: agent.id, kind: "outreach", dueAt })).rejects.toThrow(
      /no puede hacer esa tarea/,
    );

    const event = await planTask(db, tenant, { agentId: agent.id, kind: "find", find: 50, dueAt });
    expect(event.payload).toEqual({ planned: true, find: 50 });

    const tasks = await agentTasks(db, tenant, {
      agentId: agent.id,
      timezone: "Europe/Madrid",
      projectPaused: false,
    });
    expect(tasks.planned[0]).toMatchObject({
      title: "Buscar 50 filas nuevas",
      cancelId: event.id,
      progress: null,
    });
    expect(tasks.planned[0].when).not.toBe("en unos minutos");

    // Before its moment the scheduler doesn't take it.
    const { llm } = scriptedLlm([]);
    const deps = { db, llm, gateway: { db, executor: { execute: async () => ({}) } }, now: () => now };
    expect(await processAgentEvents(deps, tenant, agent.id)).toEqual({ status: "idle" });
    expect((await agentsWithPendingEvents(db)).some((a) => a.agentConfigId === agent.id)).toBe(false);

    await cancelQueuedTask(db, tenant, agent.id, event.id);
    const after = await agentTasks(db, tenant, {
      agentId: agent.id,
      timezone: "Europe/Madrid",
      projectPaused: false,
    });
    expect(after.planned.filter((t) => t.cancelId)).toEqual([]);
    await expect(cancelQueuedTask(db, tenant, agent.id, event.id)).rejects.toThrow(/ya no está en cola/);
  });

  it("plans a round of first contacts for the outbound agent", async () => {
    const agent = await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
    const dueAt = new Date(Date.now() + 3600_000);
    await planTask(db, tenant, { agentId: agent.id, kind: "outreach", dueAt });
    const tasks = await agentTasks(db, tenant, {
      agentId: agent.id,
      timezone: "Europe/Madrid",
      projectPaused: false,
    });
    expect(tasks.planned[0].title).toBe("Ronda de primeros contactos");
    // Switched off: it says it waits for that too.
    expect(tasks.planned[0].when).toMatch(/si activas el agente/);
  });
});
