import { randomInt, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MAX_INTAKE_ATTEMPTS, type IntakeAttempt, type IntakeOutcome } from "@/lib/intake-attempts";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { prospectBases } from "../db/schema";
import { withSystem, withTenant, type TenantContext } from "../db/tenant";
import { foldText } from "../knowledge/normalize";
import { saveProspects } from "./service";

/**
 * Rows that arrive from outside: a form on the team's website (or any tool
 * that can POST) adds a row to one table, authenticated by the table's own
 * key (any of the places a tool may put it). Fields are matched to the
 * table's columns by name; the usual names
 * of the fixed fields (empresa, nombre, web…) fill those.
 */

const COMPANY = ["empresa", "company", "compania", "organizacion", "organization", "negocio", "business"];
const PERSON = ["nombre", "name", "nombre completo", "full name", "fullname", "contacto"];
const FIRST = ["first name", "firstname", "nombre de pila"];
const LAST = ["apellido", "apellidos", "last name", "lastname", "surname"];
const WEBSITE = ["web", "website", "url", "sitio web", "pagina web", "dominio"];
const EMAIL = ["email", "e-mail", "correo", "mail", "correo electronico"];
const PHONE = ["telefono", "phone", "movil", "tel", "whatsapp"];

const norm = (s: string) => foldText(s).replace(/[_-]+/g, " ").trim();

