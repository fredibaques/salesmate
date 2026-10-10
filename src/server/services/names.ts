import type { Db } from "../db/client";
import { and, eq } from "drizzle-orm";
import {
  agentConfigs,
  contacts,
  conversations,
  knowledgeSources,
  projects,
  prospectBases,
  meetings,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";

/** Display names for breadcrumbs: one light query each, null when not found. */

export async function projectName(db: Db, tenant: Pick<TenantContext, "orgId">, id: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx.select({ name: projects.name }).from(projects).where(eq(projects.id, id)),
  );
  return rows[0]?.name ?? null;
}

export async function sourceName(db: Db, tenant: Pick<TenantContext, "orgId">, id: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx.select({ name: knowledgeSources.name }).from(knowledgeSources).where(eq(knowledgeSources.id, id)),
  );
  return rows[0]?.name ?? null;
}

export async function conversationName(db: Db, tenant: Pick<TenantContext, "orgId">, id: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({ first: contacts.firstName, last: contacts.lastName, email: contacts.email })
      .from(conversations)
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, id)),
  );
  const c = rows[0];
  if (!c) return null;
  return [c.first, c.last].filter(Boolean).join(" ") || c.email || "Contacto";
}

export async function meetingName(db: Db, tenant: Pick<TenantContext, "orgId">, id: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx.select({ title: meetings.title }).from(meetings).where(eq(meetings.id, id)),
  );
  return rows[0]?.title ?? null;
}

export async function baseName(db: Db, tenant: Pick<TenantContext, "orgId">, id: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx.select({ name: prospectBases.name }).from(prospectBases).where(eq(prospectBases.id, id)),
  );
  return rows[0]?.name ?? null;
}

/** An agent's kind and the name the user gave it (null = its template's); null when not found. */
export async function agentLabel(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  agentId: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) return null;
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({ name: agentConfigs.name, agentType: agentConfigs.agentType })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId))),
  );
  return rows[0] ?? null;
}
