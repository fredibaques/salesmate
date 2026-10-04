import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import {
  actions,
  agentConfigs,
  approvals,
  auditLog,
  complianceRules,
  connections,
  identities,
  knowledgeSources,
  projectConnections,
  projectIdentities,
  projects,
  suppressions,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import {
  decideAction,
  executeAction,
  GatewayError,
  proposeAction,
  releaseDueActions,
  type ActionExecutor,
  type GatewayDeps,
} from "./gateway";

// Wednesday 7 Oct 2026, 11:00 in Madrid (inside the default 08:00–20:00 window).
const WEDNESDAY_11H = new Date("2026-10-07T09:00:00Z");

let db: Db;
let close: () => Promise<void>;
let orgId: string;
let userId: string;
let agent: TenantContext;
let person: TenantContext & { actorType: "user"; actorId: string };

class FakeExecutor implements ActionExecutor {
  calls: string[] = [];
  fail = false;
  async execute({ action }: Parameters<ActionExecutor["execute"]>[0]) {
    this.calls.push(action.id);
    if (this.fail) throw new Error("SMTP down");
    return { externalId: `ext-${this.calls.length}` };
  }
}

let executor: FakeExecutor;
let now: Date;
const deps = (): GatewayDeps => ({ db, executor, now: () => now });

type Fixture = { projectId: string; identityId: string; otherIdentityId: string };

async function createProject(name: string): Promise<Fixture> {
  return withTenant(db, { orgId }, async (tx) => {
    const [project] = await tx.insert(projects).values({ orgId, name }).returning();
    const [mail] = await tx
      .insert(connections)
      .values({ orgId, provider: "google", label: "Gmail", accountRef: `${name}@example.com` })
      .returning();
    const [crm] = await tx
      .insert(connections)
      .values({ orgId, provider: "twenty", label: "CRM", accountRef: `https://${name}.crm.test` })
      .returning();
    const [identity] = await tx
      .insert(identities)
      .values({
        orgId,
        kind: "email",
        provider: "google",
        address: `${name}@example.com`,
        connectionId: mail.id,
      })
      .returning();
    const [other] = await tx
      .insert(identities)
      .values({
        orgId,
        kind: "email",
        provider: "google",
        address: `other-${name}@example.com`,
        connectionId: mail.id,
      })
      .returning();
    await tx.insert(projectIdentities).values({ orgId, projectId: project.id, identityId: identity.id });
    await tx.insert(projectConnections).values({
      orgId,
      projectId: project.id,
      connectionId: crm.id,
      capabilities: ["crm.upsert_contact", "crm.create_task", "crm.log_note"],
    });
    return { projectId: project.id, identityId: identity.id, otherIdentityId: other.id };
  });
}

let recipientSeq = 0;
/** Each call gets a fresh recipient unless one is given (avoids cross-test cooldowns). */
function email(
  f: Fixture,
  to = `cliente${++recipientSeq}@cliente.com`,
  body = "Hola Ana, ¿hablamos esta semana?",
) {
  return {
    projectId: f.projectId,
    type: "email.send",
    agentType: "outbound" as const,
    payload: { identityId: f.identityId, to: [to], subject: "Propuesta", body },
  };
}

async function setAutonomy(projectId: string, level: number, limits = {}) {
  await withTenant(db, { orgId }, (tx) =>
    tx
      .insert(agentConfigs)
      .values({
        orgId,
        projectId,
        agentType: "outbound",
        enabled: true,
        autonomy: { default: level },
        limits,
      })
      .onConflictDoUpdate({
        target: [agentConfigs.projectId, agentConfigs.agentType],
        set: { autonomy: { default: level }, limits },
      }),
  );
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ({ orgId, userId } = await seedOrg(db, "Acme"));
  agent = { orgId, actorType: "agent", actorId: "run-1" };
  person = { orgId, actorType: "user", actorId: userId };
});

afterAll(async () => close());

