import { auditLog } from "./db/schema";
import type { TenantContext, Tx } from "./db/tenant";

export type AuditEntry = {
  event: string;
  projectId?: string | null;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
};

/** Appends to the immutable audit log. Must run inside withTenant(). */
export async function audit(
  tx: Tx,
  ctx: Pick<TenantContext, "orgId" | "actorType" | "actorId">,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: ctx.orgId,
    projectId: entry.projectId ?? null,
    actorType: ctx.actorType,
    actorId: ctx.actorId,
    event: entry.event,
    entityType: entry.entityType,
    entityId: entry.entityId,
    data: entry.data ?? {},
  });
}
