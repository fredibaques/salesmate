import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { recordActionInConversation } from "../agents/conversations";
import type { Db } from "../db/client";
import {
  connections,
  contacts,
  conversations,
  identities,
  messages,
  projectIdentities,
  projects,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction, type ActionExecutor, type GatewayDeps } from "../gateway/gateway";
import {
  addNote,
  changePerson,
  getPerson,
  listInbox,
  markRead,
  replyToPerson,
  whatsappTemplates,
} from "./inbox";
import { mockFetch } from "../../../tests/helpers/fetch";
import { encryptJson } from "../crypto";
import { eq } from "drizzle-orm";

let db: Db;
let close: () => Promise<void>;
let orgId: string;
let userId: string;
let person: TenantContext;
let agent: TenantContext;
let projectId: string;
let contactId: string;
const ANA = "e:ana@autosruiz.es";
let emailConv: string;
let whatsappConv: string;
let emailIdentityId: string;
let now = new Date("2026-10-07T09:00:00Z");

const sent: string[] = [];
const executor: ActionExecutor = {
  async execute({ action }) {
    sent.push(action.type);
    return { externalId: `ext-${sent.length}` };
  },
};
const deps = (): GatewayDeps => ({
  db,
  executor,
  now: () => now,
  afterExecute: ({ orgId: org, action }) => recordActionInConversation(db, org, action),
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ({ orgId, userId } = await seedOrg(db, "Inbox"));
  person = { orgId, actorType: "user", actorId: userId };
  agent = { orgId, actorType: "agent", actorId: "run-1" };
  await withTenant(db, { orgId }, async (tx) => {
    const [project] = await tx.insert(projects).values({ orgId, name: "Swipoo" }).returning();
    projectId = project.id;
    const [mail] = await tx
      .insert(connections)
      .values({ orgId, provider: "google", label: "Gmail", accountRef: "ventas@swipoo.es" })
      .returning();
    const [wa] = await tx
      .insert(connections)
      .values({ orgId, provider: "whatsapp", label: "WhatsApp", accountRef: "+34600000000" })
      .returning();
    const ids = await tx
      .insert(identities)
      .values([
        { orgId, kind: "email", provider: "google", address: "ventas@swipoo.es", connectionId: mail.id },
        { orgId, kind: "whatsapp", provider: "whatsapp", address: "+34600000000", connectionId: wa.id },
      ])
      .returning();
    emailIdentityId = ids[0].id;
    await tx
      .insert(projectIdentities)
      .values(ids.map((i) => ({ orgId, projectId, identityId: i.id, isDefault: true })));
    const [contact] = await tx
      .insert(contacts)
      .values({
        orgId,
        projectId,
        firstName: "Ana",
        lastName: "Ruiz",
        email: "ana@autosruiz.es",
        phone: "+34611222333",
        companyName: "Autos Ruiz",
      })
      .returning();
    contactId = contact.id;
    const convs = await tx
      .insert(conversations)
      .values([
        {
          orgId,
          projectId,
          contactId,
          channel: "email",
          externalThreadId: "t-1",
          status: "waiting_customer",
          lastMessageAt: new Date("2026-10-06T10:00:00Z"),
        },
        {
          orgId,
          projectId,
          contactId,
          channel: "whatsapp",
          status: "waiting_us",
          lastMessageAt: new Date("2026-10-07T08:00:00Z"),
        },
      ])
      .returning();
    [emailConv, whatsappConv] = convs.map((c) => c.id);
    await tx.insert(messages).values([
      {
        orgId,
        conversationId: emailConv,
        direction: "inbound",
        channel: "email",
        subject: "Precios",
        body: "¿Cuánto cuesta?",
        sentAt: new Date("2026-10-06T09:00:00Z"),
      },
      {
        orgId,
        conversationId: emailConv,
        direction: "outbound",
        channel: "email",
        subject: "Re: Precios",
        body: "Desde 49 €.",
        sentAt: new Date("2026-10-06T10:00:00Z"),
      },
      {
        orgId,
        conversationId: whatsappConv,
        direction: "inbound",
        channel: "whatsapp",
        body: "¿Y para particulares?",
        sentAt: new Date("2026-10-07T08:00:00Z"),
      },
    ]);
    // Someone who only filled the web form, already answered.
    const [other] = await tx
      .insert(contacts)
      .values({ orgId, projectId, firstName: "Luis", email: "luis@example.com" })
      .returning();
    const [formConv] = await tx
      .insert(conversations)
      .values({
        orgId,
        projectId,
        contactId: other.id,
        channel: "form",
        status: "closed",
        lastMessageAt: new Date("2026-10-01T09:00:00Z"),
      })
      .returning();
    await tx.insert(messages).values({
      orgId,
      conversationId: formConv.id,
      direction: "inbound",
      channel: "form",
      body: "Información, por favor",
      sentAt: new Date("2026-10-01T09:00:00Z"),
    });
  });
});
afterAll(async () => close());

