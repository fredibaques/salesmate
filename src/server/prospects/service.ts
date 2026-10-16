import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { checkCell, formatCell, linkColumn, type BaseColumn, type RowKind } from "@/lib/prospect-columns";
import { listOf, rangeOf, type RowFilter } from "@/lib/table-filters";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { prospectBases, prospects, PROSPECT_STATUSES, type CellMeta } from "../db/schema";
import type { Tx } from "../db/tenant";
import { withTenant, type TenantContext } from "../db/tenant";
import { foldText } from "../knowledge/normalize";

/**
 * Prospects are the rows of a prospect base: companies (or people) that
 * match the ideal customer, with the values of the base's columns. Agents
 * add them run after run without duplicates; people review and export them.
 */

export type ProspectRow = typeof prospects.$inferSelect;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
type BaseInfo = {
  id: string;
  name: string;
  projectId: string | null;
  rowKind: RowKind;
  columns: BaseColumn[];
};

/** One row as an agent or a person sends it: the system fields plus the column values. */
export const prospectInput = z.object({
  /** Required in tables of companies; optional in tables of people. */
  companyName: z.string().trim().max(300).default(""),
  personName: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || undefined),
  website: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || undefined),
  fitScore: z.number().int().min(0).max(100).optional(),
  fitReason: z.string().trim().max(1000).optional(),
  sources: z.array(z.string().url()).max(10).default([]),
  /** Values by column id (or column name). */
  fields: z.record(z.string(), z.unknown()).default({}),
  /** The page each value comes from, by column id (or name). */
  fieldSources: z.record(z.string(), z.string()).default({}),
  /** The row of the linked table it belongs to (its company), in tables with a relation. */
  parentId: z.string().uuid().optional(),
});
export type ProspectInput = z.input<typeof prospectInput>;

