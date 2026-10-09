import { z } from "zod";
import type { Db } from "../db/client";
import { userPreferences, type NavPreferences } from "../db/schema";
import { withTenant } from "../db/tenant";
import { eq, and } from "drizzle-orm";

/** The sidebar's sections, in their default order. */
export const NAV_SECTIONS = [
  "home",
  "conversations",
  "tables",
  "knowledge",
  "integrations",
  "inbox",
  "settings",
] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

const navInput = z.object({
  sections: z.array(z.enum(NAV_SECTIONS)).max(NAV_SECTIONS.length).default([]),
  projects: z.array(z.string().uuid()).max(500).default([]),
  agents: z.record(z.string().uuid(), z.array(z.string().max(40)).max(10)).default({}),
});

/** How this person arranged the sidebar in this organization ({} = default order). */
export async function getNavPreferences(
  db: Db,
  tenant: { orgId: string; userId: string },
): Promise<NavPreferences> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({ nav: userPreferences.nav })
      .from(userPreferences)
      .where(and(eq(userPreferences.orgId, tenant.orgId), eq(userPreferences.userId, tenant.userId))),
  );
  return row?.nav ?? {};
}

export async function saveNavPreferences(
  db: Db,
  tenant: { orgId: string; userId: string },
  raw: z.input<typeof navInput>,
) {
  const nav = navInput.parse(raw);
  await withTenant(db, tenant, (tx) =>
    tx
      .insert(userPreferences)
      .values({ orgId: tenant.orgId, userId: tenant.userId, nav })
      .onConflictDoUpdate({ target: [userPreferences.orgId, userPreferences.userId], set: { nav } }),
  );
}

/**
 * `items` in the person's order: those they placed first, in that order,
 * then the rest (new ones) as they came.
 */
export function inOrder<T>(items: T[], key: (item: T) => string, order: string[] | undefined): T[] {
  if (!order?.length) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...items]
    .map((item, i) => ({ item, i, r: rank.get(key(item)) }))
    .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
    .map((x) => x.item);
}

/**
 * The sidebar's sections in the person's order. Sections added to the app
 * after they arranged it go where they are by default (after the section
 * that precedes them), not at the end.
 */
export function sectionOrder(saved: string[] | undefined): NavSection[] {
  const order = (saved ?? []).filter((k): k is NavSection => (NAV_SECTIONS as readonly string[]).includes(k));
  if (!order.length) return [...NAV_SECTIONS];
  for (const [i, key] of NAV_SECTIONS.entries()) {
    if (order.includes(key)) continue;
    const before = NAV_SECTIONS.slice(0, i).findLast((k) => order.includes(k));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key);
  }
  return order;
}
