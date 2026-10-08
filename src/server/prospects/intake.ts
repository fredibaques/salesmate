import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { prospectBases } from "../db/schema";
import { withSystem, withTenant, type TenantContext } from "../db/tenant";
import { foldText } from "../knowledge/normalize";
import { saveProspects } from "./service";

/**
 * Rows that arrive from outside: a form on the team's website (or any tool
 * that can POST) adds a row to one table, authenticated by the table's own
 * key. Fields are matched to the table's columns by name; the usual names
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

/** A new key for the table's forms (the old one stops working); `open: false` closes the entry. */
export async function setIntakeKey(db: Db, tenant: TenantContext, baseId: string, open = true) {
  const key = open ? randomBytes(18).toString("base64url") : null;
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

export type IntakeResult =
  | { status: "unauthorized" }
  | { status: "added"; orgId: string; rowId: string; ignored: string[] }
  | { status: "duplicate"; ignored: string[] }
  | { status: "invalid"; ignored: string[]; message?: string };

/** Turns a submission into a row of the table, if the key is the table's. */
export async function intakeRow(
  db: Db,
  input: { baseId: string; key: string | null; fields: Record<string, unknown> },
): Promise<IntakeResult> {
  const [base] = await withSystem(db, (tx) =>
    tx.select().from(prospectBases).where(eq(prospectBases.id, input.baseId)).limit(1),
  );
  if (!base?.intakeKey || !input.key || !keyMatches(base.intakeKey, input.key))
    return { status: "unauthorized" };

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
  if (saved.duplicates.length) return { status: "duplicate", ignored };
  return { status: "invalid", ignored, message: saved.fieldErrors.join(" · ") || undefined };
}