/** «https://www.Example.com/contacto» → «example.com». */
export function normalizeDomain(website: string | undefined | null): string | null {
  if (!website) return null;
  const raw = website.trim().toLowerCase();
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

function foldName(name: string) {
  return foldText(name)
    .replace(/\b(s\.?l\.?u?|s\.?a\.?|sociedad limitada|sociedad anonima)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The same company found twice (same domain, or same name in the same city)
 * is one row. In bases of people: the same person in the same company.
 */
export function dedupeKey(
  p: { website?: string | null; companyName: string; personName?: string | null; city?: string | null },
  rowKind: RowKind = "company",
): string {
  const domain = normalizeDomain(p.website);
  if (rowKind === "person") {
    return `person:${foldName(p.personName ?? "")}|${domain ?? foldName(p.companyName)}`;
  }
  if (domain) return `web:${domain}`;
  return `name:${foldName(p.companyName)}|${foldText(p.city ?? "").trim()}`;
}

/** The column a key refers to: its id, or its name as people (and models) write it. */
export function columnFor(columns: BaseColumn[], key: string) {
  const folded = foldText(key).trim();
  return columns.find((c) => c.id === key) ?? columns.find((c) => foldText(c.name).trim() === folded);
}

/**
 * Checks the column values of one row. A value that doesn't fit its column
 * is left out (and reported) instead of dropping the whole row. The relation
 * column's value (the row it belongs to) comes back apart, as `parentId`.
 */
export function cellsFromFields(columns: BaseColumn[], fields: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  let parentId: string | undefined;
  for (const [key, raw] of Object.entries(fields)) {
    const column = columnFor(columns, key);
    if (!column) {
      errors.push(`${key}: no es una columna de la base`);
      continue;
    }
    const checked = checkCell(column, raw);
    if (!checked.ok) errors.push(checked.error);
    else if (column.type === "link") parentId = (checked.value as string | null) ?? undefined;
    else if (checked.value !== null) data[column.id] = checked.value;
  }
  return { data, errors, parentId };
}

/** How a row is called: the person, or the company. */
export const rowNameSql = (table: { personName: AnyColumn; companyName: AnyColumn }) =>
  sql<string>`coalesce(nullif(${table.personName}, ''), ${table.companyName})`;

/**
 * The name of the row each row belongs to (its company), for listing, sorting
 * and filtering. Spelled out: in a select list a column would lose its table.
 */
const parentNameSql = sql<
  string | null
>`(select coalesce(nullif(parent.person_name, ''), parent.company_name) from prospects parent where parent.id = "prospects"."parent_id")`;

/** Rows of a table by id, with their names: the rows others may point at. */
async function rowsOfBase(tx: Tx, baseId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await tx
    .select({ id: prospects.id, name: rowNameSql(prospects) })
    .from(prospects)
    .where(and(eq(prospects.baseId, baseId), inArray(prospects.id, ids)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Only web pages count as the source of a value. */
export function sourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

export function sourceUrlsFor(columns: BaseColumn[], raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const column = columnFor(columns, key);
    const url = sourceUrl(value);
    if (column && url) out[column.id] = url;
  }
  return out;
}

export async function baseInfo(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
): Promise<BaseInfo> {
  const [base] = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: prospectBases.id,
        name: prospectBases.name,
        projectId: prospectBases.projectId,
        rowKind: prospectBases.rowKind,
        columns: prospectBases.columns,
      })
      .from(prospectBases)
      .where(eq(prospectBases.id, baseId)),
  );
  if (!base) throw new Error("Base de prospectos no encontrada.");
  return base;
}

export async function saveProspects(
  db: Db,
  tenant: TenantContext,
  input: {
    baseId: string;
    agentConfigId?: string;
    runId?: string;
    items: ProspectInput[];
  },
): Promise<{ added: ProspectRow[]; duplicates: string[]; invalid: string[]; fieldErrors: string[] }> {
  const base = await baseInfo(db, tenant, input.baseId);
  const invalid: string[] = [];
  const fieldErrors: string[] = [];
  const now = new Date().toISOString();
  const meta: CellMeta =
    tenant.actorType === "agent"
      ? { by: "agent", at: now, runId: input.runId }
      : { by: "user", at: now, userId: tenant.actorId ?? undefined };

  // The rows of the linked table they belong to: only real rows of that table count.
  const link = linkColumn(base.columns);
  const wantedParents = link
    ? input.items.flatMap((raw) => {
        const own = (raw as { parentId?: unknown }).parentId;
        const fromFields = cellsFromFields(
          [link],
          (raw as { fields?: Record<string, unknown> }).fields ?? {},
        );
        const id = typeof own === "string" ? own : fromFields.parentId;
        return id && /^[0-9a-f-]{36}$/i.test(id) ? [id.toLowerCase()] : [];
      })
    : [];
  const parents = link
    ? await withTenant(db, tenant, (tx) => rowsOfBase(tx, link.linkBaseId!, [...new Set(wantedParents)]))
    : new Map<string, string>();

  const rows = input.items.flatMap((raw) => {
    const result = prospectInput.safeParse(raw);
    const named = raw as { companyName?: unknown; personName?: unknown };
    const label = String(
      (base.rowKind === "person" && named.personName) || (named.companyName ?? "(sin nombre)"),
    );
    const nameless =
      result.success && (base.rowKind === "person" ? !result.data.personName : !result.data.companyName);
    if (!result.success || nameless) {
      invalid.push(label);
      return [];
    }
    const { fields, fieldSources, parentId: ownParent, ...system } = result.data;
    const { data, errors, parentId: fieldParent } = cellsFromFields(base.columns, fields);
    const sources = sourceUrlsFor(base.columns, fieldSources);
    fieldErrors.push(...errors.map((e) => `${label} · ${e}`));
    const wanted = (ownParent ?? fieldParent)?.toLowerCase();
    const parentId = wanted && parents.has(wanted) ? wanted : null;
    if (link && wanted && !parentId) {
      fieldErrors.push(`${label} · ${link.name}: no es una fila de la tabla relacionada`);
    }
    // A person linked to a company works there, unless said otherwise.
    if (parentId && !system.companyName) system.companyName = parents.get(parentId) ?? "";
    const key = dedupeKey(
      { ...system, city: typeof data.city === "string" ? data.city : undefined },
      base.rowKind,
    );
    const cellMeta: Record<string, CellMeta> = Object.fromEntries(
      Object.keys(data).map((id) => [id, sources[id] ? { ...meta, source: sources[id] } : meta]),
    );
    if (parentId && link) cellMeta[link.id] = meta;
    return [{ key, row: { ...system, parentId, data, cellMeta } }];
  });
  const unique = new Map(rows.map((r) => [r.key, r.row]));
  if (unique.size === 0) return { added: [], duplicates: [], invalid, fieldErrors };

  return withTenant(db, tenant, async (tx) => {
    const added = await tx
      .insert(prospects)
      .values(
        [...unique].map(([key, p]) => ({
          orgId: tenant.orgId,
          projectId: base.projectId,
          baseId: base.id,
          agentConfigId: input.agentConfigId,
          runId: input.runId,
          dedupeKey: key,
          ...p,
        })),
      )
      .onConflictDoNothing({ target: [prospects.baseId, prospects.dedupeKey] })
      .returning();
    const addedKeys = new Set(added.map((a) => a.dedupeKey));
    const duplicates = [...unique]
      .filter(([key]) => !addedKeys.has(key))
      .map(([, p]) => p.personName || p.companyName);
    if (added.length > 0) {
      await audit(tx, tenant, {
        event: "prospects.added",
        projectId: base.projectId,
        entityType: "prospect_base",
        entityId: base.id,
        data: { count: added.length, names: added.slice(0, 20).map((a) => a.personName ?? a.companyName) },
      });
    }
    return { added, duplicates, invalid, fieldErrors };
  });
}

/** One row of a base, or null. */
export async function getProspect(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  id: string,
): Promise<ProspectRow | null> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(prospects)
      .where(and(eq(prospects.baseId, baseId), eq(prospects.id, id))),
  );
  return row ?? null;
}