beforeEach(() => {
  executor = new FakeExecutor();
  now = WEDNESDAY_11H;
});

describe("approval flow", () => {
  it("queues agent actions for approval by default and executes once approved", async () => {
    const f = await createProject("p1");
    const proposed = await proposeAction(deps(), agent, email(f));
    expect(proposed.outcome).toBe("pending_approval");
    expect(proposed.action.autonomyLevel).toBe(1);
    expect(executor.calls).toHaveLength(0);

    const decided = await decideAction(deps(), person, {
      actionId: proposed.action.id,
      decision: "approved",
    });
    expect(decided.outcome).toBe("executed");
    expect(decided.action.status).toBe("succeeded");
    expect(decided.action.result).toEqual({ externalId: "ext-1" });
    expect(executor.calls).toEqual([proposed.action.id]);

    const events = await withTenant(db, { orgId }, (tx) =>
      tx.select({ event: auditLog.event }).from(auditLog).where(eq(auditLog.entityId, proposed.action.id)),
    );
    expect(events.map((e) => e.event)).toEqual([
      "action.pending_approval",
      "action.approved",
      "action.executing",
      "action.succeeded",
    ]);
  });

  it("executes immediately when a person acts directly", async () => {
    const f = await createProject("p2");
    const { agentType: _ignored, ...input } = email(f);
    const result = await proposeAction(deps(), person, input);
    expect(result.outcome).toBe("executed");
  });

  it("records rejections with their reason", async () => {
    const f = await createProject("p3");
    const proposed = await proposeAction(deps(), agent, email(f));
    const rejected = await decideAction(deps(), person, {
      actionId: proposed.action.id,
      decision: "rejected",
      reason: "Tono demasiado agresivo",
    });
    expect(rejected.action.status).toBe("rejected");
    const [approval] = await withTenant(db, { orgId }, (tx) =>
      tx.select().from(approvals).where(eq(approvals.actionId, proposed.action.id)),
    );
    expect(approval).toMatchObject({
      decision: "rejected",
      reason: "Tono demasiado agresivo",
      decidedBy: userId,
    });
    await expect(
      decideAction(deps(), person, { actionId: proposed.action.id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("re-validates an edited payload before executing it", async () => {
    const f = await createProject("p4");
    await withTenant(db, { orgId }, (tx) =>
      tx
        .insert(suppressions)
        .values({ orgId, type: "email", value: "baja@cliente.com", reason: "Pidió la baja" }),
    );
    const proposed = await proposeAction(deps(), agent, email(f));
    const result = await decideAction(deps(), person, {
      actionId: proposed.action.id,
      decision: "approved",
      editedPayload: { ...proposed.action.payload, to: ["baja@cliente.com"] },
    });
    expect(result.action.status).toBe("blocked");
    expect(executor.calls).toHaveLength(0);
  });
});

describe("autonomy", () => {
  it("auto-executes at level 2", async () => {
    const f = await createProject("auto");
    await setAutonomy(f.projectId, 2);
    const result = await proposeAction(deps(), agent, email(f));
    expect(result.outcome).toBe("executed");
  });

  it("is idempotent for the same proposal", async () => {
    const f = await createProject("idem");
    await setAutonomy(f.projectId, 3);
    const input = email(f);
    const first = await proposeAction(deps(), agent, input);
    const second = await proposeAction(deps(), agent, structuredClone(input));
    expect(second.outcome).toBe("duplicate");
    expect(second.action.id).toBe(first.action.id);
    expect(executor.calls).toHaveLength(1);
  });

  it("executes a claimed action only once", async () => {
    const f = await createProject("once");
    const proposed = await proposeAction(deps(), agent, email(f));
    await withTenant(db, { orgId }, (tx) =>
      tx.update(actions).set({ status: "approved" }).where(eq(actions.id, proposed.action.id)),
    );
    await Promise.all([
      executeAction(deps(), agent, proposed.action.id),
      executeAction(deps(), agent, proposed.action.id),
    ]);
    expect(executor.calls).toHaveLength(1);
  });

  it("marks failed executions", async () => {
    const f = await createProject("fail");
    await setAutonomy(f.projectId, 3);
    executor.fail = true;
    const result = await proposeAction(deps(), agent, email(f));
    expect(result.outcome).toBe("failed");
    expect(result.action.error).toBe("SMTP down");
  });
});

describe("policies", () => {
  it("rejects unknown types and invalid payloads", async () => {
    const f = await createProject("invalid");
    await expect(
      proposeAction(deps(), agent, { ...email(f), type: "crm.delete_everything" }),
    ).rejects.toMatchObject({ code: "unknown_action" });
    await expect(
      proposeAction(deps(), agent, { ...email(f), payload: { identityId: f.identityId, to: [] } }),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("blocks suppressed recipients (by domain)", async () => {
    const f = await createProject("supp");
    await withTenant(db, { orgId }, (tx) =>
      tx
        .insert(suppressions)
        .values({ orgId, projectId: f.projectId, type: "domain", value: "competidor.com" }),
    );
    const result = await proposeAction(deps(), agent, email(f, "ceo@competidor.com"));
    expect(result.outcome).toBe("blocked");
    expect(result.action.policyResults.at(-1)).toMatchObject({ policy: "suppression", outcome: "block" });
  });

  it("blocks identities not assigned to the project", async () => {
    const f = await createProject("ident");
    const input = email(f);
    input.payload.identityId = f.otherIdentityId;
    const result = await proposeAction(deps(), agent, input);
    expect(result.outcome).toBe("blocked");
  });

  it("honours the kill switch", async () => {
    const f = await createProject("kill");
    const pending = await proposeAction(deps(), agent, email(f));
    await withTenant(db, { orgId }, (tx) =>
      tx.update(projects).set({ agentsPaused: true }).where(eq(projects.id, f.projectId)),
    );
    const blocked = await proposeAction(deps(), agent, email(f, "otra@cliente.com"));
    expect(blocked.outcome).toBe("blocked");

    // Approving an earlier agent action while paused does not execute it.
    const decided = await decideAction(deps(), person, { actionId: pending.action.id, decision: "approved" });
    expect(decided.action.status).toBe("blocked");
    expect(executor.calls).toHaveLength(0);
  });

  it("defers outbound actions outside the send window and releases them later", async () => {
    const f = await createProject("window");
    await setAutonomy(f.projectId, 3);
    now = new Date("2026-10-07T20:30:00Z"); // 22:30 in Madrid
    const result = await proposeAction(deps(), agent, email(f));
    expect(result.outcome).toBe("deferred");
    expect(result.action.scheduledFor?.toISOString()).toBe("2026-10-08T06:00:00.000Z"); // 08:00 Madrid

    now = new Date("2026-10-08T06:05:00Z");
    const released = await releaseDueActions(deps(), agent);
    expect(released.map((r) => r.outcome)).toEqual(["executed"]);
  });

  it("skips weekends by default", async () => {
    const f = await createProject("weekend");
    await setAutonomy(f.projectId, 3);
    now = new Date("2026-10-10T10:00:00Z"); // Saturday
    const result = await proposeAction(deps(), agent, email(f));
    expect(result.action.scheduledFor?.toISOString()).toBe("2026-10-12T06:00:00.000Z"); // Monday 08:00
  });

  it("asks for approval when another project contacted the same person recently", async () => {
    const a = await createProject("crossa");
    const b = await createProject("crossb");
    await setAutonomy(a.projectId, 3);
    await setAutonomy(b.projectId, 3);
    expect((await proposeAction(deps(), agent, email(b, "lucia@empresa.com"))).outcome).toBe("executed");
    const result = await proposeAction(deps(), agent, email(a, "lucia@empresa.com"));
    expect(result.outcome).toBe("pending_approval");
    expect(result.action.policyResults).toContainEqual(
      expect.objectContaining({ policy: "cross_project_cooldown", outcome: "require_approval" }),
    );
    // A colleague at the same company is a different person.
    expect((await proposeAction(deps(), agent, email(a, "pedro@empresa.com"))).outcome).toBe("executed");
  });

  it("defers once the daily limit is reached", async () => {
    const f = await createProject("limit");
    await setAutonomy(f.projectId, 3, { daily: { "email.send": 1 } });
    expect((await proposeAction(deps(), agent, email(f, "uno@x.com"))).outcome).toBe("executed");
    const second = await proposeAction(deps(), agent, email(f, "dos@x.com"));
    expect(second.outcome).toBe("deferred");
  });

  it("requires approval for figures without a source of truth", async () => {
    const f = await createProject("figures");
    await setAutonomy(f.projectId, 3);
    const body = "El servicio cuesta 49 € al mes.";
    const unbacked = await proposeAction(deps(), agent, email(f, "a@b.com", body));
    expect(unbacked.outcome).toBe("pending_approval");

    const [source] = await withTenant(db, { orgId }, (tx) =>
      tx
        .insert(knowledgeSources)
        .values({ orgId, projectId: f.projectId, kind: "table", name: "Tarifas", reliability: "truth" })
        .returning(),
    );
    const backed = await proposeAction(deps(), agent, {
      ...email(f, "c@d.com", body),
      citations: [{ sourceId: source.id, ref: "row-1" }],
    });
    expect(backed.outcome).toBe("executed");
  });

  it("applies the project's compliance rules", async () => {
    const f = await createProject("rules");
    await setAutonomy(f.projectId, 3);
    await withTenant(db, { orgId }, (tx) =>
      tx.insert(complianceRules).values([
        {
          orgId,
          projectId: f.projectId,
          kind: "human_only",
          description: "Las reuniones las confirma una persona",
          spec: { actionTypes: ["calendar.book"] },
        },
        {
          orgId,
          projectId: f.projectId,
          kind: "channel_restriction",
          description: "Sin email comercial a particulares",
          spec: { actionTypes: ["email.send"], customerTypes: ["b2c"] },
        },
        {
          orgId,
          projectId: f.projectId,
          kind: "mandatory_notice",
          description: "Pie de baja",
          spec: { actionTypes: ["email.send"], text: "Responde BAJA" },
        },
      ]),
    );
    const b2c = await proposeAction(deps(), agent, { ...email(f), context: { customerType: "b2c" } });
    expect(b2c.outcome).toBe("blocked");

    const noNotice = await proposeAction(deps(), agent, {
      ...email(f, "x@y.com"),
      context: { customerType: "b2b" },
    });
    expect(noNotice.outcome).toBe("pending_approval");

    const withNotice = await proposeAction(deps(), agent, {
      ...email(f, "z@y.com", "Hola. Responde BAJA si no quieres más correos."),
      context: { customerType: "b2b" },
    });
    expect(withNotice.outcome).toBe("executed");

    const meeting = await proposeAction(deps(), agent, {
      projectId: f.projectId,
      type: "calendar.book",
      agentType: "outbound",
      payload: {
        identityId: f.identityId,
        start: "2026-10-09T09:00:00Z",
        end: "2026-10-09T09:30:00Z",
        title: "Demo",
        attendees: [{ email: "z@y.com" }],
      },
    });
    expect(meeting.outcome).toBe("pending_approval");
  });

  it("uses the project connection that offers the capability", async () => {
    const f = await createProject("crm");
    await setAutonomy(f.projectId, 3);
    const result = await proposeAction(deps(), agent, {
      projectId: f.projectId,
      type: "crm.create_task",
      agentType: "outbound",
      payload: { title: "Llamar a Ana" },
    });
    expect(result.outcome).toBe("executed");
    expect(result.action.connectionId).not.toBeNull();
  });
});
