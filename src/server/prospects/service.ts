import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { prospects, PROSPECT_STATUSES } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { foldText } from "../knowledge/normalize";

/**
 * Prospects are what a prospecting agent finds: companies (and, when public,
 * a contact) that match the ideal customer. They pile up run after run
 * without duplicates and are reviewed and exported by people.
 */

export type ProspectRow = typeof prospects.$inferSelect;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => v || undefined);

export const prospectInput = z.object({
  companyName: z.string().trim().min(1).max(300),
  website: optionalText,
  sector: optionalText,
  city: optionalText,
  region: optionalText,
  country: optionalText,
  phone: optionalText,
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  contactName: optionalText,
  contactRole: optionalText,
  linkedinUrl: optionalText,
  fitScore: z.number().int().min(0).max(100).optional(),
  fitReason: z.string().trim().max(1000).optional(),
  sources: z.array(z.string().url()).max(10).default([]),
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

/** The same company found twice (same domain, or same name in the same city) is one prospect. */
export function dedupeKey(p: { website?: string | null; companyName: string; city?: string | null }): string {
  const domain = normalizeDomain(p.website);
  if (domain) return `web:${domain}`;
  const name = foldText(p.companyName)
    .replace(/\b(s\.?l\.?u?|s\.?a\.?|sociedad limitada|sociedad anonima)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `name:${name}|${foldText(p.city ?? "").trim()}`;
}

export async function saveProspects(
  db: Db,
  tenant: TenantContext,
  input: { projectId: string; agentConfigId?: string; runId?: string; items: ProspectInput[] },
): Promise<{ added: ProspectRow[]; duplicates: string[]; invalid: string[] }> {
  const invalid: string[] = [];
  const parsed = input.items.flatMap((raw) => {
    const result = prospectInput.safeParse(raw);
    if (!result.success) {
      invalid.push(String((raw as { companyName?: unknown }).companyName ?? "(sin nombre)"));
      return [];
    }
    return [result.data];
  });
  const unique = new Map(parsed.map((p) => [dedupeKey(p), p]));
  if (unique.size === 0) return { added: [], duplicates: [], invalid };

  return withTenant(db, tenant, async (tx) => {
    const added = await tx
      .insert(prospects)
      .values(
        [...unique].map(([key, p]) => ({
          orgId: tenant.orgId,
          projectId: input.projectId,
          agentConfigId: input.agentConfigId,
          runId: input.runId,
          dedupeKey: key,
          ...p,
        })),
      )
      .onConflictDoNothing({ target: [prospects.projectId, prospects.dedupeKey] })
      .returning();
    const addedKeys = new Set(added.map((a) => a.dedupeKey));
    const duplicates = [...unique].filter(([key]) => !addedKeys.has(key)).map(([, p]) => p.companyName);
    if (added.length > 0) {
      await audit(tx, tenant, {
        event: "prospects.added",
        projectId: input.projectId,
        entityType: "prospect",
        data: { count: added.length, names: added.slice(0, 20).map((a) => a.companyName) },
      });
    }
    return { added, duplicates, invalid };
  });
}

/** Which of these companies the project already has (by domain or name + city). */
export async function knownProspects(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  candidates: { website?: string; companyName: string; city?: string }[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const keys = candidates.map((c) => dedupeKey(c));
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({ key: prospects.dedupeKey })
      .from(prospects)
      .where(and(eq(prospects.projectId, projectId), inArray(prospects.dedupeKey, keys))),
  );
  const found = new Set(rows.map((r) => r.key));
  return candidates.filter((_, i) => found.has(keys[i])).map((c) => c.companyName);
}

/** Names of the most recent prospects, so a new run looks for different ones. */
export async function recentProspectNames(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  limit = 300,
): Promise<string[]> {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({ name: prospects.companyName, website: prospects.website, city: prospects.city })
      .from(prospects)
      .where(eq(prospects.projectId, projectId))
      .orderBy(desc(prospects.createdAt))
      .limit(limit),
  );
  return rows.map((r) => [r.name, r.city, normalizeDomain(r.website)].filter(Boolean).join(" · "));
}

export async function listProspects(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  filter: { status?: ProspectStatus; limit?: number; offset?: number } = {},
) {
  return withTenant(db, tenant, async (tx) => {
    const where = and(
      eq(prospects.projectId, projectId),
      filter.status ? eq(prospects.status, filter.status) : undefined,
    );
    const rows = await tx
      .select()
      .from(prospects)
      .where(where)
      .orderBy(desc(prospects.createdAt))
      .limit(filter.limit ?? 200)
      .offset(filter.offset ?? 0);
    const totals = await tx
      .select({ status: prospects.status, n: count() })
      .from(prospects)
      .where(eq(prospects.projectId, projectId))
      .groupBy(prospects.status);
    const byStatus = Object.fromEntries(totals.map((t) => [t.status, Number(t.n)])) as Partial<
      Record<ProspectStatus, number>
    >;
    return { rows, byStatus, total: totals.reduce((n, t) => n + Number(t.n), 0) };
  });
}

export async function setProspectStatus(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  ids: string[],
  status: ProspectStatus,
) {
  if (ids.length === 0) return 0;
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .update(prospects)
      .set({ status })
      .where(and(eq(prospects.projectId, projectId), inArray(prospects.id, ids)))
      .returning({ id: prospects.id });
    return rows.length;
  });
}

const CSV_COLUMNS: [keyof ProspectRow, string][] = [
  ["companyName", "Empresa"],
  ["website", "Web"],
  ["sector", "Sector"],
  ["city", "Ciudad"],
  ["region", "Provincia/Región"],
  ["country", "País"],
  ["phone", "Teléfono"],
  ["email", "Email"],
  ["contactName", "Contacto"],
  ["contactRole", "Cargo"],
  ["linkedinUrl", "LinkedIn"],
  ["fitScore", "Encaje (0-100)"],
  ["fitReason", "Por qué encaja"],
  ["sources", "Fuentes"],
  ["status", "Estado"],
  ["createdAt", "Encontrado"],
];

const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "Sin revisar",
  accepted: "Aceptado",
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
 * Prospects as CSV (with BOM so Excel reads accents). Exporting marks the
 * new and accepted ones as exported.
 */
export async function exportProspectsCsv(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  include: "pending" | "all" = "all",
): Promise<{ csv: string; count: number }> {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select()
      .from(prospects)
      .where(
        and(
          eq(prospects.projectId, projectId),
          include === "pending" ? inArray(prospects.status, ["new", "accepted"]) : sql`true`,
        ),
      )
      .orderBy(desc(prospects.createdAt));
    const lines = [
      CSV_COLUMNS.map(([, label]) => csvCell(label)).join(","),
      ...rows.map((r) =>
        CSV_COLUMNS.map(([key]) => csvCell(key === "status" ? STATUS_LABELS[r.status] : r[key])).join(","),
      ),
    ];
    const toMark = rows.filter((r) => r.status === "new" || r.status === "accepted").map((r) => r.id);
    if (toMark.length) {
      await tx.update(prospects).set({ status: "exported" }).where(inArray(prospects.id, toMark));
    }
    await audit(tx, tenant, {
      event: "prospects.exported",
      projectId,
      entityType: "prospect",
      data: { count: rows.length },
    });
    return { csv: `﻿${lines.join("\r\n")}\r\n`, count: rows.length };
  });
}
