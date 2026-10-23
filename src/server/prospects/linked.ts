import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { linkColumn, stageColumn, type BaseColumn } from "@/lib/prospect-columns";
import type { Db } from "../db/client";
import { prospectLinkSearches, prospects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { baseInfo } from "./service";

/**
 * Agents that fill a table with a relation (people of companies) go through
 * the rows of the linked table one by one: each run takes the next few
 * companies nobody has looked into yet for this table, and the agent links
 * every person it saves to the company it found them in.
 */

/** Companies (rows of the linked table) a run looks into. */
export const LINKED_PER_RUN = 5;

export type LinkedRow = {
  id: string;
  name: string;
  website: string | null;
  /** Values of the linked table's columns, by name, for context. */
  known: string;
};

/** Rows of the linked table that are still to be looked into, and how many there are. */
export async function linkedRowsToSearch(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  base: { id: string; columns: BaseColumn[] },
  options: { stages?: string[]; limit?: number } = {},
): Promise<{ table: { id: string; name: string }; rows: LinkedRow[]; left: number } | null> {
  const link = linkColumn(base.columns);
  if (!link?.linkBaseId) return null;
  const target = await baseInfo(db, tenant, link.linkBaseId).catch(() => null);
  if (!target) return null;
  const stage = stageColumn(target.columns);
  const stages = stage && options.stages?.length ? options.stages : null;
  const where = and(
    eq(prospects.baseId, target.id),
    ne(prospects.status, "discarded"),
    // Not looked into for this table yet, and with nobody in it already (found or typed before).
    sql`not exists (select 1 from ${prospectLinkSearches} where ${prospectLinkSearches.baseId} = ${base.id} and ${prospectLinkSearches.rowId} = ${prospects.id})`,
    sql`not exists (select 1 from prospects child where child.parent_id = ${prospects.id} and child.base_id = ${base.id})`,
    stages && stage ? inArray(sql`${prospects.data} ->> ${stage.id}`, stages) : undefined,
  );
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select()
      .from(prospects)
      .where(where)
      .orderBy(sql`${prospects.fitScore} desc nulls last`, asc(prospects.seq))
      .limit(options.limit ?? LINKED_PER_RUN);
    const [{ left }] = await tx.select({ left: count() }).from(prospects).where(where);
    const byId = new Map(target.columns.map((c) => [c.id, c]));
    return {
      table: { id: target.id, name: target.name },
      left: Number(left),
      rows: rows.map((r) => ({
        id: r.id,
        name: r.personName || r.companyName,
        website: r.website,
        known: Object.entries(r.data)
          .filter(([id, v]) => byId.has(id) && v !== null && typeof v !== "object")
          .slice(0, 8)
          .map(([id, v]) => `${byId.get(id)!.name}: ${String(v)}`)
          .join("; "),
      })),
    };
  });
}

/** Marks rows of the linked table as looked into for this table, with how many it found in each. */
export async function recordLinkedSearches(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  input: { baseId: string; runId?: string; rows: { id: string; found: number }[] },
) {
  if (input.rows.length === 0) return;
  await withTenant(db, tenant, (tx) =>
    tx
      .insert(prospectLinkSearches)
      .values(
        input.rows.map((r) => ({
          orgId: tenant.orgId,
          baseId: input.baseId,
          rowId: r.id,
          found: r.found,
          runId: input.runId,
        })),
      )
      .onConflictDoUpdate({
        target: [prospectLinkSearches.baseId, prospectLinkSearches.rowId],
        set: {
          found: sql`${prospectLinkSearches.found} + excluded.found`,
          runId: sql`excluded.run_id`,
          searchedAt: sql`now()`,
        },
      }),
  );
}
