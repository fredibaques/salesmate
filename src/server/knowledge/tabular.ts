import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { TableColumn } from "../db/schema";
import { slugifyKey } from "./normalize";

/**
 * Turns spreadsheets (CSV, XLSX) into typed tables the agents can query.
 * Typing matters: prices must be compared as numbers, not text.
 */

export type RawSheet = { name: string; description?: string; headers: string[]; rows: unknown[][] };
export type Cell = string | number | boolean | null;
export type TypedTable = {
  name: string;
  description?: string;
  columns: TableColumn[];
  rows: Record<string, Cell>[];
};
/** A sheet as it comes out of the file: every non-empty row, cells in column order. */
export type SheetMatrix = { name: string; rows: unknown[][] };

export async function parseTabularFile(data: ArrayBuffer | Buffer, filename: string): Promise<SheetMatrix[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const text = Buffer.from(data as ArrayBuffer)
      .toString("utf8")
      .replace(/^\uFEFF/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    return [{ name: filename.replace(/\.[^.]+$/, ""), rows: parsed.data }];
  }
  if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as ArrayBuffer);
    const sheets: SheetMatrix[] = [];
    workbook.eachSheet((sheet) => {
      const rows: unknown[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        // Array.from fills the holes ExcelJS leaves for empty cells.
        rows.push(Array.from((row.values as unknown[]).slice(1), cellValue));
      });
      if (rows.length > 0) sheets.push({ name: sheet.name, rows });
    });
    return sheets;
  }
  throw new Error("Formato no soportado: usa CSV o XLSX.");
}

// ---------------------------------------------------------------------------
// Layout: real spreadsheets are often laid out for people, with a title, a
// note, several tables one under another and the conditions at the bottom.
// ---------------------------------------------------------------------------

/** Bullets and arrows people put in front of labels (never a minus sign). */
const DECORATION = /^[\u21AA\u203A\u00BB\u2022\u00B7\u25AA\u25BA\u25B6\u2192\u2794\u27A4]+\s*/u;

function cleanCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(DECORATION, "").trim();
}

function filled(row: unknown[]): string[] {
  return row.filter((v) => !isEmpty(v)).map((v) => String(v instanceof Date ? v.toISOString() : v).trim());
}

/**
 * Splits a sheet into tables plus loose text. A row with one distinct value
 * is text (a title, a note or a merged cell spanning the width); a row with
 * several values starts a table, whose first row is the header. Header rows
 * that repeat the first cell ("Trámite | Precio | Compromiso…" then
 * "Trámite | Precio | 100 | 200…") are merged into one label per column.
 */
export function segmentSheet(sheet: SheetMatrix): { tables: RawSheet[]; notes: string[] } {
  const rows = sheet.rows.map((r) => r.map(cleanCell)).filter((r) => filled(r).length > 0);
  const tables: RawSheet[] = [];
  let pending: string[] = [];
  let current: RawSheet | null = null;
  let inHeader = false;

  const close = () => {
    if (!current) return;
    // Footnotes under a table («› Precios sin IVA») fill just one cell: they are notes, not rows.
    const footnotes: string[] = [];
    while (current.rows.length > 1 && current.headers.length > 1) {
      const last = filled(current.rows[current.rows.length - 1]);
      if (last.length !== 1) break;
      footnotes.unshift(last[0]);
      current.rows.pop();
    }
    tables.push(current);
    pending.push(...footnotes);
    current = null;
  };

  for (const row of rows) {
    const values = filled(row);
    const isText = new Set(values).size === 1;
    // The same value across several cells is a merged cell: a title or note.
    const spansCells = isText && values.length > 1;

    if (current) {
      const table: RawSheet = current;
      if (spansCells || (isText && inHeader)) {
        close();
        pending.push(values[0]);
      } else if (inHeader && !isText && !isEmpty(row[0]) && String(row[0]).trim() === table.headers[0]) {
        table.headers = mergeHeaders(table.headers, row);
      } else {
        // A lone value in one cell is still a (sparse) row of the table.
        inHeader = false;
        table.rows.push(row);
      }
      continue;
    }
    if (isText) {
      pending.push(values[0]);
      continue;
    }
    // A new table: the title is the last short line above it that reads like a
    // heading (no final period); the rest is its note.
    const short = (t: string) => t.length <= 80;
    let titleIndex = pending.findLastIndex((t) => short(t) && !/[.:]$/.test(t));
    if (titleIndex < 0) titleIndex = pending.findLastIndex(short);
    const note = pending.filter((_, i) => i !== titleIndex).join("\n");
    current = {
      name: titleIndex >= 0 ? pending[titleIndex] : sheet.name,
      description: note || undefined,
      headers: row.map((v) => (isEmpty(v) ? "" : String(v).trim())),
      rows: [],
    };
    inHeader = true;
    pending = [];
  }
  close();

  if (tables.length === 0 && rows.length > 1) {
    // A one-column list: keep the first row as its header.
    const [headers, ...rest] = rows;
    return {
      tables: [{ name: sheet.name, headers: headers.map((h) => String(h ?? "")), rows: rest }],
      notes: [],
    };
  }

  // Name clashes (several untitled tables in one sheet) get a number.
  const seen = new Map<string, number>();
  for (const t of tables) {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    if (n > 1) t.name = `${t.name} (${n})`;
  }
  return { tables, notes: pending };
}

