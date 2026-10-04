import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { mockFetch } from "../../../tests/helpers/fetch";
import { googleProvider } from "../connectors/google";
import { saveGoogleConnection, setProjectIdentity } from "../connectors/service";
import type { Db } from "../db/client";
import { identities, inboundEvents, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { pollMailboxes } from "./gmail-poller";
import { leadFromEmail } from "./leads";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;

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
  await setProjectIdentity({ db }, tenant, {
    projectId: project.id,
    identityId: mailbox.id,
    assigned: true,
    isDefault: true,
  });
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
    expect(first).toEqual({ queued: 1, errors: [] });
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
});
