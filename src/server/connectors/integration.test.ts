import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { mockFetch } from "../../../tests/helpers/fetch";
import { getAvailability } from "../calendar/availability";
import type { Db } from "../db/client";
import { connections, identities, meetingTypes, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction } from "../gateway/gateway";
import { ConnectorExecutor } from "./executor";
import { googleProvider } from "./google";
import { twentyProvider } from "./twenty";
import {
  createTwentyConnection,
  linkConnectionToProject,
  saveGoogleConnection,
  setProjectIdentity,
} from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let userId: string;

const providers = (id: string) =>
  id === "twenty"
    ? (twentyProvider as never)
    : (googleProvider({ clientId: "cid", clientSecret: "secret" }) as never);

const validGoogle = (scope: string) => ({
  refreshToken: "r",
  accessToken: "tok",
  expiresAt: Date.now() + 3_600_000,
  scope,
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Conn");
  userId = seeded.userId;
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: userId };
});

afterAll(async () => close());

describe("connections end to end", () => {
  it("validates a Twenty key, stores it encrypted and executes CRM actions through it", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://crm.example.com/rest/metadata/objects": () => ({
        data: {
          objects: [{ nameSingular: "person", namePlural: "people", labelSingular: "P", labelPlural: "P" }],
        },
      }),
      "POST https://crm.example.com/rest/tasks": () => ({ data: { createTask: { id: "t-9" } } }),
    });
    const conn = await createTwentyConnection({ db, fetch }, tenant, {
      label: "CRM",
      baseUrl: "https://crm.example.com",
      apiKey: "secret-api-key-123",
      allowWrite: true,
    });
    expect(conn.credentialsEncrypted).not.toContain("secret-api-key-123");

    const [project] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name: "Ventas" }).returning(),
    );
    const caps = await linkConnectionToProject({ db, providers }, tenant, {
      projectId: project.id,
      connectionId: conn.id,
      capabilities: ["crm.create_task", "email.send"],
    });
    expect(caps).toEqual(["crm.create_task"]);

    const result = await proposeAction(
      { db, executor: new ConnectorExecutor({ db, fetch, providers }) },
      tenant,
      { projectId: project.id, type: "crm.create_task", payload: { title: "Llamar a Ana", body: "Mañana" } },
    );
    expect(result.outcome).toBe("executed");
    expect(result.action.result).toEqual({ id: "t-9" });
    expect(requests.at(-1)).toMatchObject({ method: "POST", url: "https://crm.example.com/rest/tasks" });
  });

  it("refuses to store an invalid Twenty key", async () => {
    const { fetch } = mockFetch({
      "GET https://bad.example.com/rest/metadata/objects": () => new Response("{}", { status: 401 }),
    });
    await expect(
      createTwentyConnection({ db, fetch }, tenant, {
        label: "Bad",
        baseUrl: "https://bad.example.com",
        apiKey: "wrong-key-123",
        allowWrite: false,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("creates mailbox and calendar identities from a Google connection", async () => {
    await saveGoogleConnection({ db }, tenant, {
      email: "yo@acme.com",
      name: "Yo",
      ownerUserId: userId,
      credentials: validGoogle(
        "openid https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/gmail.compose",
      ),
    });
    const rows = await withTenant(db, tenant, (tx) =>
      tx.select().from(identities).where(eq(identities.address, "yo@acme.com")),
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(["calendar", "email"]);
  });

  it("computes availability from every calendar of the host, across projects", async () => {
    // Two Google accounts of the same person (e.g. one per business).
    const work = await saveGoogleConnection({ db }, tenant, {
      email: "trabajo@acme.com",
      name: null,
      ownerUserId: userId,
      credentials: validGoogle("https://www.googleapis.com/auth/calendar.freebusy"),
    });
    const personal = await saveGoogleConnection({ db }, tenant, {
      email: "personal@gmail.com",
      name: null,
      ownerUserId: userId,
      credentials: validGoogle("https://www.googleapis.com/auth/calendar.freebusy"),
    });
    expect(work.id).not.toBe(personal.id);

    const meetingTypeId = await withTenant(db, tenant, async (tx) => {
      const [project] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "B2B" }).returning();
      const [mt] = await tx
        .insert(meetingTypes)
        .values({
          orgId: tenant.orgId,
          projectId: project.id,
          name: "Demo",
          kind: "demo",
          durationMinutes: 30,
          bufferAfterMinutes: 0,
          minNoticeMinutes: 0,
          horizonDays: 0,
          slotStepMinutes: 30,
          weeklyHours: { wed: [["09:00", "11:00"]] },
          hostUserId: userId,
        })
        .returning();
      return mt.id;
    });

    // Busy 09:00–09:30 Madrid in one account and 10:00–10:30 in the other.
    const { fetch, requests } = mockFetch({
      "POST https://www.googleapis.com/calendar/v3/freeBusy": (req) => {
        const ids = (req.body as { items: { id: string }[] }).items.map((i) => i.id);
        const busy = ids.includes("trabajo@acme.com")
          ? [{ start: "2026-10-07T07:00:00Z", end: "2026-10-07T07:30:00Z" }]
          : ids.includes("personal@gmail.com")
            ? [{ start: "2026-10-07T08:00:00Z", end: "2026-10-07T08:30:00Z" }]
            : [];
        return { calendars: Object.fromEntries(ids.map((id) => [id, { busy }])) };
      },
    });
    const availability = await getAvailability(
      { db, fetch, providers, now: () => new Date("2026-10-07T04:00:00Z") },
      tenant,
      meetingTypeId,
    );
    expect(availability.warnings).toEqual([]);
    expect(availability.slots.map((s) => s.start.toISOString())).toEqual([
      "2026-10-07T07:30:00.000Z",
      "2026-10-07T08:30:00.000Z",
    ]);
    // yo@acme.com, trabajo@acme.com and personal@gmail.com live in three connections.
    expect(requests).toHaveLength(3);
  });

  it("sends email through the identity assigned to the project", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send": () => ({
        id: "m1",
        threadId: "t1",
      }),
    });
    const projectId = await withTenant(db, tenant, async (tx) => {
      const [project] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Mail" }).returning();
      return project.id;
    });
    const emailIdentity = await withTenant(
      db,
      tenant,
      async (tx) =>
        (await tx.select().from(identities).where(eq(identities.address, "yo@acme.com"))).find(
          (i) => i.kind === "email",
        )!,
    );
    await setProjectIdentity({ db }, tenant, { projectId, identityId: emailIdentity.id, assigned: true });

    const result = await proposeAction(
      {
        db,
        executor: new ConnectorExecutor({ db, fetch, providers }),
        now: () => new Date("2026-10-07T09:00:00Z"),
      },
      tenant,
      {
        projectId,
        type: "email.send",
        payload: {
          identityId: emailIdentity.id,
          to: ["ana@cliente.com"],
          subject: "Hola",
          body: "¿Hablamos?",
        },
      },
    );
    expect(result.outcome).toBe("executed");
    const raw = Buffer.from((requests[0].body as { raw: string }).raw, "base64url").toString();
    expect(raw).toContain("From: Yo <yo@acme.com>");
  });

  it("disables a connection after an authentication failure", async () => {
    const { fetch } = mockFetch({
      "POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send": () =>
        new Response("{}", { status: 401 }),
    });
    const [conn] = await withTenant(db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.accountRef, "yo@acme.com")),
    );
    const projectId = await withTenant(db, tenant, async (tx) => {
      const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Fail" }).returning();
      return p.id;
    });
    const emailIdentity = await withTenant(
      db,
      tenant,
      async (tx) =>
        (await tx.select().from(identities).where(eq(identities.address, "yo@acme.com"))).find(
          (i) => i.kind === "email",
        )!,
    );
    await setProjectIdentity({ db }, tenant, { projectId, identityId: emailIdentity.id, assigned: true });
    const result = await proposeAction(
      {
        db,
        executor: new ConnectorExecutor({ db, fetch, providers }),
        now: () => new Date("2026-10-07T09:00:00Z"),
      },
      tenant,
      {
        projectId,
        type: "email.send",
        payload: { identityId: emailIdentity.id, to: ["luis@cliente.com"], subject: "Hola", body: "Hola" },
      },
    );
    expect(result.outcome).toBe("failed");
    const [after] = await withTenant(db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.id, conn.id)),
    );
    expect(after.status).toBe("error");
  });
});
