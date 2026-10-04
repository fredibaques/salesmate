import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { TableColumn } from "../db/schema";
import { slugifyKey } from "./normalize";

/**
 * Turns spreadsheets (CSV, XLSX) into typed tables the agents can query.
 * Typing matters: prices must be compared as numbers, not text.
 */

export type RawSheet = { name: string; headers: string[]; rows: unknown[][] };
export type Cell = string | number | boolean | null;
export type TypedTable = { name: string; columns: TableColumn[]; rows: Record<string, Cell>[] };

export async function parseTabularFile(data: ArrayBuffer | Buffer, filename: string): Promise<RawSheet[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const text = Buffer.from(data as ArrayBuffer).toString("utf8").replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const [headers = [], ...rows] = parsed.data;
    return [{ name: filename.replace(/\.[^.]+$/, ""), headers, rows }];
  }
  if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as ArrayBuffer);
    const sheets: RawSheet[] = [];
    workbook.eachSheet((sheet) => {
      const matrix: unknown[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = (row.values as unknown[]).slice(1).map(cellValue);
        matrix.push(values);
      });
      const [headers = [], ...rows] = matrix;
      if (headers.length > 0) sheets.push({ name: sheet.name, headers: headers.map((h) => String(h ?? "")), rows });
    });
    return sheets;
  }
  throw new Error("Formato no soportado: usa CSV o XLSX.");
}

function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
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

export function parseNumber(raw: unknown, decimalComma: boolean): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[€$£%\s ]/g, "").replace(/(eur|euros|usd)$/i, "");
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if ((s.match(/\./g) ?? []).length > 1) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

  sheet.headers.forEach((header, index) => {
    const label = String(header ?? "").trim() || `Columna ${index + 1}`;
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
    columns: columns.map(({ key, label, type }) => ({ key, label, type })),
    rows,
  };
}
