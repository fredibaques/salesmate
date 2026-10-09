import { and, desc, eq, gte } from "drizzle-orm";
import { contacts, conversations, messages, type ActionContext } from "../db/schema";
import { withTenant, type Tx } from "../db/tenant";
import type { Db } from "../db/client";
import type { EmailPayload, WhatsappPayload } from "../gateway/definitions";
import type { ActionRow } from "../gateway/gateway";
import { normalizeEmail } from "../gateway/targets";

export type ContactRow = typeof contacts.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;

export type Lead = {
  channel: "form" | "email" | "whatsapp";
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  subject: string | null;
  body: string;
  /** Any other fields the source provided. */
  extra: Record<string, string>;
  externalThreadId: string | null;
  externalMessageId: string | null;
  rfcMessageId: string | null;
  consent: boolean | null;
};

export async function upsertContact(
  tx: Tx,
  orgId: string,
  projectId: string,
  lead: Lead,
  customerType: "b2b" | "b2c" | null,
): Promise<ContactRow> {
  const email = lead.email ? normalizeEmail(lead.email) : null;
  const values = {
    orgId,
    projectId,
    email,
    phone: lead.phone,
    firstName: lead.firstName,
    lastName: lead.lastName,
    companyName: lead.companyName,
    customerType,
    dataOrigin: `inbound:${lead.channel}`,
    legalBasis: lead.consent ? ("consent" as const) : null,
    consentRef: lead.consent ? `${lead.channel}:${new Date().toISOString()}` : null,
  };
  if (email) {
    const [row] = await tx
      .insert(contacts)
      .values(values)
      .onConflictDoUpdate({
        target: [contacts.projectId, contacts.email],
        // Only fill what the new message brings; never erase known data.
        set: {
          updatedAt: new Date(),
          ...(lead.phone ? { phone: lead.phone } : {}),
          ...(lead.firstName ? { firstName: lead.firstName } : {}),
          ...(lead.lastName ? { lastName: lead.lastName } : {}),
          ...(lead.companyName ? { companyName: lead.companyName } : {}),
        },
      })
      .returning();
    return row;
  }
  const [row] = await tx.insert(contacts).values(values).returning();
  return row;
}

/** Same thread → same conversation; a form from a known contact reuses their open conversation. */
export async function findOrCreateConversation(
  tx: Tx,
  input: {
    orgId: string;
    projectId: string;
    contactId: string;
    playbookId: string | null;
    lead: Lead;
    now: Date;
  },
): Promise<ConversationRow> {
  if (input.lead.externalThreadId) {
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, input.projectId),
          eq(conversations.channel, input.lead.channel),
          eq(conversations.externalThreadId, input.lead.externalThreadId),
        ),
      );
    if (existing) return existing;
  } else {
    const [recent] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, input.projectId),
          eq(conversations.contactId, input.contactId),
          gte(conversations.updatedAt, new Date(input.now.getTime() - 30 * 86_400_000)),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    if (recent && recent.status !== "closed") return recent;
  }
  const [created] = await tx
    .insert(conversations)
    .values({
      orgId: input.orgId,
      projectId: input.projectId,
      contactId: input.contactId,
      playbookId: input.playbookId,
      channel: input.lead.channel,
      externalThreadId: input.lead.externalThreadId,
      lastMessageAt: input.now,
    })
    .returning();
  return created;
}

export function conversationRef(conversationId: string) {
  return `conversation:${conversationId}`;
}

function conversationIdFrom(context: ActionContext): string | null {
  const ref = context.subjectRef;
  return ref?.startsWith("conversation:") ? ref.slice("conversation:".length) : null;
}

/**
 * Called after an action executes: emails and WhatsApps sent for a
 * conversation become outbound messages of that conversation.
 */
export async function recordActionInConversation(db: Db, orgId: string, action: ActionRow) {
  if (action.type !== "email.send" && action.type !== "whatsapp.send") return;
  const conversationId = conversationIdFrom(action.context);
  if (!conversationId) return;
  const result = (action.result ?? {}) as { messageId?: string; threadId?: string | null };
  const sent =
    action.type === "email.send"
      ? (() => {
          const p = action.payload as EmailPayload;
          return { channel: "email", toAddresses: p.to, subject: p.subject, body: p.body };
        })()
      : (() => {
          const p = action.payload as WhatsappPayload;
          return { channel: "whatsapp", toAddresses: [p.to], subject: null, body: p.body };
        })();
  await withTenant(db, { orgId }, async (tx) => {
    await tx
      .insert(messages)
      .values({
        orgId,
        conversationId,
        direction: "outbound",
        externalId: result.messageId ?? `action:${action.id}`,
        actionId: action.id,
        ...sent,
      })
      .onConflictDoNothing();
    const [conversation] = await tx
      .update(conversations)
      .set({ status: "waiting_customer", lastMessageAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning();
    // The first email of a conversation we started: its Gmail thread is where the reply will come.
    if (conversation && !conversation.externalThreadId && sent.channel === "email" && result.threadId) {
      const [taken] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.projectId, conversation.projectId),
            eq(conversations.channel, "email"),
            eq(conversations.externalThreadId, result.threadId),
          ),
        );
      if (!taken) {
        await tx
          .update(conversations)
          .set({ externalThreadId: result.threadId })
          .where(eq(conversations.id, conversationId));
      }
    }
    if (conversation?.contactId) {
      await tx
        .update(contacts)
        .set({ status: "contacted" })
        .where(and(eq(contacts.id, conversation.contactId), eq(contacts.status, "new")));
    }
  });
}
