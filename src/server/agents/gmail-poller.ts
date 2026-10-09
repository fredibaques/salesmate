import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { openConnection, type ConnectorDeps } from "../connectors/service";
import type { Db } from "../db/client";
import {
  connections,
  contacts,
  conversations,
  identities,
  inboundEvents,
  messages,
  projectConnections,
  projectIdentities,
} from "../db/schema";
import { withTenant } from "../db/tenant";
import { stripQuotedReply } from "./leads";

/**
 * Pulls new inbox messages from the mailboxes assigned to a project that
 * granted read access:
 * - a mailbox an agent was told to read queues every new message as an
 *   inbound event (a lead for the inbound agent);
 * - any of them also catches replies to threads we started or answered
 *   (a prospecting first email, a reply from the inbox): those go straight
 *   into their conversation, so they show even without an inbound agent.
 * Messages already queued are skipped (unique external id).
 */
export const INBOX_QUERY =
  "in:inbox newer_than:2d -from:me -category:promotions -category:social -category:forums";

/** Email conversations with a Gmail thread, recent enough to expect a reply. */
const THREAD_DAYS = 90;

export async function pollMailboxes(
  deps: { db: Db; connectors?: Omit<ConnectorDeps, "db"> },
  orgId: string,
  now = new Date(),
): Promise<{ queued: number; replies: number; errors: string[] }> {
  const tenant = { orgId };
  const { mailboxes, threads } = await withTenant(deps.db, tenant, async (tx) => {
    const rows = await tx
      .select({ identity: identities, connection: connections })
      .from(identities)
      .innerJoin(connections, eq(connections.id, identities.connectionId))
      .where(and(eq(identities.kind, "email"), eq(connections.status, "active")));
    const readable = rows.filter((r) => r.connection.readScopes.includes("email"));
    if (readable.length === 0) return { mailboxes: [], threads: [] };
    const links = await tx
      .select()
      .from(projectIdentities)
      .where(
        inArray(
          projectIdentities.identityId,
          readable.map((r) => r.identity.id),
        ),
      );
    // Mailboxes an agent was told to read: their project link carries the read capability.
    const readers = await tx
      .select({ projectId: projectConnections.projectId, connectionId: projectConnections.connectionId })
      .from(projectConnections)
      .where(sql`'email.list_messages' = any(${projectConnections.capabilities})`);
    const mailboxes = readable.flatMap((r) => {
      const linked = links.filter((l) => l.identityId === r.identity.id);
      if (!linked.length) return [];
      const reading = linked.filter((l) =>
        readers.some((x) => x.projectId === l.projectId && x.connectionId === r.connection.id),
      );
      // A mailbox shared by several projects feeds its default project.
      const project = reading.find((l) => l.isDefault) ?? reading[0] ?? null;
      return [{ ...r, projectId: project?.projectId ?? null }];
    });
    const threads = await tx
      .select({
        id: conversations.id,
        projectId: conversations.projectId,
        contactId: conversations.contactId,
        status: conversations.status,
        threadId: conversations.externalThreadId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.channel, "email"),
          isNotNull(conversations.externalThreadId),
          gte(conversations.updatedAt, new Date(now.getTime() - THREAD_DAYS * 86_400_000)),
        ),
      );
    return { mailboxes, threads };
  });
  const byThread = new Map(threads.map((t) => [t.threadId!, t]));
  let queued = 0;
  let replies = 0;
  const errors: string[] = [];
  for (const { identity, connection, projectId } of mailboxes) {
    try {
      const { client } = await openConnection({ db: deps.db, ...deps.connectors }, tenant, connection.id);
      if (!client["email.list_messages"] || !client["email.get_message"]) continue;
      const all = await client["email.list_messages"]({ query: INBOX_QUERY, maxResults: 25 });
      // A mailbox nobody reads for leads only brings replies to our threads.
      const listed = projectId ? all : all.filter((m) => byThread.has(m.threadId));
      if (listed.length === 0) continue;
      const known = new Set(
        (
          await withTenant(deps.db, tenant, (tx) =>
            tx
              .select({ externalId: inboundEvents.externalId })
              .from(inboundEvents)
              .where(
                and(
                  eq(inboundEvents.source, "gmail"),
                  inArray(
                    inboundEvents.externalId,
                    listed.map((m) => m.id),
                  ),
                ),
              ),
          )
        ).map((r) => r.externalId),
      );
      for (const { id } of listed) {
        if (known.has(id)) continue;
        const message = await client["email.get_message"]({ id });
        if (message.from.email === identity.address.toLowerCase()) continue;
        // Never answer mail that arrived before the mailbox was connected.
        const received = message.date ? new Date(message.date) : null;
        if (received && !Number.isNaN(received.getTime()) && received < connection.createdAt) continue;
        const thread = byThread.get(message.threadId);
        const inserted = await withTenant(deps.db, tenant, async (tx) => {
          if (thread) {
            // A reply in one of our threads: into its conversation, whoever handles it.
            const added = await tx
              .insert(messages)
              .values({
                orgId,
                conversationId: thread.id,
                direction: "inbound",
                channel: "email",
                externalId: message.messageId,
                fromAddress: message.from.email,
                toAddresses: message.to,
                subject: message.subject,
                body: stripQuotedReply(message.text) || message.subject || "(sin texto)",
                sentAt: received && !Number.isNaN(received.getTime()) ? received : now,
              })
              .onConflictDoNothing()
              .returning({ id: messages.id });
            if (added.length) {
              replies++;
              await tx
                .update(conversations)
                .set({
                  status: thread.status === "handed_off" ? "handed_off" : "waiting_us",
                  lastMessageAt: now,
                  updatedAt: now,
                })
                .where(eq(conversations.id, thread.id));
              if (thread.contactId) {
                await tx
                  .update(contacts)
                  .set({ status: "engaged", updatedAt: now })
                  .where(
                    and(eq(contacts.id, thread.contactId), inArray(contacts.status, ["new", "contacted"])),
                  );
              }
            }
          }
          // The inbound agent of the thread's project (or the mailbox's) may answer it.
          return tx
            .insert(inboundEvents)
            .values({
              orgId,
              projectId: thread?.projectId ?? projectId,
              connectionId: connection.id,
              source: "gmail",
              eventType: "email.received",
              externalId: id,
              payload: { ...message, mailbox: identity.address },
            })
            .onConflictDoNothing()
            .returning({ id: inboundEvents.id });
        });
        queued += inserted.length;
      }
    } catch (err) {
      errors.push(`${identity.address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { queued, replies, errors };
}