function mergeHeaders(headers: string[], row: unknown[]): string[] {
  const width = Math.max(headers.length, row.length);
  return Array.from({ length: width }, (_, i) => {
    const top = headers[i] ?? "";
    const bottom = isEmpty(row[i]) ? "" : String(row[i]).trim();
    if (!top || top === bottom) return bottom || top;
    if (!bottom) return top;
    return `${top} ${bottom}`;
  });
}

function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const v = value as {
      result?: unknown;
      text?: unknown;
      richText?: { text: string }[];
      hyperlink?: string;
    };
    if ("result" in v) return cellValue(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.hyperlink) return v.hyperlink;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

const TRUE = new Set(["true", "sí", "si", "yes", "verdadero", "x"]);
const FALSE = new Set(["false", "no", "falso"]);

function isEmpty(v: unknown) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Decides whether a column writes decimals with a comma (es) or a dot (en). */
function detectDecimalComma(values: string[]): boolean {
  return values.some((v) => /\d,\d{1,2}(\D*)$/.test(v) || /\d\.\d{3},\d/.test(v));
}

/** Drops floating-point noise from spreadsheet formulas (7.444500000000001 → 7.4445). */
function tidy(n: number): number | null {
  return Number.isFinite(n) ? Number(n.toPrecision(12)) : null;
}

export function parseNumber(raw: unknown, decimalComma: boolean): number | null {
  if (typeof raw === "number") return tidy(raw);
  if (typeof raw !== "string") return null;
  let s = raw
    .trim()
    .replace(/[€$£%\s ]/g, "")
    .replace(/(eur|euros|usd)$/i, "");
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if ((s.match(/\./g) ?? []).length > 1) return null;
  return tidy(Number(s));
}

export function parseDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // dd/mm/yyyy
  if (m) {
    const [d, mo] = [Number(m[1]), Number(m[2])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return null;
}

export function inferTable(sheet: RawSheet): TypedTable {
  const usedKeys = new Set<string>();
  const columns: (TableColumn & { index: number; decimalComma: boolean })[] = [];

  const width = Math.max(sheet.headers.length, ...sheet.rows.map((r) => r.length));
  Array.from({ length: width }, (_, i) => sheet.headers[i] ?? "").forEach((header, index) => {
    const named = String(header ?? "").trim();
    if (!named && sheet.rows.every((r) => isEmpty(r[index]))) return;
    const label = named || `Columna ${index + 1}`;
    let key = slugifyKey(label);
    for (let n = 2; usedKeys.has(key); n++) key = `${slugifyKey(label)}_${n}`;
    usedKeys.add(key);

    const values = sheet.rows.map((r) => r[index]).filter((v) => !isEmpty(v));
    const strings = values.filter((v): v is string => typeof v === "string");
    const decimalComma = detectDecimalComma(strings);

    let type: TableColumn["type"] = "text";
    if (values.length > 0) {
      if (values.every((v) => parseBoolean(v) !== null)) {
        type = "boolean";
      } else if (values.every((v) => parseNumber(v, decimalComma) !== null)) {
        type = values.every((v) => Number.isInteger(parseNumber(v, decimalComma))) ? "integer" : "number";
      } else if (values.every((v) => parseDate(v) !== null)) {
        type = "date";
      }
    }
    columns.push({ key, label, type, index, decimalComma });
  });

  const rows = sheet.rows
    .filter((r) => r.some((v) => !isEmpty(v)))
    .map((r) => {
      const record: Record<string, Cell> = {};
      for (const c of columns) {
        const v = r[c.index];
        if (isEmpty(v)) record[c.key] = null;
        else if (c.type === "number" || c.type === "integer") record[c.key] = parseNumber(v, c.decimalComma);
        else if (c.type === "boolean") record[c.key] = parseBoolean(v);
        else if (c.type === "date") record[c.key] = parseDate(v);
        else record[c.key] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
      }
      return record;
    });

  return {
    name: sheet.name,
    description: sheet.description,
    columns: columns.map(({ key, label, type }) => ({ key, label, type })),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Text rendering: tables are also indexed as text so a plain search ("precio
// transferencia") finds the right rows, each line carrying its column names.
// ---------------------------------------------------------------------------

export function formatCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "number") return value.toLocaleString("es-ES", { maximumFractionDigits: 4 });
  if (typeof value === "boolean") return value ? "sí" : "no";
  return value;
}

export function rowToText(columns: TableColumn[], row: Record<string, Cell>): string {
  return columns
    .filter((c) => row[c.key] !== null && row[c.key] !== undefined && row[c.key] !== "")
    .map((c) => `${c.label}: ${formatCell(row[c.key])}`)
    .join(" · ");
}

/** One chunk per group of rows, each repeating the table name and its note. */
export function tableToChunks(table: TypedTable, rowsPerChunk = 20): string[] {
  const head = [`Tabla «${table.name}»`, table.description].filter(Boolean).join("\n");
  const lines = table.rows.map((r) => `- ${rowToText(table.columns, r)}`);
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += rowsPerChunk) {
    chunks.push(`${head}\n${lines.slice(i, i + rowsPerChunk).join("\n")}`);
  }
  return chunks.length > 0 ? chunks : [head];
}
