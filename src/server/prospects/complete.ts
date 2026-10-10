import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { checkCell, isPendingCell, type BaseColumn } from "@/lib/prospect-columns";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { prospects, type CellMeta } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { agentColumns } from "./agent-schema";
import { baseInfo, columnFor, sourceUrl } from "./service";

/**
 * Completing a base: the agent fills the empty cells of rows that already
 * exist. It never changes a value that is there, and never a cell a person
 * wrote (those are locked); what it looked for and didn't find is marked so
 * the next run doesn't look again.
 */

/** No value, nobody wrote it and the agent hasn't looked for it in vain: SQL for one column. */
function pendingSql(id: string): SQL {
  return sql`(not (${prospects.data} ? ${id}) and not (${prospects.cellMeta} ? ${id}))`;
}

/** Cells left to fill in a base, in the rows still in play (not discarded). */
export async function countPendingCells(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  /** Only these rows (e.g. those a run is working on). */
  rowIds?: string[],
): Promise<number> {
  const base = await baseInfo(db, tenant, baseId);
  const columns = agentColumns(base.columns);
  if (columns.length === 0) return 0;
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        n: sql<number>`coalesce(sum(${sql.join(
          columns.map((c) => sql`(${pendingSql(c.id)})::int`),
          sql` + `,
        )}), 0)`,
      })
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, baseId),
          ne(prospects.status, "discarded"),
          rowIds ? inArray(prospects.id, rowIds.length ? rowIds : [""]) : undefined,
        ),
      ),
  );
  return Number(row?.n ?? 0);
}

export type RowToComplete = {
  id: string;
  companyName: string;
  personName: string | null;
  website: string | null;
  /** Values already there, for context. */
  known: Record<string, unknown>;
  /** Ids of the columns to fill. */
  columns: string[];
};

/**
 * The rows to complete in this run, best fit first, until they add up to
 * `limit` cells. With `rowIds` (a person asked for those rows), cells the
 * agent didn't find before are looked for again.
 */
export async function rowsToComplete(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  options: { limit: number; rowIds?: string[] },
): Promise<{ rows: RowToComplete[]; cells: number }> {
  const base = await baseInfo(db, tenant, baseId);
  const columns = agentColumns(base.columns);
  if (columns.length === 0) return { rows: [], cells: 0 };
  const retry = Boolean(options.rowIds?.length);
  // A cell is open if it's empty and not locked by a person; on a retry, «not found» counts too.
  const open = (c: BaseColumn, data: Record<string, unknown>, meta: CellMeta | undefined) =>
    retry
      ? (data[c.id] === undefined || data[c.id] === null) && meta?.by !== "user"
      : isPendingCell(c, data[c.id], meta);
  const candidates = await withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, baseId),
          ne(prospects.status, "discarded"),
          retry ? inArray(prospects.id, options.rowIds!) : or(...columns.map((c) => pendingSql(c.id))),
        ),
      )
      .orderBy(sql`${prospects.fitScore} desc nulls last`, asc(prospects.createdAt), desc(prospects.id))
      .limit(Math.max(1, options.limit)),
  );
  const rows: RowToComplete[] = [];
  let cells = 0;
  for (const p of candidates) {
    if (cells >= options.limit) break;
    const pending = columns.filter((c) => open(c, p.data, p.cellMeta[c.id])).map((c) => c.id);
    if (pending.length === 0) continue;
    rows.push({
      id: p.id,
      companyName: p.companyName,
      personName: p.personName,
      website: p.website,
      known: p.data,
      columns: pending,
    });
    cells += pending.length;
  }
  return { rows, cells };
}

/** What the agent sends for one row it completed. */
export const completionInput = z.object({
  id: z.string(),
  /** Values by column id (or name). */
  fields: z.record(z.string(), z.unknown()).default({}),
  /** Columns it looked for and couldn't find published. */
  notFound: z.array(z.string()).default([]),
  /** The page each value comes from, by column id (or name). */
  sources: z.record(z.string(), z.string()).default({}),
});
export type CompletionInput = z.input<typeof completionInput>;

