import { randomBytes } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { actions, agentRuns, contacts, conversations, inboundEvents, messages, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";

export async function listConversations(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  filter: { status?: (typeof conversations.$inferSelect)["status"] } = {},
) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          eq(conversations.projectId, projectId),
          filter.status ? eq(conversations.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(200),
  );
}

export async function getConversation(db: Db, tenant: Pick<TenantContext, "orgId">, conversationId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, conversationId));
    if (!row) return null;
    const thread = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.sentAt));
    const ref = `conversation:${conversationId}`;
    const related = await tx
      .select()
      .from(actions)
      .where(eq(actions.projectId, row.conversation.projectId))
      .orderBy(desc(actions.createdAt))
      .limit(200);
    const relatedActions = related.filter((a) => a.context.subjectRef === ref);
    const runIds = new Set(relatedActions.map((a) => a.runId).filter(Boolean));
    const runs = await tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.projectId, row.conversation.projectId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(100);
    return {
      ...row,
      messages: thread,
      actions: relatedActions,
      runs: runs.filter((r) => runIds.has(r.id)),
    };
  });
}

export async function listRecentEvents(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.projectId, projectId))
      .orderBy(desc(inboundEvents.receivedAt))
      .limit(20),
  );
}

export async function listAgentRuns(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.projectId, projectId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(50),
  );
}

/** Creates or rotates the key web forms use to post leads to the project. */
export async function rotateFormKey(db: Db, tenant: TenantContext, projectId: string) {
  const key = randomBytes(18).toString("base64url");
  await withTenant(db, tenant, async (tx) => {
    await tx.update(projects).set({ inboundFormKey: key }).where(eq(projects.id, projectId));
    await audit(tx, tenant, {
      event: "project.form_key_rotated",
      projectId,
      entityType: "project",
      entityId: projectId,
    });
  });
  return key;
}

/** Queues a lead as if it came from the project's web form (for testing the agent). */
export async function queueTestLead(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  fields: Record<string, string>,
) {
  const [event] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(inboundEvents)
      .values({
        orgId: tenant.orgId,
        projectId,
        source: "form",
        eventType: "form.test",
        payload: { fields, test: true },
      })
      .returning(),
  );
  return event;
}