/** A row as a person writes it in the row panel. Fields not sent stay as they are. */
export type RowEdit = {
  companyName: string;
  personName?: string;
  website?: string;
  fitScore?: number | null;
  fitReason?: string;
  /** Values by column id; an empty value clears the cell. The relation column's is the row it points at. */
  fields: Record<string, unknown>;
};

const DUPLICATE_ROW = "Ya hay otra fila igual en esta base (misma web, o mismo nombre y ciudad).";

/** Checks a person's edit: every value must fit its column (nothing is dropped silently). */
function checkEdit(base: BaseInfo, edit: RowEdit) {
  const companyName = edit.companyName.trim();
  const personName = edit.personName?.trim() || null;
  if (base.rowKind === "person" && !personName) throw new Error("Falta el nombre de la persona.");
  if (base.rowKind === "company" && !companyName) throw new Error("Falta el nombre de la empresa.");
  const fitScore = edit.fitScore ?? null;
  if (fitScore !== null && (!Number.isInteger(fitScore) || fitScore < 0 || fitScore > 100)) {
    throw new Error("El encaje debe ser un número de 0 a 100.");
  }
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  /** undefined: the relation isn't touched; null: it is cleared. */
  let parentId: string | null | undefined;
  for (const [id, raw] of Object.entries(edit.fields)) {
    const column = base.columns.find((c) => c.id === id);
    if (!column) continue;
    const checked = checkCell(column, raw);
    if (!checked.ok) errors.push(checked.error);
    else if (column.type === "link") parentId = checked.value as string | null;
    else values[id] = checked.value;
  }
  if (errors.length) throw new Error(errors.join(" · "));
  return {
    companyName,
    personName,
    website: edit.website?.trim() || null,
    fitScore,
    fitReason: edit.fitReason?.trim() || null,
    values,
    parentId,
  };
}

