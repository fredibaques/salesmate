import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { invitation, member, organization, user } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";

/**
 * People in an organization. Owners and admins invite people (by link: the
 * invitation's id is its secret), change roles and remove members. Only an
 * owner gives or takes the owner role, and an organization always keeps at
 * least one owner.
 */

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Days an invitation link stays valid. */
export const INVITATION_DAYS = 7;

export type TeamActor = { orgId: string; userId: string; role: OrgRole };

function canManage(actor: TeamActor) {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new Error("Solo quien administra la organización puede gestionar personas.");
  }
}

/** Only an owner hands out or takes away the owner role. */
function checkRoleChange(actor: TeamActor, from: OrgRole | null, to: OrgRole | null) {
  if ((from === "owner" || to === "owner") && actor.role !== "owner") {
    throw new Error("Solo un propietario puede gestionar a otros propietarios.");
  }
}

function parseRole(value: string): OrgRole {
  const role = ORG_ROLES.find((r) => r === value);
  if (!role) throw new Error("Elige un rol.");
  return role;
}

const ctx = (actor: TeamActor) => ({ orgId: actor.orgId, actorType: "user" as const, actorId: actor.userId });

/** Members (with name and email) and pending invitations still valid. */
export async function listTeam(db: Db, orgId: string, now = new Date()) {
  return withSystem(db, async (tx) => {
    const members = await tx
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        since: member.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, orgId))
      .orderBy(asc(member.createdAt));
    const invitations = await tx
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, orgId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, now),
        ),
      )
      .orderBy(asc(invitation.createdAt));
    return { members, invitations };
  });
}

/**
 * Invites someone by email with a role. Inviting the same email again
 * replaces the previous invitation (a fresh link). Returns the invitation id.
 */
export async function inviteMember(
  db: Db,
  actor: TeamActor,
  input: { email: string; role: string },
  now = new Date(),
): Promise<string> {
  canManage(actor);
  const email = z.string().email("Escribe un email válido.").parse(input.email.trim().toLowerCase());
  const role = parseRole(input.role);
  checkRoleChange(actor, null, role);
  const id = await withSystem(db, async (tx) => {
    const [existing] = await tx
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, actor.orgId), sql`lower(${user.email}) = ${email}`));
    if (existing) throw new Error("Esa persona ya está en la organización.");
    await tx
      .update(invitation)
      .set({ status: "canceled" })
      .where(
        and(
          eq(invitation.organizationId, actor.orgId),
          eq(invitation.status, "pending"),
          sql`lower(${invitation.email}) = ${email}`,
        ),
      );
    const id = randomBytes(18).toString("base64url");
    await tx.insert(invitation).values({
      id,
      organizationId: actor.orgId,
      email,
      role,
      status: "pending",
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
      inviterId: actor.userId,
    });
    return id;
  });
  await withTenant(db, ctx(actor), (t) =>
    audit(t, ctx(actor), {
      event: "member.invited",
      entityType: "invitation",
      entityId: id,
      data: { email, role },
    }),
  );
  return id;
}

export async function cancelInvitation(db: Db, actor: TeamActor, invitationId: string) {
  canManage(actor);
  const rows = await withSystem(db, (tx) =>
    tx
      .update(invitation)
      .set({ status: "canceled" })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, actor.orgId),
          eq(invitation.status, "pending"),
        ),
      )
      .returning({ email: invitation.email }),
  );
  if (!rows[0]) throw new Error("La invitación ya no está pendiente.");
  await withTenant(db, ctx(actor), (t) =>
    audit(t, ctx(actor), {
      event: "member.invitation_canceled",
      entityType: "invitation",
      entityId: invitationId,
      data: { email: rows[0].email },
    }),
  );
}

async function findMember(db: Db, orgId: string, memberId: string) {
  const [row] = await withSystem(db, (tx) =>
    tx
      .select({ id: member.id, userId: member.userId, role: member.role, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId))),
  );
  if (!row) throw new Error("Esa persona ya no está en la organización.");
  return { ...row, role: row.role as OrgRole };
}

