import type { BaseColumn, ColumnType, RowKind, SystemField } from "./prospect-columns";

/**
 * Filtering and grouping the rows of a table by any field: which conditions
 * each kind of field has, and how a filter travels in the address
 * (?f=<field>~<op>~<value>, one per filter, all must hold; ?group=<field>).
 * Shared by the page (to read and build links) and the service (to query).
 */

export const FILTER_OPS = [
  "contains",
  "is",
  "isNot",
  "has",
  "gt",
  "lt",
  "before",
  "after",
  "yes",
  "no",
  "empty",
  "notEmpty",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  contains: "contiene",
  is: "es",
  isNot: "no es",
  has: "incluye",
  gt: "mayor que",
  lt: "menor que",
  before: "antes del",
  after: "después del",
  yes: "sí",
  no: "no",
  empty: "está vacío",
  notEmpty: "tiene valor",
};

/** Operators that take no value. */
export const NO_VALUE: FilterOp[] = ["yes", "no", "empty", "notEmpty"];

export type RowFilter = { key: string; op: FilterOp; value?: string };

/** A field of the table as filters and groups see it. */
export type FilterField = {
  key: string;
  label: string;
  /** How it compares: like a column type; the fixed fields map to one. */
  type: ColumnType | "status";
  options?: string[];
};

/** The conditions a kind of field offers, the usual one first. */
export function opsFor(type: FilterField["type"]): FilterOp[] {
  switch (type) {
    case "number":
    case "score":
      return ["is", "gt", "lt", "empty", "notEmpty"];
    case "date":
      return ["before", "after", "is", "empty", "notEmpty"];
    case "bool":
      return ["yes", "no"];
    case "select":
    case "stage":
    case "status":
      return ["is", "isNot", "empty", "notEmpty"];
    case "multi":
      return ["has", "empty", "notEmpty"];
    default:
      return ["contains", "is", "empty", "notEmpty"];
  }
}

export const STATUS_OPTIONS: Record<string, string> = {
  new: "Nueva",
  accepted: "Nueva",
  exported: "Exportada",
  discarded: "Descartada",
};

/** The fields a table can be filtered and grouped by: its fixed fields and its columns. */
export function filterFields(
  rowKind: RowKind,
  columns: BaseColumn[],
  labels: Record<SystemField, string>,
): FilterField[] {
  const fixed: FilterField[] = [
    rowKind === "person"
      ? { key: "person", label: labels.person, type: "text" }
      : { key: "company", label: labels.company, type: "text" },
    ...(rowKind === "person" ? [{ key: "company", label: labels.company, type: "text" as const }] : []),
    { key: "web", label: labels.web, type: "url" },
    { key: "status", label: labels.status, type: "status", options: ["new", "exported", "discarded"] },
    { key: "created", label: labels.created, type: "date" },
  ];
  return [...fixed, ...columns.map((c) => ({ key: c.id, label: c.name, type: c.type, options: c.options }))];
}

/** Reads the ?f= filters, keeping only the ones that make sense for the table. */
export function parseFilters(raw: string | string[] | undefined, fields: FilterField[]): RowFilter[] {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.flatMap((item) => {
    const [key, op, ...rest] = item.split("~");
    const field = fields.find((f) => f.key === key);
    if (!field || !opsFor(field.type).includes(op as FilterOp)) return [];
    const value = rest.join("~");
    if (!NO_VALUE.includes(op as FilterOp) && !value.trim()) return [];
    return [{ key, op: op as FilterOp, value: NO_VALUE.includes(op as FilterOp) ? undefined : value }];
  });
}

/** One filter as it goes in the address. */
export const filterParam = (f: RowFilter) => [f.key, f.op, f.value ?? ""].join("~");

/** «Ciudad contiene Málaga». */
export function describeFilter(f: RowFilter, fields: FilterField[]): string {
  const field = fields.find((x) => x.key === f.key);
  const value = field?.type === "status" && f.value ? (STATUS_OPTIONS[f.value] ?? f.value) : f.value;
  return [field?.label ?? f.key, FILTER_OP_LABELS[f.op], value].filter(Boolean).join(" ");
}