function keyMatches(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Letters and digits only: a key with «-» or «_» loses a piece when it is
 * selected with a double click, and the tool gets a key that doesn't match.
 */
const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 24 random letters and digits (about 143 bits). */
export function newIntakeKey(): string {
  return Array.from({ length: 24 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join("");
}

/** A new key for the table's forms (the old one stops working); `open: false` closes the entry. */
export async function setIntakeKey(db: Db, tenant: TenantContext, baseId: string, open = true) {
  const key = open ? newIntakeKey() : null;
  return withTenant(db, tenant, async (tx) => {
    const [base] = await tx
      .update(prospectBases)
      .set({ intakeKey: key })
      .where(eq(prospectBases.id, baseId))
      .returning();
    if (!base) throw new Error("Tabla no encontrada.");
    await audit(tx, tenant, {
      event: open ? "prospect_base.intake_opened" : "prospect_base.intake_closed",
      projectId: base.projectId,
      entityType: "prospect_base",
      entityId: base.id,
    });
    return base;
  });
}

/**
 * The body of a submission as fields: a JSON object (whatever its content
 * type says: some tools send JSON as text) or urlencoded fields. Nested
 * objects are flattened by their inner names ({ contact: { email } } gives
 * email), the outer ones winning. null when it can't be read.
 */
export function parseIntakeBody(raw: string, contentType = ""): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text) return {};
  if (contentType.includes("json") || /^[{[]/.test(text)) {
    try {
      const value: unknown = JSON.parse(text);
      return isObject(value) ? flatten(value) : null;
    } catch {
      return null;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = k in out ? [out[k], v].flat() : v;
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nested: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (isObject(v)) {
      if (depth < 2) nested.push(flatten(v, depth + 1));
    } else out[k] = v;
  }
  for (const inner of nested) for (const [k, v] of Object.entries(inner)) if (!(k in out)) out[k] = v;
  return out;
}

/** A key found in a submission, and where it came from (said to people when it doesn't match). */
export type KeyCandidate = { from: string; key: string };

/** Headers that tools use for an API key. */
const KEY_HEADERS = ["x-salesmate-key", "x-api-key", "api-key", "apikey", "x-key"];
/** Fields (of the body, or of the address) that carry a key, not a value of the row. */
const KEY_FIELDS = ["_key", "key", "api_key", "apikey", "apiKey", "token"];

/** A key as typed into a tool: spaces, quotes and a «Bearer » prefix are not part of it. */
export function cleanKey(raw: string): string {
  return raw
    .trim()
    .replace(/^(bearer|token)\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

/**
 * Every key a submission carries: the x-salesmate-key header (or another
 * usual API-key header), Authorization (Bearer, Token, bare or Basic), a
 * `_key`, `key`, `api_key` or `token` field, or the same in the address.
 * Any of them may be the table's. `fields` are the body fields that carried
 * one (not values for the row).
 */
export function intakeKeyOf(input: { headers: Headers; body: Record<string, unknown>; url: string }): {
  keys: KeyCandidate[];
  fields: string[];
} {
  const keys: KeyCandidate[] = [];
  const fields: string[] = [];
  const add = (from: string, raw: string | null | undefined) => {
    const key = raw ? cleanKey(raw) : "";
    if (key && !keys.some((k) => k.key === key)) keys.push({ from, key });
  };
  for (const name of KEY_HEADERS) add(`cabecera ${name}`, input.headers.get(name));
  const auth = input.headers.get("authorization")?.trim();
  const basic = auth?.match(/^Basic\s+(\S+)/i)?.[1];
  if (basic) {
    // user:password: the key may be either.
    const [user = "", password = ""] = Buffer.from(basic, "base64").toString("utf8").split(":");
    add("Authorization: Basic (usuario)", user);
    add("Authorization: Basic (contraseña)", password);
  } else {
    add("cabecera Authorization", auth);
  }
  for (const field of KEY_FIELDS) {
    const value = input.body[field];
    if (typeof value === "string" && value.trim()) {
      add(`campo ${field}`, value);
      fields.push(field);
    }
  }
  const params = new URL(input.url).searchParams;
  for (const field of KEY_FIELDS) add(`?${field}= de la dirección`, params.get(field));
  return { keys, fields };
}

/** How many characters two keys share at the start and at the end. */
function sharedEnds(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end)) end++;
  return { start, end };
}

/**
 * Why the keys sent aren't the table's, without saying them: where each came
 * from, its length and where it stops matching (a lost last «-» reads as
 * «coinciden los 23 primeros; le falta el último»).
 */
export function keyHint(keys: KeyCandidate[], tableKey: string): string {
  return `${keys
    .map((k) => {
      const { start, end } = sharedEnds(k.key, tableKey);
      const where =
        start === 0 && end === 0
          ? "no se parece a la de la tabla"
          : k.key.length === tableKey.length - 1 && start + end === k.key.length
            ? `coinciden los ${start} primeros y los ${end} últimos: le falta el carácter ${start + 1}${start + 1 === tableKey.length ? " (el último)" : ""}`
            : `coinciden los ${start} primeros y los ${end} últimos`;
      return `${k.from}: ${k.key.length} caracteres, ${where}`;
    })
    .join("; ")}. La de la tabla tiene ${tableKey.length} caracteres.`;
}

/**
 * Notes on the table a submission that didn't add a row, keeping the last
 * few (field names only). Nothing happens for an address with no table.
 */
export async function recordIntakeAttempt(
  db: Db,
  baseId: string,
  attempt: { outcome: IntakeOutcome; message?: string; fields?: string[] },
) {
  const entry: IntakeAttempt = {
    at: new Date().toISOString(),
    outcome: attempt.outcome,
    ...(attempt.message ? { message: attempt.message.slice(0, 500) } : {}),
    ...(attempt.fields?.length ? { fields: attempt.fields.slice(0, 30).map((f) => f.slice(0, 60)) } : {}),
  };
  // Seen in the host's logs too, for whoever looks there.
  console.warn("[salesmate] form submission not added", baseId, entry.outcome, entry.fields ?? []);
  await withSystem(db, (tx) =>
    tx
      .update(prospectBases)
      .set({
        // Newest first, the oldest dropped. Not a change to the table: updatedAt stays.
        intakeLog: sql`(select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from (select e, i from jsonb_array_elements(${JSON.stringify([entry])}::jsonb || ${prospectBases.intakeLog}) with ordinality as a(e, i) order by i limit ${MAX_INTAKE_ATTEMPTS}) t)`,
        updatedAt: sql`${prospectBases.updatedAt}`,
      })
      .where(eq(prospectBases.id, baseId)),
  );
}

export type IntakeResult =
  | { status: "unauthorized" }
  | { status: "added"; orgId: string; rowId: string; ignored: string[] }
  | { status: "duplicate"; ignored: string[] }
  | { status: "invalid"; ignored: string[]; message?: string };

/** Turns a submission into a row of the table, if the key is the table's. */
export async function intakeRow(
  db: Db,
  input: { baseId: string; key: string | null | KeyCandidate[]; fields: Record<string, unknown> },
): Promise<IntakeResult> {
  const [base] = await withSystem(db, (tx) =>
    tx.select().from(prospectBases).where(eq(prospectBases.id, input.baseId)).limit(1),
  );
  if (!base) return { status: "unauthorized" };
  const fieldNames = Object.keys(input.fields);
  const keys = Array.isArray(input.key)
    ? input.key
    : input.key
      ? [{ from: "clave", key: cleanKey(input.key) }]
      : [];
  const tableKey = base.intakeKey;
  if (!tableKey || !keys.some((k) => keyMatches(tableKey, k.key))) {
    await recordIntakeAttempt(db, base.id, {
      outcome: !tableKey ? "closed" : keys.length === 0 ? "missing_key" : "wrong_key",
      message: tableKey && keys.length ? keyHint(keys, tableKey) : undefined,
      fields: fieldNames,
    });
    return { status: "unauthorized" };
  }

  const byName = new Map(base.columns.flatMap((c) => [[norm(c.name), c] as const, [norm(c.id), c] as const]));
  const values: Record<string, unknown> = {};
  const system: { company?: string; person?: string; first?: string; last?: string; website?: string } = {};
  let email: string | undefined;
  let phone: string | undefined;
  const ignored: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(input.fields)) {
    const value = Array.isArray(rawValue) ? rawValue.map(String).join(", ") : String(rawValue ?? "").trim();
    if (!value) continue;
    const key = norm(rawKey);
    const column = byName.get(key);
    if (column) {
      values[column.id] = column.type === "multi" ? value.split(/\s*,\s*/) : value;
      continue;
    }
    if (COMPANY.includes(key)) system.company = value;
    else if (PERSON.includes(key)) system.person = value;
    else if (FIRST.includes(key)) system.first = value;
    else if (LAST.includes(key)) system.last = value;
    else if (WEBSITE.includes(key)) system.website = value;
    else if (EMAIL.includes(key)) email = value;
    else if (PHONE.includes(key)) phone = value;
    else ignored.push(rawKey);
  }
  // Email and phone go to the table's email / phone column when it has one.
  for (const [type, value] of [
    ["email", email],
    ["phone", phone],
  ] as const) {
    if (!value) continue;
    const column = base.columns.find((c) => c.type === type && values[c.id] === undefined);
    if (column) values[column.id] = value;
    else ignored.push(type === "email" ? "email" : "telefono");
  }

  const person = system.person ?? ([system.first, system.last].filter(Boolean).join(" ") || undefined);
  const tenant: TenantContext = { orgId: base.orgId, actorType: "system", actorId: "form" };
  const saved = await saveProspects(db, tenant, {
    baseId: base.id,
    items: [
      {
        // Without any name the row still arrives, and isn't taken for another one.
        companyName:
          base.rowKind === "person"
            ? (system.company ?? "")
            : (system.company ?? person ?? email ?? `Formulario ${new Date().toISOString().slice(0, 19)}`),
        personName: base.rowKind === "person" ? (person ?? email ?? "Sin nombre") : undefined,
        website: system.website,
        fields: values,
      },
    ],
  });
  if (saved.added[0]) return { status: "added", orgId: base.orgId, rowId: saved.added[0].id, ignored };
  if (saved.duplicates.length) {
    await recordIntakeAttempt(db, base.id, { outcome: "duplicate", fields: fieldNames });
    return { status: "duplicate", ignored };
  }
  const message = saved.fieldErrors.join(" · ") || undefined;
  await recordIntakeAttempt(db, base.id, { outcome: "invalid", message, fields: fieldNames });
  return { status: "invalid", ignored, message };
}
