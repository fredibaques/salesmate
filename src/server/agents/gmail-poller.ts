import { and, eq, inArray, sql } from "drizzle-orm";
import { openConnection, type ConnectorDeps } from "../connectors/service";
import type { Db } from "../db/client";
import { connections, identities, inboundEvents, projectConnections, projectIdentities } from "../db/schema";
import { withTenant } from "../db/tenant";

/**
 * Pulls new inbox messages from every mailbox that (a) granted read access
 * and (b) is assigned to a project, and queues them as inbound events.
 * Messages already queued are skipped (unique external id).
 */
export const INBOX_QUERY =
  "in:inbox newer_than:2d -from:me -category:promotions -category:social -category:forums";

export async function pollMailboxes(
  deps: { db: Db; connectors?: Omit<ConnectorDeps, "db"> },
  orgId: string,
): Promise<{ queued: number; errors: string[] }> {
  const tenant = { orgId };
  const mailboxes = await withTenant(deps.db, tenant, async (tx) => {
    const rows = await tx
      .select({ identity: identities, connection: connections })
      .from(identities)
      .innerJoin(connections, eq(connections.id, identities.connectionId))
      .where(and(eq(identities.kind, "email"), eq(connections.status, "active")));
    const readable = rows.filter((r) => r.connection.readScopes.includes("email"));
    if (readable.length === 0) return [];
    const links = await tx
      .select()
      .from(projectIdentities)
      .where(
        inArray(
          projectIdentities.identityId,
          readable.map((r) => r.identity.id),
        ),
      );
    // Only mailboxes an agent was told to read: their project link carries the read capability.
    const readers = await tx
      .select({ projectId: projectConnections.projectId, connectionId: projectConnections.connectionId })
      .from(projectConnections)
      .where(sql`'email.list_messages' = any(${projectConnections.capabilities})`);
    return readable.flatMap((r) => {
      const assigned = links.filter(
        (l) =>
          l.identityId === r.identity.id &&
          readers.some((x) => x.projectId === l.projectId && x.connectionId === r.connection.id),
      );
      // A mailbox shared by several projects feeds its default project.
      const project = assigned.find((l) => l.isDefault) ?? assigned[0];
      return project ? [{ ...r, projectId: project.projectId }] : [];
    });
  });

  let queued = 0;
  const errors: string[] = [];
  for (const { identity, connection, projectId } of mailboxes) {
    try {
      const { client } = await openConnection({ db: deps.db, ...deps.connectors }, tenant, connection.id);
      if (!client["email.list_messages"] || !client["email.get_message"]) continue;
      const listed = await client["email.list_messages"]({ query: INBOX_QUERY, maxResults: 25 });
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
        const inserted = await withTenant(deps.db, tenant, (tx) =>
          tx
            .insert(inboundEvents)
            .values({
              orgId,
              projectId,
              connectionId: connection.id,
              source: "gmail",
              eventType: "email.received",
              externalId: id,
              payload: { ...message, mailbox: identity.address },
            })
            .onConflictDoNothing()
            .returning({ id: inboundEvents.id }),
        );
        queued += inserted.length;
      }
    } catch (err) {
      errors.push(`${identity.address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { queued, errors };
}
