import "server-only";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db/client";
import { member, organization, session } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { getAuth } from "./auth";

export type OrgRole = "owner" | "admin" | "member";

export type CurrentTenant = TenantContext & {
  actorType: "user";
  actorId: string;
  userId: string;
  role: OrgRole;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string };
};

export const getSession = cache(async () => getAuth().api.getSession({ headers: await headers() }));

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Resolves the signed-in user and their active organization (the tenant).
 * Picks the first membership when none is active; sends users without an
 * organization to onboarding.
 */
export const requireTenant = cache(async (): Promise<CurrentTenant> => {
  const session = await requireUser();
  const db = getDb();
  let orgId = session.session.activeOrganizationId ?? null;

  const memberships = await db
    .select({ orgId: member.organizationId, role: member.role, org: organization })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, session.user.id));
  if (memberships.length === 0) redirect("/onboarding");

  let current = memberships.find((m) => m.orgId === orgId);
  if (!current) {
    current = memberships[0];
    orgId = current.orgId;
    await getAuth().api.setActiveOrganization({ headers: await headers(), body: { organizationId: orgId } });
  }

  return {
    orgId: current.orgId,
    actorType: "user",
    actorId: session.user.id,
    userId: session.user.id,
    role: current.role as OrgRole,
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    organization: { id: current.org.id, name: current.org.name, slug: current.org.slug },
  };
});

/** Throws when the current member lacks one of the roles (use inside server actions). */
export async function requireRole(roles: OrgRole[]): Promise<CurrentTenant> {
  const tenant = await requireTenant();
  if (!roles.includes(tenant.role)) throw new Error("No tienes permiso para esta acción.");
  return tenant;
}

export async function listMemberships(userId: string) {
  return getDb()
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId)));
}

/** The person's signed-in devices (sessions that haven't expired), the most recently used first. */
export async function listOwnSessions(userId: string) {
  return getDb()
    .select({
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      updatedAt: session.updatedAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt));
}

/** Signs the person out everywhere but here. */
export async function revokeOtherOwnSessions(userId: string, currentSessionId: string) {
  await getDb()
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, currentSessionId)));
}