/** A row a person adds by hand. */
export async function addProspectRow(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  edit: RowEdit,
): Promise<ProspectRow> {
  const base = await baseInfo(db, tenant, baseId);
  const row = checkEdit(base, edit);
  const data = Object.fromEntries(Object.entries(row.values).filter(([, v]) => v !== null));
  const result = await saveProspects(db, tenant, {
    baseId,
    items: [
      {
        companyName: row.companyName,
        personName: row.personName ?? undefined,
        website: row.website ?? undefined,
        fitScore: row.fitScore ?? undefined,
        fitReason: row.fitReason ?? undefined,
        fields: data,
        parentId: row.parentId ?? undefined,
      },
    ],
  });
  if (result.duplicates.length) throw new Error(DUPLICATE_ROW);
  const [added] = result.added;
  if (!added) throw new Error(result.fieldErrors[0] ?? "No se ha podido añadir la fila.");
  return added;
}

/** The keys of a row's fixed fields that people can type in the table. */
const TYPED_FIELDS = ["company", "person", "web", "fit"] as const;

/**
 * A row as typed in the table (a new row, or one cell): the fixed fields by
 * their key (company, person, web, fit) and the columns by id.
 */
export function rowEditFromValues(values: Record<string, unknown>, current?: ProspectRow): RowEdit {
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const has = (k: string) => Object.hasOwn(values, k);
  const fit = has("fit") ? text(values.fit).trim() : undefined;
  return {
    companyName: has("company") ? text(values.company) : (current?.companyName ?? ""),
    personName: has("person") ? text(values.person) : (current?.personName ?? undefined),
    website: has("web") ? text(values.web) : (current?.website ?? undefined),
    fitScore: fit === undefined ? (current?.fitScore ?? null) : fit === "" ? null : Number(fit),
    fitReason: current?.fitReason ?? undefined,
    fields: Object.fromEntries(
      Object.entries(values).filter(([k]) => !(TYPED_FIELDS as readonly string[]).includes(k)),
    ),
  };
}

/** One cell typed in the table: a fixed field (company, person, web, fit) or a column. */
export async function setProspectCell(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  rowId: string,
  key: string,
  value: unknown,
) {
  const row = await getProspect(db, tenant, baseId, rowId);
  if (!row) throw new Error("Esa fila ya no existe.");
  return updateProspectRow(db, tenant, baseId, rowId, rowEditFromValues({ [key]: value }, row));
}

/**
 * Saves a person's changes to a row. The cells that change are marked as
 * written by that person, so the panel can say who wrote each value.
 */
export async function updateProspectRow(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  id: string,
  edit: RowEdit,
): Promise<{ changed: number }> {
  const base = await baseInfo(db, tenant, baseId);
  const next = checkEdit(base, edit);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .select()
      .from(prospects)
      .where(and(eq(prospects.baseId, baseId), eq(prospects.id, id)))
      .for("update");
    if (!row) throw new Error("Esa fila ya no existe.");
    const data = { ...row.data };
    const cellMeta = { ...row.cellMeta };
    const meta: CellMeta = { by: "user", at: new Date().toISOString(), userId: tenant.actorId ?? undefined };
    let changed = 0;
    for (const [key, value] of Object.entries(next.values)) {
      if (JSON.stringify(value) === JSON.stringify(data[key] ?? null)) continue;
      changed++;
      if (value === null) {
        delete data[key];
        delete cellMeta[key];
      } else {
        data[key] = value;
        cellMeta[key] = meta;
      }
    }
    // The row it belongs to: a row of the linked table, or none.
    const link = linkColumn(base.columns);
    let parentId = row.parentId;
    if (link && next.parentId !== undefined && next.parentId !== row.parentId) {
      const parents = next.parentId ? await rowsOfBase(tx, link.linkBaseId!, [next.parentId]) : new Map();
      if (next.parentId && !parents.has(next.parentId)) {
        throw new Error(`${link.name}: esa fila ya no está en la tabla relacionada.`);
      }
      parentId = next.parentId;
      changed++;
      if (parentId) cellMeta[link.id] = meta;
      else delete cellMeta[link.id];
      // A person linked to a company works there, unless the row says otherwise.
      if (parentId && !next.companyName) next.companyName = parents.get(parentId) ?? "";
    }
    const system = {
      companyName: next.companyName,
      personName: next.personName,
      website: next.website,
      fitScore: next.fitScore,
      fitReason: next.fitReason,
    };
    changed += (Object.keys(system) as (keyof typeof system)[]).filter((k) => system[k] !== row[k]).length;
    if (changed === 0) return { changed };
    const key = dedupeKey(
      { ...system, city: typeof data.city === "string" ? data.city : undefined },
      base.rowKind,
    );
    if (key !== row.dedupeKey) {
      const [clash] = await tx
        .select({ id: prospects.id })
        .from(prospects)
        .where(and(eq(prospects.baseId, baseId), eq(prospects.dedupeKey, key)));
      if (clash) throw new Error(DUPLICATE_ROW);
    }
    await tx
      .update(prospects)
      .set({
        ...system,
        parentId,
        data,
        cellMeta,
        dedupeKey: key,
        // A person who sets the fit by hand overrides the checks it came from.
        ...(system.fitScore !== row.fitScore ? { fitChecks: null } : {}),
      })
      .where(eq(prospects.id, id));
    await audit(tx, tenant, {
      event: "prospect.edited",
      projectId: base.projectId,
      entityType: "prospect",
      entityId: id,
      data: { base: baseId, changed, name: next.personName || next.companyName },
    });
    return { changed };
  });
}