export type CompletionResult = {
  filled: number;
  notFound: number;
  /** Cells left as they were (they had a value, or a person wrote them). */
  kept: string[];
  fieldErrors: string[];
  unknownRows: string[];
};

/** Fills empty cells of existing rows. Values already there and cells written by people stay. */
export async function completeProspects(
  db: Db,
  tenant: TenantContext,
  input: { baseId: string; runId?: string; items: CompletionInput[] },
): Promise<CompletionResult> {
  const base = await baseInfo(db, tenant, input.baseId);
  const result: CompletionResult = { filled: 0, notFound: 0, kept: [], fieldErrors: [], unknownRows: [] };
  const items = input.items.flatMap((raw) => {
    const parsed = completionInput.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  if (items.length === 0) return result;
  const at = new Date().toISOString();
  const agentMeta: CellMeta = { by: "agent", at, runId: input.runId };

  await withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select()
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, base.id),
          inArray(
            prospects.id,
            items.map((i) => i.id).filter((id) => z.string().uuid().safeParse(id).success),
          ),
        ),
      )
      .for("update");
    for (const item of items) {
      const row = rows.find((r) => r.id === item.id);
      if (!row) {
        result.unknownRows.push(item.id);
        continue;
      }
      const label = row.personName ?? row.companyName;
      const data = { ...row.data };
      const cellMeta = { ...row.cellMeta };
      let changed = false;
      const writable = (column: BaseColumn) => {
        if (column.filledBy === "person" || cellMeta[column.id]?.by === "user") return false;
        return data[column.id] === undefined || data[column.id] === null;
      };
      for (const [key, raw] of Object.entries(item.fields)) {
        const column = columnFor(base.columns, key);
        if (!column) {
          result.fieldErrors.push(`${label} · ${key}: no es una columna de la base`);
          continue;
        }
        if (!writable(column)) {
          result.kept.push(`${label} · ${column.name}`);
          continue;
        }
        const checked = checkCell(column, raw);
        if (!checked.ok) {
          result.fieldErrors.push(`${label} · ${checked.error}`);
          continue;
        }
        if (checked.value === null) continue;
        const source = sourceUrl(item.sources[key] ?? item.sources[column.id]);
        data[column.id] = checked.value;
        cellMeta[column.id] = source ? { ...agentMeta, source } : agentMeta;
        result.filled++;
        changed = true;
      }
      for (const key of item.notFound) {
        const column = columnFor(base.columns, key);
        if (!column || !writable(column) || data[column.id] !== undefined) continue;
        cellMeta[column.id] = { ...agentMeta, notFound: true };
        result.notFound++;
        changed = true;
      }
      if (changed) {
        await tx.update(prospects).set({ data, cellMeta }).where(eq(prospects.id, row.id));
      }
    }
    if (result.filled + result.notFound > 0) {
      await audit(tx, tenant, {
        event: "prospects.completed",
        projectId: base.projectId,
        entityType: "prospect_base",
        entityId: base.id,
        data: { filled: result.filled, notFound: result.notFound },
      });
    }
  });
  return result;
}

/**
 * What completing a row brought besides its cells: the website found for a
 * row without one (only if it still has none) and what it cost.
 */
export async function recordRowWork(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  input: { baseId: string; rowId: string; website?: string | null; costUsd: number },
) {
  await withTenant(db, tenant, (tx) =>
    tx
      .update(prospects)
      .set({
        costUsd: sql`${prospects.costUsd} + ${input.costUsd}`,
        ...(input.website ? { website: sql`coalesce(${prospects.website}, ${input.website})` } : {}),
      })
      .where(and(eq(prospects.id, input.rowId), eq(prospects.baseId, input.baseId))),
  );
}

/** What completing a table's rows has cost, and over how many rows. */
export async function completionCost(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
): Promise<{ usd: number; rows: number }> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        usd: sql<number>`coalesce(sum(${prospects.costUsd}), 0)`,
        rows: sql<number>`count(*) filter (where ${prospects.costUsd} > 0)`,
      })
      .from(prospects)
      .where(eq(prospects.baseId, baseId)),
  );
  return { usd: Number(row?.usd ?? 0), rows: Number(row?.rows ?? 0) };
}
