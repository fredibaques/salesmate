import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import {
  actions,
  connections,
  contacts,
  conversations,
  identities,
  messages,
  projectIdentities,
  projects,
  suppressions,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { decideAction, type GatewayDeps } from "../gateway/gateway";
import { createBase } from "../prospects/bases";
import { saveProspects } from "../prospects/service";
import { recordActionInConversation } from "./conversations";
import { prepareFirstContacts } from "./first-contact";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let person: TenantContext & { actorType: "user"; actorId: string };
let projectId: string;
let mailboxId: string;

const gateway = (): GatewayDeps => ({
  db,
  executor: {
    async execute() {
      return { messageId: "gm-1", threadId: "thread-1" };
    },
  },
  afterExecute: ({ orgId, action }) => recordActionInConversation(db, orgId, action),
  now: () => new Date("2026-10-07T09:00:00Z"),
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "First");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  person = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  await withTenant(db, tenant, async (tx) => {
    const [project] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Swipoo" }).returning();
    projectId = project.id;
    const [mail] = await tx
      .insert(connections)
      .values({ orgId: tenant.orgId, provider: "google", label: "Gmail", accountRef: "ventas@swipoo.es" })
      .returning();
    const [identity] = await tx
      .insert(identities)
      .values({
        orgId: tenant.orgId,
        kind: "email",
        provider: "google",
        address: "ventas@swipoo.es",
        connectionId: mail.id,
      })
      .returning();
    mailboxId = identity.id;
    await tx.insert(projectIdentities).values({ orgId: tenant.orgId, projectId, identityId: identity.id });
    await tx.insert(suppressions).values({
      orgId: tenant.orgId,
      projectId,
      type: "email",
      value: "no@excluido.es",
      reason: "Pidió no recibir",
    });
  });
});
afterAll(async () => close());

describe("first contacts", () => {
  it("open a conversation with the row's person, which keeps the reply thread once sent", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "Talleres",
      rowKind: "company",
      columns: [{ name: "Email", type: "email" }],
    });
    await saveProspects(db, tenant, {
      baseId: base.id,
      items: [
        {
          companyName: "Talleres Pérez",
          personName: "Luis Pérez",
          fitScore: 90,
          fields: { email: "luis@perez.es" },
        },
        { companyName: "Excluida SL", fitScore: 85, fields: { email: "no@excluido.es" } },
      ],
    });
    const draft = {
      blocks: [{ type: "text" as const, text: JSON.stringify({ subject: "Hola", body: "Cuerpo" }) }],
    };
    const { llm } = scriptedLlm([draft, draft]);
    const result = await prepareFirstContacts({ db, llm, gateway: gateway() }, tenant, {
      projectId,
      projectName: "Swipoo",
      profile: "Gestoría",
      runId: "00000000-0000-0000-0000-000000000001",
      base: { id: base.id, columns: base.columns },
      mailboxId,
      handoff: { enabled: true },
    });
    expect(result.proposed).toBe(1);
    expect(result.blocked).toEqual([expect.stringMatching(/^Excluida SL/)]);

    const convs = await withTenant(db, tenant, (tx) =>
      tx
        .select({ conversation: conversations, contact: contacts })
        .from(conversations)
        .innerJoin(contacts, eq(contacts.id, conversations.contactId)),
    );
    // The excluded one says nothing: no conversation left behind.
    expect(convs).toHaveLength(1);
    const [{ conversation, contact }] = convs;
    expect(contact).toMatchObject({
      email: "luis@perez.es",
      firstName: "Luis",
      lastName: "Pérez",
      companyName: "Talleres Pérez",
      dataOrigin: "prospecting",
    });
    expect(conversation).toMatchObject({ channel: "email", status: "open", externalThreadId: null });

    // Approved and sent: the email is in the thread, which now knows its Gmail thread.
    const [pending] = await withTenant(db, tenant, (tx) =>
      tx.select().from(actions).where(eq(actions.status, "pending_approval")),
    );
    expect(pending.context.subjectRef).toBe(`conversation:${conversation.id}`);
    await decideAction(gateway(), person, { actionId: pending.id, decision: "approved" });
    const [sent] = await withTenant(db, tenant, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, conversation.id)),
    );
    expect(sent).toMatchObject({ status: "waiting_customer", externalThreadId: "thread-1" });
    const thread = await withTenant(db, tenant, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, conversation.id)),
    );
    expect(thread.map((m) => [m.direction, m.subject])).toEqual([["outbound", "Hola"]]);
    const [contacted] = await withTenant(db, tenant, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, contact.id)),
    );
    expect(contacted.status).toBe("contacted");
  });
});