/** Which of these the base already has (by domain, or name and city). */
export async function knownProspects(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  candidates: { website?: string; companyName: string; personName?: string; city?: string }[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const base = await baseInfo(db, tenant, baseId);
  const keys = candidates.map((c) => dedupeKey(c, base.rowKind));
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({ key: prospects.dedupeKey })
      .from(prospects)
      .where(and(eq(prospects.baseId, baseId), inArray(prospects.dedupeKey, keys))),
  );
  const found = new Set(rows.map((r) => r.key));
  return candidates.filter((_, i) => found.has(keys[i])).map((c) => c.personName ?? c.companyName);
}

/** The most recent rows of a base, so a new run looks for different ones. */
export async function recentProspectNames(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  limit = 300,
): Promise<string[]> {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        company: prospects.companyName,
        person: prospects.personName,
        website: prospects.website,
        data: prospects.data,
      })
      .from(prospects)
      .where(eq(prospects.baseId, baseId))
      .orderBy(desc(prospects.createdAt))
      .limit(limit),
  );
  return rows.map((r) =>
    [r.person, r.company, typeof r.data.city === "string" ? r.data.city : null, normalizeDomain(r.website)]
      .filter(Boolean)
      .join(" · "),
  );
}

/** System columns that can sort the table, besides the base's own columns. */
const SYSTEM_SORTS: Record<string, AnyColumn> = {
  id: prospects.seq,
  name: prospects.companyName,
  person: prospects.personName,
  web: prospects.website,
  fit: prospects.fitScore,
  status: prospects.status,
  created: prospects.createdAt,
};

/**
 * A field's value as text in SQL, for filtering and grouping: a fixed field
 * or a column (the relation column reads as the name of the row it points at).
 */