async function ownerCount(db: Db, orgId: string) {
  const [row] = await withSystem(db, (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"))),
  );
  return Number(row?.n ?? 0);
}

export async function changeMemberRole(db: Db, actor: TeamActor, memberId: string, roleValue: string) {
  canManage(actor);
  const role = parseRole(roleValue);
  const target = await findMember(db, actor.orgId, memberId);
  if (target.role === role) return;
  checkRoleChange(actor, target.role, role);
  if (target.role === "owner" && (await ownerCount(db, actor.orgId)) <= 1) {
    throw new Error("La organización necesita al menos un propietario: nombra otro antes.");
  }
  await withSystem(db, (tx) => tx.update(member).set({ role }).where(eq(member.id, memberId)));
  await withTenant(db, ctx(actor), (t) =>
    audit(t, ctx(actor), {
      event: "member.role_changed",
      entityType: "member",
      entityId: memberId,
      data: { email: target.email, from: target.role, to: role },
    }),
  );
}

export async function removeMember(db: Db, actor: TeamActor, memberId: string) {
  canManage(actor);
  const target = await findMember(db, actor.orgId, memberId);
  if (target.userId === actor.userId) throw new Error("No puedes quitarte a ti mismo.");
  checkRoleChange(actor, target.role, null);
  if (target.role === "owner" && (await ownerCount(db, actor.orgId)) <= 1) {
    throw new Error("La organización necesita al menos un propietario.");
  }
  await withSystem(db, (tx) => tx.delete(member).where(eq(member.id, memberId)));
  await withTenant(db, ctx(actor), (t) =>
    audit(t, ctx(actor), {
      event: "member.removed",
      entityType: "member",
      entityId: memberId,
      data: { email: target.email, role: target.role },
    }),
  );
}

export type InvitationView = {
  id: string;
  email: string;
  role: OrgRole;
  organizationId: string;
  organizationName: string;
  inviterName: string;
  /** Why it can't be accepted; null when it can. */
  problem: "expired" | "used" | null;
};

/** An invitation as its link shows it; null when it doesn't exist. */
export async function getInvitation(db: Db, id: string, now = new Date()): Promise<InvitationView | null> {
  const [row] = await withSystem(db, (tx) =>
    tx
      .select({ inv: invitation, organizationName: organization.name, inviterName: user.name })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .innerJoin(user, eq(user.id, invitation.inviterId))
      .where(eq(invitation.id, id)),
  );
  if (!row) return null;
  return {
    id: row.inv.id,
    email: row.inv.email,
    role: (row.inv.role ?? "member") as OrgRole,
    organizationId: row.inv.organizationId,
    organizationName: row.organizationName,
    inviterName: row.inviterName,
    problem: row.inv.status !== "pending" ? "used" : row.inv.expiresAt <= now ? "expired" : null,
  };
}

/** Pending invitations addressed to an email (to offer them after signing up). */
export async function invitationsFor(db: Db, email: string, now = new Date()) {
  return withSystem(db, (tx) =>
    tx
      .select({ id: invitation.id, organizationName: organization.name, role: invitation.role })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .where(
        and(
          sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, now),
        ),
      ),
  );
}

/**
 * The signed-in person joins with the invitation's role. The invitation must
 * be pending, valid and addressed to their email. Returns the organization id.
 */
export async function acceptInvitation(
  db: Db,
  person: { id: string; email: string },
  invitationId: string,
  now = new Date(),
): Promise<string> {
  const view = await getInvitation(db, invitationId, now);
  if (!view || view.problem === "used") throw new Error("Esta invitación ya no es válida.");
  if (view.problem === "expired")
    throw new Error("Esta invitación ha caducado. Pide que te inviten de nuevo.");
  if (view.email.toLowerCase() !== person.email.toLowerCase()) {
    throw new Error(`Esta invitación es para ${view.email}. Entra con esa cuenta para aceptarla.`);
  }
  await withSystem(db, async (tx) => {
    const taken = await tx
      .update(invitation)
      .set({ status: "accepted" })
      .where(and(eq(invitation.id, invitationId), eq(invitation.status, "pending")))
      .returning({ id: invitation.id });
    if (!taken[0]) throw new Error("Esta invitación ya no es válida.");
    const [already] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, view.organizationId), eq(member.userId, person.id)));
    if (!already) {
      await tx.insert(member).values({
        id: randomUUID(),
        organizationId: view.organizationId,
        userId: person.id,
        role: view.role,
        createdAt: now,
      });
    }
  });
  const actor = { orgId: view.organizationId, actorType: "user" as const, actorId: person.id };
  await withTenant(db, actor, (t) =>
    audit(t, actor, {
      event: "member.joined",
      entityType: "invitation",
      entityId: invitationId,
      data: { email: person.email, role: view.role },
    }),
  );
  return view.organizationId;
}
