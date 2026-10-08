import { sql } from "drizzle-orm";
import type { Db } from "./client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TenantContext = {
  orgId: string;
  /** Who is acting: a user id, an agent run id, "system"… (for audit). */
  actorType: "user" | "agent" | "system" | "mcp_client";
  actorId: string | null;
};

/**
 * Runs `fn` in a transaction where Row Level Security restricts every
 * domain table to `ctx.orgId`. All request-path data access must go through
 * this function.
 */
export async function withTenant<T>(
  db: Db,
  ctx: Pick<TenantContext, "orgId">,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!ctx.orgId) throw new Error("withTenant: orgId is required");
  return db.transaction(async (tx) => {
    // One round trip: the tenant and the restricted role (as `set local role`), for this transaction.
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('role', 'salesmate_app', true)`,
    );
    return fn(tx);
  });
}

/**
 * Runs `fn` without tenant restrictions. Only for narrow system paths that
 * must locate the organization first (e.g. a webhook addressed to a
 * connection id). Never pass user input straight into queries here.
 */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}
