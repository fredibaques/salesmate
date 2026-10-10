import { z } from "zod";

/**
 * Columns of a prospect base, defined by the user (like a spreadsheet). The
 * definitions are data shared by the screens and the server: what each
 * column holds, how the agent should fill it, and how its values are
 * checked and shown.
 */

export const COLUMN_TYPES = [
  "text",
  "long",
  "number",
  "date",
  "bool",
  "select",
  "multi",
  "url",
  "email",
  "phone",
  "score",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Texto",
  long: "Texto largo",
  number: "Número",
  date: "Fecha",
  bool: "Sí / no",
  select: "Selección única",
  multi: "Selección múltiple",
  url: "Enlace",
  email: "Email",
  phone: "Teléfono",
  score: "Puntuación 0–100",
};

export const FILLED_BY = ["agent", "person", "both"] as const;
export type FilledBy = (typeof FILLED_BY)[number];

export const ROW_KINDS = ["company", "person"] as const;
export type RowKind = (typeof ROW_KINDS)[number];

export type BaseColumn = {
  /** Stable key of the values in `prospects.data`; renaming the column keeps it. */
  id: string;
  name: string;
  type: ColumnType;
  /** Choices of a select or multi column. */
  options?: string[];
  /** What to put here and where to find it: what the agent reads. */
  instructions?: string;
  filledBy: FilledBy;
  required?: boolean;
  hidden?: boolean;
};

export const MAX_COLUMNS = 50;

/**
 * The fields every row has besides the user's columns. The row's name (the
 * company, or the person in tables of people) is the only one a table can't
 * hide: it is how rows are told apart. The rest show or hide like columns.
 */
export const SYSTEM_FIELDS = ["person", "company", "web", "fit", "status", "sources", "created"] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];

export const SYSTEM_FIELD_LABELS: Record<SystemField, string> = {
  person: "Nombre",
  company: "Empresa",
  web: "Web",
  fit: "Encaje",
  status: "Estado",
  sources: "Fuentes",
  created: "Fecha de registro",
};

/** The field that names each row. */
export function primaryField(rowKind: RowKind): SystemField {
  return rowKind === "person" ? "person" : "company";
}

/** The fixed fields of a table of this kind (the name first). */
export function systemFields(rowKind: RowKind): SystemField[] {
  return rowKind === "person" ? [...SYSTEM_FIELDS] : SYSTEM_FIELDS.filter((f) => f !== "person");
}

/** A new table shows only the row's name and when each row arrived: the rest is added from the table. */
export function newTableHiddenFields(rowKind: RowKind): SystemField[] {
  return systemFields(rowKind).filter((f) => f !== primaryField(rowKind) && f !== "created");
}

/**
 * The columns every prospect had before bases existed. Migrated prospects
 * keep their values under these ids, and new company bases start from them.
 */
export const DEFAULT_COMPANY_COLUMNS: BaseColumn[] = [
  {
    id: "sector",
    name: "Sector",
    type: "text",
    filledBy: "agent",
    instructions: "A qué se dedica la empresa, en pocas palabras.",
  },
  { id: "city", name: "Ciudad", type: "text", filledBy: "agent", instructions: "Ciudad de la sede." },
  {
    id: "region",
    name: "Provincia / región",
    type: "text",
    filledBy: "agent",
    instructions: "Provincia o región de la sede.",
  },
  { id: "country", name: "País", type: "text", filledBy: "agent" },
  {
    id: "phone",
    name: "Teléfono",
    type: "phone",
    filledBy: "agent",
    instructions: "Teléfono general o de ventas que publica la propia empresa.",
  },
  {
    id: "email",
    name: "Email",
    type: "email",
    filledBy: "agent",
    instructions: "Email general o de ventas que publica la propia empresa.",
  },
  {
    id: "contact",
    name: "Contacto",
    type: "text",
    filledBy: "agent",
    instructions: "Persona de contacto, solo si la empresa la publica para ser contactada.",
  },
  { id: "role", name: "Cargo", type: "text", filledBy: "agent", instructions: "Cargo de esa persona." },
  { id: "linkedin", name: "LinkedIn", type: "url", filledBy: "agent", instructions: "Página de empresa." },
];

/** Columns of a new base of people, when the AI doesn't propose any. */
export const DEFAULT_PERSON_COLUMNS: BaseColumn[] = [
  { id: "role", name: "Cargo", type: "text", filledBy: "agent", instructions: "Cargo en la empresa." },
  {
    id: "email",
    name: "Email",
    type: "email",
    filledBy: "agent",
    instructions: "Email profesional, solo si se publica para ser contactada.",
  },
  {
    id: "phone",
    name: "Teléfono",
    type: "phone",
    filledBy: "agent",
    instructions: "Teléfono profesional, solo si se publica para ser contactada.",
  },
  { id: "city", name: "Ciudad", type: "text", filledBy: "agent", instructions: "Ciudad donde trabaja." },
  { id: "linkedin", name: "LinkedIn", type: "url", filledBy: "agent", instructions: "Perfil público." },
];