describe("the conversations inbox", () => {
  it("shows one row per person, whatever channels they wrote through", async () => {
    const { rows, counts } = await listInbox(db, { orgId, userId }, { box: "all" });
    expect(counts).toEqual({ needs: 1, waiting: 0, closed: 1, all: 2 });
    const ana = rows[0];
    expect(ana).toMatchObject({
      key: ANA,
      name: "Ana Ruiz",
      company: "Autos Ruiz",
      channels: ["whatsapp", "email"],
      box: "needs",
      unread: true,
      last: { body: "¿Y para particulares?", channel: "whatsapp", direction: "inbound" },
    });
    expect((await listInbox(db, { orgId, userId }, { box: "closed" })).rows.map((r) => r.name)).toEqual([
      "Luis",
    ]);
    expect((await listInbox(db, { orgId, userId }, { box: "all", q: "autos" })).rows).toHaveLength(1);
    expect(
      (await listInbox(db, { orgId, userId }, { box: "all", channel: "form" })).rows.map((r) => r.name),
    ).toEqual(["Luis"]);

    await markRead(db, { orgId, userId }, ANA);
    expect((await listInbox(db, { orgId, userId }, {})).rows[0].unread).toBe(false);
  });

  it("merges a person's conversations into one thread and shows what waits for approval", async () => {
    const draft = await proposeAction(deps(), agent, {
      projectId,
      type: "email.send",
      agentType: "inbound",
      payload: {
        identityId: emailIdentityId,
        to: ["ana@autosruiz.es"],
        subject: "Re: Precios",
        body: "También para particulares.",
      },
      context: { subjectRef: `conversation:${emailConv}` },
    });
    expect(draft.outcome).toBe("pending_approval");
    const ana = (await getPerson(db, person, ANA, { now }))!;
    expect(ana.messages.map((m) => m.body)).toEqual([
      "¿Cuánto cuesta?",
      "Desde 49 €.",
      "¿Y para particulares?",
    ]);
    expect(ana.actions.map((a) => a.status)).toEqual(["pending_approval"]);
    expect(ana.preferredChannel).toBe("whatsapp");
    expect(ana.replyChannels).toEqual({
      email: { from: "ventas@swipoo.es" },
      whatsapp: { from: "+34600000000", windowOpen: true },
    });
    expect((await listInbox(db, { orgId, userId }, {})).rows[0].pending).toBe(1);
  });

  it("lets a person answer through the gateway, and the reply lands in the thread", async () => {
    expect(await replyToPerson(deps(), person, ANA, { channel: "whatsapp", body: "Sí, desde 19 €." })).toBe(
      "Enviado.",
    );
    expect(
      await replyToPerson(deps(), person, ANA, {
        channel: "email",
        body: "Te lo confirmo por escrito.",
      }),
    ).toBe("Enviado.");
    const ana = (await getPerson(db, person, ANA, { now }))!;
    const outbound = ana.messages.filter((m) => m.direction === "outbound").slice(-2);
    expect(outbound.map((m) => [m.channel, m.body, m.subject])).toEqual([
      ["whatsapp", "Sí, desde 19 €.", null],
      ["email", "Te lo confirmo por escrito.", "Re: Precios"],
    ]);

    // WhatsApp only takes free text within 24 h of their last message.
    now = new Date("2026-10-09T09:00:00Z");
    await expect(
      replyToPerson(deps(), person, ANA, { channel: "whatsapp", body: "¿Seguimos?" }),
    ).rejects.toThrow(/24 horas/);

    // An approved template can still be sent: it lands in the thread as its filled-in body.
    await withTenant(db, { orgId }, (tx) =>
      tx
        .update(connections)
        .set({
          writeScopes: ["whatsapp"],
          credentialsEncrypted: encryptJson({
            accessToken: "EAAG-token-de-prueba-123456",
            phoneNumberId: "1234567890",
            appSecret: "secreto-de-la-app-123",
            verifyToken: "x".repeat(20),
            businessAccountId: "555666777",
          }),
        })
        .where(eq(connections.provider, "whatsapp")),
    );
    const meta = mockFetch({
      "GET https://graph.facebook.com/v21.0/555666777/message_templates": () => ({
        data: [
          {
            name: "seguimiento",
            language: "es",
            status: "APPROVED",
            components: [{ type: "BODY", text: "Hola {{1}}, ¿seguimos con lo de {{2}}?" }],
          },
        ],
      }),
    });
    const connectors = { fetch: meta.fetch };
    expect((await whatsappTemplates({ db, connectors }, person, ANA)).map((t) => t.name)).toEqual([
      "seguimiento",
    ]);
    await expect(
      replyToPerson({ ...deps(), connectors }, person, ANA, {
        channel: "whatsapp",
        body: "",
        template: { name: "seguimiento", language: "es", params: ["Ana"] },
      }),
    ).rejects.toThrow(/huecos/);
    expect(
      await replyToPerson({ ...deps(), connectors }, person, ANA, {
        channel: "whatsapp",
        body: "",
        template: { name: "seguimiento", language: "es", params: ["Ana", "las motos"] },
      }),
    ).toBe("Enviado.");
    const last = (await getPerson(db, person, ANA, { now }))!.messages.at(-1)!;
    expect([last.channel, last.body]).toEqual(["whatsapp", "Hola Ana, ¿seguimos con lo de las motos?"]);
  });

  it("takes a person over from the agents, keeps notes for the team, and closes them", async () => {
    await changePerson(db, person, ANA, "take_over");
    let ana = (await getPerson(db, person, ANA))!;
    expect(ana.handedOff).toBe(true);
    await addNote(db, person, ANA, "Fredi", "Llamarla el lunes.");
    ana = (await getPerson(db, person, ANA))!;
    expect(ana.messages.at(-1)).toMatchObject({
      direction: "internal",
      channel: "note",
      body: "Llamarla el lunes.",
      fromAddress: "Fredi",
    });
    // Notes don't count as the last message of the row.
    expect((await listInbox(db, { orgId, userId }, { box: "all" })).rows[0].last?.body).not.toBe(
      "Llamarla el lunes.",
    );

    await changePerson(db, person, ANA, "close");
    expect((await getPerson(db, person, ANA))!.closed).toBe(true);
    await changePerson(db, person, ANA, "reopen");
    expect((await getPerson(db, person, ANA))!.conversations.map((c) => c.status)).toEqual(["open", "open"]);
  });

  it("joins the same person across projects, and a project's tab shows only its part", async () => {
    const other = await withTenant(db, { orgId }, async (tx) => {
      const [project] = await tx.insert(projects).values({ orgId, name: "Seguros" }).returning();
      const [contact] = await tx
        .insert(contacts)
        .values({ orgId, projectId: project.id, firstName: "Ana", email: "Ana@AutosRuiz.es" })
        .returning();
      const [conv] = await tx
        .insert(conversations)
        .values({
          orgId,
          projectId: project.id,
          contactId: contact.id,
          channel: "form",
          status: "waiting_us",
          lastMessageAt: new Date("2026-10-08T09:00:00Z"),
        })
        .returning();
      await tx.insert(messages).values({
        orgId,
        conversationId: conv.id,
        direction: "inbound",
        channel: "form",
        body: "¿Y seguros para flotas?",
        sentAt: new Date("2026-10-08T09:00:00Z"),
      });
      return project.id;
    });
    const { rows } = await listInbox(db, { orgId, userId }, { box: "all" });
    const ana = rows.find((r) => r.key === ANA)!;
    expect(rows.filter((r) => r.name.startsWith("Ana"))).toHaveLength(1);
    expect(ana.projectNames.sort()).toEqual(["Seguros", "Swipoo"]);
    expect(ana.channels.sort()).toEqual(["email", "form", "whatsapp"]);
    expect((await getPerson(db, person, ANA))!.conversations).toHaveLength(3);
    expect(
      (await getPerson(db, person, ANA, { projectId: other }))!.conversations.map((c) => c.channel),
    ).toEqual(["form"]);
    expect(
      (await listInbox(db, { orgId, userId }, { box: "all", projectId: other })).rows.map((r) => r.key),
    ).toEqual([ANA]);
  });
});
