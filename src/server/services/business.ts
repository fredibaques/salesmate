import { eq } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { orgProfiles, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import {
  businessProfileSchema,
  mergeSalesProfile,
  parseBusinessProfile,
  parseProjectAudience,
  projectAudienceSchema,
  type BusinessProfile,
  type SalesProfile,
} from "../playbooks/spec";

/**
 * «Tu negocio» (what is sold, to whom and how to talk, the same for every
 * project) and each project's audience. Agents read both merged.
 */

/** The organization's business profile, or null if it hasn't been described yet. */
export async function getBusinessProfile(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
): Promise<BusinessProfile | null> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select({ profile: orgProfiles.profile }).from(orgProfiles).where(eq(orgProfiles.orgId, tenant.orgId)),
  );
  return row ? parseBusinessProfile(row.profile) : null;
}

export async function saveBusinessProfile(db: Db, tenant: TenantContext, raw: unknown) {
  const profile = businessProfileSchema.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    await tx
      .insert(orgProfiles)
      .values({ orgId: tenant.orgId, profile, updatedBy: tenant.actorId })
      .onConflictDoUpdate({
        target: orgProfiles.orgId,
        set: { profile, updatedBy: tenant.actorId, updatedAt: new Date() },
      });
    await audit(tx, tenant, {
      event: "org.business_profile_updated",
      entityType: "organization",
      entityId: tenant.orgId,
    });
    return profile;
  });
}

/** What a project's agents know of the sale: the business with the project's audience on top. */
export async function salesProfileFor(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectSalesProfile: unknown,
): Promise<SalesProfile> {
  return mergeSalesProfile(await getBusinessProfile(db, tenant), projectSalesProfile);
}

export async function getSalesProfile(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select({ salesProfile: projects.salesProfile }).from(projects).where(eq(projects.id, projectId)),
  );
  if (!row) throw new Error("Proyecto no encontrado.");
  return salesProfileFor(db, tenant, row.salesProfile);
}

/** The project's goal and who it's for. */
export async function getProjectAudience(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({ description: projects.description, salesProfile: projects.salesProfile })
      .from(projects)
      .where(eq(projects.id, projectId)),
  );
  if (!row) throw new Error("Proyecto no encontrado.");
  return { goal: row.description ?? "", audience: parseProjectAudience(row.salesProfile) };
}

export async function saveProjectAudience(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  input: { goal?: string; audience: unknown },
) {
  const audience = projectAudienceSchema.parse(input.audience);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .update(projects)
      .set({
        salesProfile: audience,
        ...(input.goal !== undefined ? { description: input.goal.trim() || null } : {}),
      })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    if (!row) throw new Error("Proyecto no encontrado.");
    await audit(tx, tenant, {
      event: "project.sales_profile_updated",
      projectId,
      entityType: "project",
      entityId: projectId,
    });
    return audience;
  });
}

/** The sale as a project's agents see it, and the business's web (the project's, in older projects). */
export async function projectSales(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  project: { salesProfile: unknown; website: string | null },
): Promise<{ profile: SalesProfile; website: string | null }> {
  const business = await getBusinessProfile(db, tenant);
  return {
    profile: mergeSalesProfile(business, project.salesProfile),
    website: business?.website || project.website || null,
  };
}
