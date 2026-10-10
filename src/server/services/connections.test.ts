import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { connectedTools } from "@/lib/integrations";
import type { Db } from "../db/client";
import { auditLog, connections, identities, projectIdentities, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent, getAgent, saveAgentChannels, saveAgentTools } from "./agents";
import { GOOGLE_SCOPE_SETS } from "../connectors/google";
import { saveGoogleConnection } from "../connectors/service";
import { removeConnection, removeGoogleTool } from "./connections";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Conexiones");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
});
afterAll(async () => close());

describe("disconnecting a tool", () => {
  it("removes the connection, its mailboxes and every agent's use of them", async () => {
    const { projectId, google, hunter, mailboxId } = await withTenant(db, tenant, async (tx) => {
      const [project] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Ventas" }).returning();
      const [google, hunter] = await tx
        .insert(connections)
        .values([
          {
            orgId: tenant.orgId,
            provider: "google",
            transport: "api",
            label: "Google · ana@empresa.es",
            accountRef: "ana@empresa.es",
            credentialsEncrypted: "x",
            readScopes: ["calendar", "email", "meet"],
            writeScopes: ["calendar", "email"],
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
        .returning();
      const [mailbox] = await tx
        .insert(identities)
        .values({
          orgId: tenant.orgId,
          kind: "email",
          provider: "google",
          address: "ana@empresa.es",
          connectionId: google.id,
        })
        .returning();
      return { projectId: project.id, google, hunter, mailboxId: mailbox.id };
    });
    // The grid shows each Google tool the account granted.
    expect(connectedTools([google, hunter]).sort()).toEqual(
      ["gmail", "google", "google_calendar", "google_meet", "hunter"].sort(),
    );

    const inbound = await addAgent(db, tenant, projectId, "inbound");
    await saveAgentChannels(db, tenant, projectId, inbound.id, { mailboxId, readMailbox: true });
    const prospecting = await addAgent(db, tenant, projectId, "prospecting");
    await saveAgentTools(db, tenant, projectId, prospecting.id, { web: true, data: [hunter.id] });

    await removeConnection(db, tenant, google.id);
    expect((await getAgent(db, tenant, projectId, inbound.id))?.config.channels).toMatchObject({
      mailboxId: null,
      readMailbox: false,
    });
    const left = await withTenant(db, tenant, async (tx) => ({
      connections: await tx.select().from(connections),
      identities: await tx.select().from(identities),
      links: await tx.select().from(projectIdentities).where(eq(projectIdentities.projectId, projectId)),
      audit: await tx.select().from(auditLog).where(eq(auditLog.event, "connection.removed")),
    }));
    expect(left.connections.map((c) => c.id)).toEqual([hunter.id]);
    expect(left.identities).toEqual([]);
    expect(left.links).toEqual([]);
    expect(left.audit).toHaveLength(1);

    await removeConnection(db, tenant, hunter.id);
    expect((await getAgent(db, tenant, projectId, prospecting.id))?.config.tools).toMatchObject({
      web: true,
      data: [],
    });
    await expect(removeConnection(db, tenant, hunter.id)).rejects.toThrow("no encontrada");
  });
});

describe("Google tools, each on its own", () => {
  const scope = (...sets: (keyof typeof GOOGLE_SCOPE_SETS)[]) =>
    sets.flatMap((s) => GOOGLE_SCOPE_SETS[s]).join(" ");
  const save = (tool: "gmail" | "google_calendar", granted: string) =>
    saveGoogleConnection({ db }, tenant, {
      email: "luis@empresa.es",
      name: "Luis",
      ownerUserId: tenant.actorId!,
      credentials: { refreshToken: "r", scope: granted },
      tool,
    });
  const mine = () =>
    withTenant(db, tenant, async (tx) => ({
      identities: (await tx.select().from(identities).where(eq(identities.address, "luis@empresa.es")))
        .map((i) => i.kind)
        .sort(),
    }));

  it("turns on only the tool connected, then adds the next one to the same account", async () => {
    const calendar = await save("google_calendar", scope("calendar_read", "calendar_write"));
    expect(calendar).toMatchObject({ readScopes: ["calendar"], writeScopes: ["calendar"] });
    expect((await mine()).identities).toEqual(["calendar"]);

    // Google returns every scope granted so far: only Gmail is added.
    const gmail = await save("gmail", scope("calendar_read", "calendar_write", "gmail_write", "meet_read"));
    expect(gmail.id).toBe(calendar.id);
    expect(gmail).toMatchObject({ readScopes: ["calendar"], writeScopes: ["calendar", "email"] });
    expect((await mine()).identities).toEqual(["calendar", "email"]);
  });

  it("disconnects one tool and keeps the others; the last one removes the account", async () => {
    const projectId = await withTenant(db, tenant, async (tx) => {
      const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Google" }).returning();
      return p.id;
    });
    const [mailbox] = await withTenant(db, tenant, (tx) =>
      tx.select().from(identities).where(eq(identities.kind, "email")),
    );
    const [calendar] = await withTenant(db, tenant, (tx) =>
      tx.select().from(identities).where(eq(identities.kind, "calendar")),
    );
    const agent = await addAgent(db, tenant, projectId, "inbound");
    await saveAgentChannels(db, tenant, projectId, agent.id, {
      mailboxId: mailbox.id,
      calendarId: calendar.id,
    });

    await removeGoogleTool(db, tenant, mailbox.connectionId!, "gmail");
    expect((await getAgent(db, tenant, projectId, agent.id))?.config.channels).toMatchObject({
      mailboxId: null,
      calendarId: calendar.id,
    });
    const [left] = await withTenant(db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.id, mailbox.connectionId!)),
    );
    expect(left).toMatchObject({ readScopes: ["calendar"], writeScopes: ["calendar"] });
    expect((await mine()).identities).toEqual(["calendar"]);

    await removeGoogleTool(db, tenant, left.id, "google_calendar");
    expect((await getAgent(db, tenant, projectId, agent.id))?.config.channels.calendarId).toBeNull();
    const gone = await withTenant(db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.id, left.id)),
    );
    expect(gone).toEqual([]);
    expect((await mine()).identities).toEqual([]);
  });
});