function fieldText(key: string, linkId?: string): SQL {
  if (key === linkId) return parentNameSql;
  switch (key) {
    case "company":
      return sql`${prospects.companyName}`;
    case "person":
      return sql`${prospects.personName}`;
    case "web":
      return sql`${prospects.website}`;
    case "status":
      // «Nueva» covers the old «accepted» too.
      return sql`(case when ${prospects.status} = 'accepted' then 'new' else ${prospects.status} end)`;
    case "created":
      return sql`to_char(${prospects.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    default:
      return sql`(${prospects.data} ->> ${key})`;
  }
}

/** A number in text, or null when it isn't one. */
const asNumber = (text: SQL) =>
  sql`(case when ${text} ~ '^-?[0-9]+([.][0-9]+)?$' then (${text})::numeric end)`;

/** The SQL condition of one filter. */
function filterCondition(f: RowFilter, type: string | undefined, linkId?: string): SQL {
  const text = fieldText(f.key, linkId);
  const value = f.value ?? "";
  const numeric = type === "number" || type === "score";
  const empty = sql`(${text} is null or ${text} = '' or ${text} = '[]')`;
  switch (f.op) {
    case "contains":
      return sql`${text} ilike ${`%${value}%`}`;
    case "is":
      return numeric ? sql`${asNumber(text)} = ${Number(value)}` : sql`lower(${text}) = lower(${value})`;
    case "isNot":
      return sql`coalesce(lower(${text}), '') <> lower(${value})`;
    case "has":
      return sql`jsonb_exists(coalesce(${prospects.data} -> ${f.key}, '[]'::jsonb), ${value})`;
    case "in": {
      const values = listOf(value);
      if (type === "multi") {
        const any = sql.join(
          values.map((v) => sql`${v}`),
          sql`, `,
        );
        return sql`jsonb_exists_any(coalesce(${prospects.data} -> ${f.key}, '[]'::jsonb), array[${any}]::text[])`;
      }
      return sql`lower(${text}) in (${sql.join(
        values.map((v) => sql`lower(${v})`),
        sql`, `,
      )})`;
    }
    case "between": {
      const { from, to } = rangeOf(value);
      // A date range compares the day, whatever time a value carries.
      const at = numeric ? asNumber(text) : sql`left(${text}, 10)`;
      const end = (v: string) => (numeric ? sql`${Number(v)}` : sql`${v}`);
      return sql.join(
        [
          ...(from.trim() ? [sql`${at} >= ${end(from)}`] : []),
          ...(to.trim() ? [sql`${at} <= ${end(to)}`] : []),
          sql`true`,
        ],
        sql` and `,
      );
    }
    case "gt":
      return sql`${asNumber(text)} > ${Number(value)}`;
    case "lt":
      return sql`${asNumber(text)} < ${Number(value)}`;
    case "before":
      return sql`${text} < ${value}`;
    case "after":
      return sql`${text} > ${value}`;
    case "yes":
      return sql`${text} = 'true'`;
    case "no":
      return sql`coalesce(${text}, 'false') <> 'true'`;
    case "empty":
      return empty;
    case "notEmpty":
      return sql`not ${empty}`;
  }
}

export type ListOptions = {
  status?: ProspectStatus;
  q?: string;
  /** Conditions on any field, all of them must hold. */
  filters?: RowFilter[];
  /** A field to group the rows by: they come ordered by it, with the count of each value. */
  group?: string;
  /** A system sort key (name, web, fit, status, created) or a column id. */
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export async function listProspects(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  options: ListOptions = {},
) {
  const base = await baseInfo(db, tenant, baseId);
  const linkId = linkColumn(base.columns)?.id;
  return withTenant(db, tenant, async (tx) => {
    const search = options.q?.trim();
    const where = and(
      eq(prospects.baseId, baseId),
      options.status
        ? options.status === "new"
          ? inArray(prospects.status, ["new", "accepted"])
          : eq(prospects.status, options.status)
        : undefined,
      search
        ? or(ilike(prospects.companyName, `%${search}%`), ilike(prospects.personName, `%${search}%`))
        : undefined,
      ...(options.filters ?? []).map((f) =>
        filterCondition(f, base.columns.find((c) => c.id === f.key)?.type, linkId),
      ),
    );
    const column = base.columns.find((c) => c.id === options.sort);
    const sortExpr = column
      ? column.id === linkId
        ? parentNameSql
        : sql`${prospects.data} -> ${column.id}`
      : (SYSTEM_SORTS[options.sort ?? ""] ?? prospects.createdAt);
    const direction = options.dir ?? (options.sort ? "asc" : "desc");
    const groupable =
      options.group &&
      (["company", "person", "web", "status", "created"].includes(options.group) ||
        base.columns.some((c) => c.id === options.group));
    const group = groupable ? fieldText(options.group!, linkId) : null;
    const rows = await tx
      .select({
        ...getTableColumns(prospects),
        /** The name of the row it belongs to (its company), in tables with a relation. */
        parentName: linkId ? parentNameSql : sql<null>`null`,
        groupValue: group ? sql<string | null>`${group}` : sql<null>`null`,
      })
      .from(prospects)
      .where(where)
      .orderBy(
        ...(group ? [sql`${group} asc nulls last`] : []),
        direction === "asc" ? sql`${sortExpr} asc nulls last` : sql`${sortExpr} desc nulls last`,
        desc(prospects.createdAt),
      )
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);
    const [{ matching }] = await tx.select({ matching: count() }).from(prospects).where(where);
    const groups = group
      ? (
          await tx
            .select({ value: sql<string | null>`${group}`, n: count() })
            .from(prospects)
            .where(where)
            .groupBy(sql`1`)
            .orderBy(sql`1 asc nulls last`)
        ).map((g) => ({ value: g.value, n: Number(g.n) }))
      : null;
    const totals = await tx
      .select({ status: prospects.status, n: count() })
      .from(prospects)
      .where(eq(prospects.baseId, baseId))
      .groupBy(prospects.status);
    const byStatus = Object.fromEntries(totals.map((t) => [t.status, Number(t.n)])) as Partial<
      Record<ProspectStatus, number>
    >;
    return {
      rows,
      groups,
      matching: Number(matching),
      byStatus,
      total: totals.reduce((n, t) => n + Number(t.n), 0),
    };
  });
}

/**
 * The rows of other tables that belong to this one (the people of a
 * company), by table, up to `limit` in all.
 */
export async function linkedRows(db: Db, tenant: Pick<TenantContext, "orgId">, rowId: string, limit = 50) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select({
        id: prospects.id,
        baseId: prospects.baseId,
        baseName: prospectBases.name,
        seq: prospects.seq,
        name: rowNameSql(prospects),
        status: prospects.status,
      })
      .from(prospects)
      .innerJoin(prospectBases, eq(prospectBases.id, prospects.baseId))
      .where(eq(prospects.parentId, rowId))
      .orderBy(asc(prospectBases.name), asc(prospects.seq))
      .limit(limit);
    const [{ total }] = await tx
      .select({ total: count() })
      .from(prospects)
      .where(eq(prospects.parentId, rowId));
    return { rows, total: Number(total) };
  });
}

/** Rows of a table to point at, by name (the picker of a relation cell): the closest first. */
export async function searchRows(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  q: string,
  limit = 20,
) {
  const search = q.trim();
  const name = rowNameSql(prospects);
  return withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: prospects.id,
        seq: prospects.seq,
        name,
        companyName: prospects.companyName,
        personName: prospects.personName,
      })
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, baseId),
          search
            ? or(ilike(prospects.companyName, `%${search}%`), ilike(prospects.personName, `%${search}%`))
            : undefined,
        ),
      )
      .orderBy(
        ...(search ? [sql`(${name} ilike ${`${search}%`}) desc`] : []),
        sql`lower(${name}) asc`,
        asc(prospects.seq),
      )
      .limit(limit),
  );
}

/**
 * Deletes rows of a table, and the rows of other tables that belong to them
 * (the people of a deleted company). Says how many of each went.
 */
export async function deleteProspects(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  ids: string[],
): Promise<{ deleted: number; linked: number }> {
  if (ids.length === 0) return { deleted: 0, linked: 0 };
  const base = await baseInfo(db, tenant, baseId);
  return withTenant(db, tenant, async (tx) => {
    const [{ linked }] = await tx
      .select({ linked: count() })
      .from(prospects)
      .where(inArray(prospects.parentId, ids));
    const deleted = await tx
      .delete(prospects)
      .where(and(eq(prospects.baseId, baseId), inArray(prospects.id, ids)))
      .returning({ name: rowNameSql(prospects) });
    if (deleted.length) {
      await audit(tx, tenant, {
        event: "prospects.deleted",
        projectId: base.projectId,
        entityType: "prospect_base",
        entityId: base.id,
        data: {
          count: deleted.length,
          names: deleted.slice(0, 20).map((d) => d.name),
          ...(Number(linked) ? { linked: Number(linked) } : {}),
        },
      });
    }
    return { deleted: deleted.length, linked: deleted.length ? Number(linked) : 0 };
  });
}

export async function setProspectStatus(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  ids: string[],
  status: ProspectStatus,
) {
  if (ids.length === 0) return 0;
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .update(prospects)
      .set({ status })
      .where(and(eq(prospects.baseId, baseId), inArray(prospects.id, ids)))
      .returning({ id: prospects.id });
    return rows.length;
  });
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "Nuevo",
  accepted: "Nuevo",
  exported: "Exportado",
  discarded: "Descartado",
};

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString().slice(0, 10)
        : Array.isArray(value)
          ? value.join(" ")
          : String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A base as CSV with its columns (BOM so Excel reads accents). Exporting
 * marks the new rows as exported.
 */
/** A table's rows as text, in its column order, for exports (CSV or another tool). */
export async function tableForExport(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
  include: "pending" | "all" = "all",
): Promise<{
  name: string;
  projectId: string | null;
  header: string[];
  rows: string[][];
  /** Row ids, in the order of `rows`. */
  ids: string[];
  pendingIds: string[];
}> {
  const base = await baseInfo(db, tenant, baseId);
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({ ...getTableColumns(prospects), parentName: parentNameSql })
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, baseId),
          include === "pending" ? inArray(prospects.status, ["new", "accepted"]) : sql`true`,
        ),
      )
      .orderBy(asc(prospects.seq), asc(prospects.createdAt)),
  );
  const text = (v: unknown) =>
    v === null || v === undefined
      ? ""
      : Array.isArray(v)
        ? v.join(" ")
        : v instanceof Date
          ? v.toISOString()
          : String(v);
  return {
    name: base.name,
    projectId: base.projectId,
    header: [
      "ID",
      ...(base.rowKind === "person" ? ["Nombre"] : []),
      "Empresa",
      "Web",
      ...base.columns.map((c) => c.name),
      "Fuentes",
      "Estado",
      "Fecha de registro",
    ],
    rows: rows.map((r) =>
      [
        r.seq,
        ...(base.rowKind === "person" ? [r.personName] : []),
        r.companyName,
        r.website,
        ...base.columns.map((c) => (c.type === "link" ? r.parentName : formatCell(c, r.data[c.id]))),
        r.sources,
        STATUS_LABELS[r.status],
        r.createdAt,
      ].map(text),
    ),
    ids: rows.map((r) => r.id),
    pendingIds: rows.filter((r) => r.status === "new" || r.status === "accepted").map((r) => r.id),
  };
}

/** Marks rows as exported (they were new) and records the export. */
export async function markExported(
  db: Db,
  tenant: TenantContext,
  input: { baseId: string; projectId: string | null; ids: string[]; count: number; destination?: string },
) {
  await withTenant(db, tenant, async (tx) => {
    if (input.ids.length) {
      await tx.update(prospects).set({ status: "exported" }).where(inArray(prospects.id, input.ids));
    }
    await audit(tx, tenant, {
      event: "prospects.exported",
      projectId: input.projectId,
      entityType: "prospect_base",
      entityId: input.baseId,
      data: { count: input.count, ...(input.destination ? { destination: input.destination } : {}) },
    });
  });
}

export async function exportProspectsCsv(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  include: "pending" | "all" = "all",
): Promise<{ csv: string; count: number }> {
  const table = await tableForExport(db, tenant, baseId, include);
  const lines = [table.header.map(csvCell).join(","), ...table.rows.map((r) => r.map(csvCell).join(","))];
  await markExported(db, tenant, {
    baseId,
    projectId: table.projectId,
    ids: table.pendingIds,
    count: table.rows.length,
  });
  return { csv: `\ufeff${lines.join("\r\n")}\r\n`, count: table.rows.length };
}
