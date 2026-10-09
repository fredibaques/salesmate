import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { mockFetch } from "../../../tests/helpers/fetch";
import { googleProvider } from "../connectors/google";
import { saveGoogleConnection } from "../connectors/service";
import type { Db } from "../db/client";
import { contacts, conversations, identities, inboundEvents, messages, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { addAgent, saveAgentChannels } from "../services/agents";
import { pollMailboxes } from "./gmail-poller";
import { leadFromEmail } from "./leads";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const gmailMessage = (id: string, from: string, date: string, text: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "To", value: "ventas@empresa.com" },
      { name: "Subject", value: "Consulta" },
      { name: "Date", value: date },
      { name: "Message-ID", value: `<${id}@mail.test>` },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: b64(text) } },
      { mimeType: "text/html", body: { data: b64(`<p>${text}</p>`) } },
    ],
  },
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Poll");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [project] = await withTenant(db, tenant, (tx) =>
    tx.insert(projects).values({ orgId: tenant.orgId, name: "Mail" }).returning(),
  );
  projectId = project.id;
  await saveGoogleConnection({ db }, tenant, {
    email: "ventas@empresa.com",
    name: "Ventas",
    ownerUserId: seeded.userId,
    credentials: {
      refreshToken: "r",
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    },
  });
  const mailbox = await withTenant(db, tenant, async (tx) =>
    (await tx.select().from(identities)).find((i) => i.kind === "email")!,
  );
  // The inbound agent is told to read this mailbox.
  await addAgent(db, tenant, project.id, "inbound", "b2b_consultative");
  await saveAgentChannels(db, tenant, project.id, "inbound", { mailboxId: mailbox.id, readMailbox: true });
});

afterAll(async () => close());

describe("Gmail polling", () => {
  it("queues new messages once, skipping old mail and our own", async () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const { fetch } = mockFetch({
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => ({
        messages: [
          { id: "m1", threadId: "t-m1" },
          { id: "m2", threadId: "t-m2" },
          { id: "m3", threadId: "t-m3" },
        ],
      }),
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/m1": () =>
        gmailMessage(
          "m1",
          "Ana López <Ana@Cliente.com>",
          future,
          "Hola, quiero información.\n\nEl lun, 5 oct 2026, Ventas escribió:\n> anterior",
        ),
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/m2": () =>
        gmailMessage("m2", "Viejo <viejo@cliente.com>", "Mon, 1 Jan 2024 10:00:00 +0000", "Antiguo"),
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/m3": () =>
        gmailMessage("m3", "Ventas <ventas@empresa.com>", future, "Mío"),
    });
    const providers = () => googleProvider({ clientId: "c", clientSecret: "s" }) as never;
    const first = await pollMailboxes({ db, connectors: { fetch, providers } }, tenant.orgId);
    expect(first).toEqual({ queued: 1, replies: 0, errors: [] });
    const again = await pollMailboxes({ db, connectors: { fetch, providers } }, tenant.orgId);
    expect(again.queued).toBe(0);

    const [event] = await withTenant(db, tenant, (tx) => tx.select().from(inboundEvents));
    expect(event).toMatchObject({ source: "gmail", externalId: "m1", status: "pending" });
    const lead = leadFromEmail(event.payload as never);
    expect(lead).toMatchObject({
      email: "ana@cliente.com",
      firstName: "Ana",
      lastName: "López",
      body: "Hola, quiero información.",
      externalThreadId: "t-m1",
      rfcMessageId: "<m1@mail.test>",
    });
  });

  it("puts a reply in one of our threads straight into its conversation", async () => {
    const { contactId, conversationId } = await withTenant(db, tenant, async (tx) => {
      const [contact] = await tx
        .insert(contacts)
        .values({ orgId: tenant.orgId, projectId, email: "luis@talleres.es", status: "contacted" })
        .returning();
      const [conv] = await tx
        .insert(conversations)
        .values({
          orgId: tenant.orgId,
          projectId,
          contactId: contact.id,
          channel: "email",
          externalThreadId: "t-out",
          status: "waiting_customer",
        })
        .returning();
      return { contactId: contact.id, conversationId: conv.id };
    });
    const future = new Date(Date.now() + 60_000).toUTCString();
    const { fetch } = mockFetch({
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => ({
        messages: [{ id: "r1", threadId: "t-out" }],
      }),
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/r1": () => ({
        ...gmailMessage(
          "r1",
          "Luis <luis@talleres.es>",
          future,
          "Sí, llamadme el martes.\n\nEl lun, Ventas escribió:\n> hola",
        ),
        threadId: "t-out",
      }),
    });
    const providers = () => googleProvider({ clientId: "c", clientSecret: "s" }) as never;
    const polled = await pollMailboxes({ db, connectors: { fetch, providers } }, tenant.orgId);
    expect(polled).toEqual({ queued: 1, replies: 1, errors: [] });
    const thread = await withTenant(db, tenant, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, conversationId)),
    );
    expect(thread.map((m) => [m.direction, m.body])).toEqual([["inbound", "Sí, llamadme el martes."]]);
    const [conv] = await withTenant(db, tenant, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, conversationId)),
    );
    expect(conv.status).toBe("waiting_us");
    const [contact] = await withTenant(db, tenant, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, contactId)),
    );
    expect(contact.status).toBe("engaged");
  });
});