export const DEFAULT_COLUMNS: Record<RowKind, BaseColumn[]> = {
  company: DEFAULT_COMPANY_COLUMNS,
  person: DEFAULT_PERSON_COLUMNS,
};

/** A column as people (or the AI) describe it, before it gets its id. */
export const columnDraft = z
  .object({
    name: z.string().trim().min(1, "Ponle un nombre a la columna.").max(80),
    type: z.enum(COLUMN_TYPES),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    instructions: z.string().trim().max(1000).optional(),
    filledBy: z.enum(FILLED_BY).default("agent"),
    hidden: z.boolean().optional(),
  })
  .transform((c) => ({
    ...c,
    options: c.type === "select" || c.type === "multi" ? [...new Set(c.options ?? [])] : undefined,
    instructions: c.instructions || undefined,
  }))
  .refine((c) => !c.options || c.options.length > 0, {
    message: "Una columna de selección necesita al menos una opción.",
    path: ["options"],
  });
export type ColumnDraft = z.input<typeof columnDraft>;

/**
 * Keys the table already uses for its fixed columns (sorting, the agent's
 * row fields): a column can't take them as its id.
 */
const RESERVED_IDS = new Set([
  "name",
  "person",
  "web",
  "fit",
  "status",
  "created",
  "companyname",
  "personname",
  "website",
  "fitscore",
  "fitreason",
  "sources",
]);

/** A stable id for a new column from its name: «¿Gestoría propia?» → «gestoria_propia». */
export function columnId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "columna";
  const base = RESERVED_IDS.has(slug.replace(/_/g, "")) ? `${slug}_col` : slug;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}

/**
 * A cell the agent still has to fill: a column it fills, with no value, that
 * nobody has written and the agent hasn't already looked for in vain.
 */
export function isPendingCell(column: BaseColumn, value: unknown, meta: unknown): boolean {
  return column.filledBy !== "person" && (value === null || value === undefined) && !meta;
}

export type CellCheck = { ok: true; value: unknown } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks and normalizes one value for a column. Empty values come back as
 * null (nothing to store). Used for what the agent saves and what people type.
 */
export function checkCell(column: BaseColumn, raw: unknown): CellCheck {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value: null };
  }
  const text = typeof raw === "string" ? raw.trim() : raw;
  const fail = (error: string): CellCheck => ({ ok: false, error: `${column.name}: ${error}` });
  switch (column.type) {
    case "text":
    case "phone":
      return typeof text === "string" || typeof text === "number"
        ? { ok: true, value: String(text).slice(0, 500) }
        : fail("debe ser texto");
    case "long":
      return typeof text === "string" ? { ok: true, value: text.slice(0, 5000) } : fail("debe ser texto");
    case "number": {
      const n = typeof text === "number" ? text : Number(String(text).replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? { ok: true, value: n } : fail("debe ser un número");
    }
    case "score": {
      const n = typeof text === "number" ? text : Number(text);
      return Number.isFinite(n) && n >= 0 && n <= 100
        ? { ok: true, value: Math.round(n) }
        : fail("debe ser un número de 0 a 100");
    }
    case "date": {
      const s = String(text);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
        ? { ok: true, value: s }
        : fail("debe ser una fecha AAAA-MM-DD");
    }
    case "bool":
      if (typeof text === "boolean") return { ok: true, value: text };
      if (typeof text === "string" && /^(s[ií]|true|yes)$/i.test(text)) return { ok: true, value: true };
      if (typeof text === "string" && /^(no|false)$/i.test(text)) return { ok: true, value: false };
      return fail("debe ser sí o no");
    case "select": {
      const match = (column.options ?? []).find((o) => o.toLowerCase() === String(text).toLowerCase());
      return match
        ? { ok: true, value: match }
        : fail(`debe ser una de: ${(column.options ?? []).join(", ")}`);
    }
    case "multi": {
      const items = Array.isArray(text) ? text : String(text).split(",");
      const picked: string[] = [];
      for (const item of items) {
        const match = (column.options ?? []).find(
          (o) => o.toLowerCase() === String(item).trim().toLowerCase(),
        );
        if (!match)
          return fail(`«${String(item).trim()}» no es una de: ${(column.options ?? []).join(", ")}`);
        if (!picked.includes(match)) picked.push(match);
      }
      return picked.length ? { ok: true, value: picked } : { ok: true, value: null };
    }
    case "url": {
      const s = String(text);
      try {
        const url = new URL(s.includes("://") ? s : `https://${s}`);
        return url.hostname.includes(".") ? { ok: true, value: url.toString() } : fail("no es un enlace");
      } catch {
        return fail("no es un enlace");
      }
    }
    case "email":
      return EMAIL.test(String(text))
        ? { ok: true, value: String(text).toLowerCase() }
        : fail("no es un email");
  }
}

/** A value as text, for the table and the export. */
export function formatCell(column: BaseColumn, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.type) {
    case "bool":
      return value === true ? "Sí" : value === false ? "No" : String(value);
    case "multi":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString("es-ES") : String(value);
    case "date": {
      const [y, m, d] = String(value).split("-");
      return d ? `${d}/${m}/${y}` : String(value);
    }
    default:
      return String(value);
  }
}
