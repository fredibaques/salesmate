import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { notifyTeam } from "../agents/automation";
import { pageContext } from "../agents/page-context";
import type { Db } from "../db/client";
import { agentRuns, connections, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { createBase, setAgentBase } from "../prospects/bases";
import { saveProspects } from "../prospects/service";
import { addAgent } from "./agents";
import { appNotices, markNoticesSeen, workingAgents } from "./top-bar";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let user: { orgId: string; userId: string };
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Barra");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  user = { orgId: seeded.orgId, userId: seeded.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx.insert(projects).values({ orgId: tenant.orgId, name: "Motor", timezone: "Europe/Madrid" }).returning(),
  );
  projectId = p.id;
});
afterAll(async () => close());

const startRun = (agentId: string, values: Partial<typeof agentRuns.$inferInsert> = {}) =>
  withTenant(db, tenant, async (tx) => {
    const [run] = await tx
      .insert(agentRuns)
      .values({
        orgId: tenant.orgId,
        projectId,
        agentType: "prospecting",
        agentConfigId: agentId,
        trigger: "manual",
        model: "test",
        ...values,
      })
      .returning();
    return run;
  });

describe("top bar", () => {
  it("shows the agents at work with their task's progress", async () => {
    const agent = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
    expect(await workingAgents(db, tenant, { projectIds: [projectId] })).toEqual([]);
    await startRun(agent.id, { task: { id: "t1", kind: "find", total: 120, done: 45 } });
    // A run left «running» long ago isn't working any more.
    await startRun(agent.id, { startedAt: new Date(Date.now() - 3600_000) });

    const working = await workingAgents(db, tenant, { projectIds: [projectId] });
    expect(working).toHaveLength(1);
    expect(working[0]).toMatchObject({ id: agent.id, label: "Agente de prospección" });
    expect(working[0].tasks).toHaveLength(1);
    expect(working[0].tasks[0]).toMatchObject({
      title: "Buscar 120 filas nuevas",
      progress: { done: 45, total: 120, unit: "filas" },
    });
    // Projects the person can't see stay out.
    expect(await workingAgents(db, tenant, { projectIds: [] })).toEqual([]);
  });

  it("lists what needs attention and how runs went, new until the bell is opened", async () => {
    const agent = await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
    const done = await startRun(agent.id, {
      agentType: "outbound",
      status: "completed",
      finishedAt: new Date(),
    });
    // The run's notice is kept for the bell even when the team isn't told anywhere else.
    await notifyTeam({ db, gateway: { db, executor: { execute: async () => ({}) } } }, tenant, {
      agent: { ...agent, settings: {}, channels: {} },
      projectName: "Motor",
      runId: done.id,
      notice: { problem: false, headline: "Ha terminado: 3 emails", details: "Ha escrito a 3 filas." },
    });
    await startRun(agent.id, {
      agentType: "outbound",
      status: "failed",
      error: "Sin buzón",
      finishedAt: new Date(),
    });
    await withTenant(db, tenant, (tx) =>
      tx.insert(connections).values({
        orgId: tenant.orgId,
        provider: "gmail",
        label: "Gmail ventas",
        accountRef: "ventas@example.com",
        status: "error",
        lastError: "El permiso ha caducado",
      }),
    );

    const first = await appNotices(db, user, { projectIds: [projectId], pendingApprovals: 2 });
    expect(first.notices.map((n) => n.title)).toEqual(
      expect.arrayContaining([
        "2 acciones esperan tu aprobación",
        "Revisa la conexión «Gmail ventas»",
        "Agente outbound: Ha terminado: 3 emails",
        "Agente outbound: La ejecución ha fallado",
      ]),
    );
    const failed = first.notices.find((n) => n.title.endsWith("ha fallado"));
    expect(failed).toMatchObject({ tone: "problem", detail: "Sin buzón", unread: true });
    expect(first.unread).toBe(first.notices.length);

    // Once opened, runs are no longer new; what still waits for someone keeps counting.
    await markNoticesSeen(db, user, new Date(Date.now() + 1000));
    const after = await appNotices(db, user, { projectIds: [projectId], pendingApprovals: 2 });
    expect(after.unread).toBe(2);
    expect(after.notices.filter((n) => n.key.startsWith("run:")).every((n) => !n.unread)).toBe(true);
  });

  it("tells the Copilot what is on screen", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "Concesionarios",
      rowKind: "company",
      columns: [{ name: "Web coches.net", type: "url" }],
    });
    await saveProspects(db, tenant, {
      baseId: base.id,
      items: [
        { companyName: "Autos García", fields: { web_coches_net: "https://www.coches.net/autos-garcia" } },
      ],
    });
    const all = () => true;
    const table = await pageContext(db, tenant, `/app/tables/${base.id}`, all);
    expect(table).toMatchObject({ label: "Tabla «Concesionarios»", projectId });
    expect(table?.text).toMatch(/Web coches\.net \(url.*1 de 1 con valor/);
    expect(table?.text).toMatch(/Autos García/);
    // A table of a project the person can't see says nothing.
    expect(await pageContext(db, tenant, `/app/tables/${base.id}`, () => false)).toBeNull();

    const agent = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
    await setAgentBase(db, tenant, projectId, agent.id, base.id);
    await startRun(agent.id, { status: "failed", error: "Búsqueda sin resultados", finishedAt: new Date() });
    const page = await pageContext(db, tenant, `/app/projects/${projectId}/agents/${agent.id}?config=1`, all);
    expect(page?.label).toMatch(/^Agente «Agente de prospección/);
    expect(page?.text).toMatch(/Trabaja en la tabla «Concesionarios»/);
    expect(page?.text).toMatch(/Error: Búsqueda sin resultados/);

    expect(await pageContext(db, tenant, "/app/conversations", all)).toBeNull();
  });
});
