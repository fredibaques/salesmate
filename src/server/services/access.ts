import { and, asc, eq, inArray } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { invitationProjects, member, projectMembers, projects, user } from "../db/schema";
import { withSystem, withTenant, type TenantContext, type Tx } from "../db/tenant";

/**
 * Who sees which project. Owners and admins see every project of the
 * organization; a member («Miembro») only the projects shared with them
 * (`project_members`). Tables without a project are the organization's and
 * everyone sees them, unless they are shared with some projects only.
 */

export type AccessActor = { orgId: string; userId: string; role: string };

export const seesAllProjects = (actor: { role: string }) => actor.role === "owner" || actor.role === "admin";

/** The projects this person can open, or null for «all of them». */
export async function visibleProjectIds(db: Db, actor: AccessActor): Promise<string[] | null> {
  if (seesAllProjects(actor)) return null;
  const rows = await withTenant(db, actor, (tx) =>
    tx
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, actor.userId)),
  );
  return rows.map((r) => r.projectId);
}

/** Whether a set of visible projects (null = all) includes this one; no project means the organization's. */
export const canSee = (visible: string[] | null, projectId: string | null | undefined) =>
  visible === null || !projectId || visible.includes(projectId);

/**
 * Whether a person sees a table: one project's, if they see that project;
 * one shared with some projects, if they see any of them; the whole
 * account's, always.
 */
export const canSeeBase = (
  visible: string[] | null,
  base: { projectId: string | null; projectIds?: string[] },
) =>
  base.projectId || !base.projectIds?.length
    ? canSee(visible, base.projectId)
    : visible === null || base.projectIds.some((id) => visible.includes(id));

/** The organization's members and whether each one has the project (owners and admins always do). */
export async function projectPeople(db: Db, orgId: string, projectId: string) {
  return withSystem(db, async (tx) => {
    const people = await tx
      .select({ userId: member.userId, role: member.role, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, orgId))
      .orderBy(asc(user.name));
    const shared = new Set(
      (
        await tx
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(and(eq(projectMembers.orgId, orgId), eq(projectMembers.projectId, projectId)))
      ).map((r) => r.userId),
    );
    return people.map((p) => ({ ...p, access: seesAllProjects(p) || shared.has(p.userId) }));
  });
}

/** Shares the project with exactly these members (owners and admins see it anyway). */
export async function setProjectPeople(
  db: Db,
  actor: TenantContext & { role: string },
  projectId: string,
  userIds: string[],
) {
  if (!seesAllProjects(actor)) throw new Error("Solo quien administra la organización comparte proyectos.");
  const people = await projectPeople(db, actor.orgId, projectId);
  const members = new Set(people.filter((p) => !seesAllProjects(p)).map((p) => p.userId));
  const wanted = [...new Set(userIds)].filter((id) => members.has(id));
  await withTenant(db, actor, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) throw new Error("Proyecto no encontrado.");
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    if (wanted.length) {
      await tx
        .insert(projectMembers)
        .values(
          wanted.map((userId) => ({ projectId, userId, orgId: actor.orgId, createdBy: actor.actorId })),
        );
    }
    await audit(tx, actor, {
      event: "project.shared",
      projectId,
      entityType: "project",
      entityId: projectId,
      data: { members: wanted.length },
    });
  });
  return wanted.length;
}

/** Projects to share with someone when they accept the invitation. */
export async function setInvitationProjects(
  db: Db,
  orgId: string,
  invitationId: string,
  projectIds: string[],
) {
  await withTenant(db, { orgId }, async (tx) => {
    const valid = projectIds.length
      ? (
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.id, [...new Set(projectIds)]))
        ).map((p) => p.id)
      : [];
    await tx.delete(invitationProjects).where(eq(invitationProjects.invitationId, invitationId));
    if (valid.length)
      await tx
        .insert(invitationProjects)
        .values(valid.map((projectId) => ({ invitationId, projectId, orgId })));
  });
}

/** On joining: the projects the invitation shared become theirs (inside the accepting transaction). */
export async function grantInvitationProjects(tx: Tx, invitationId: string, userId: string) {
  const rows = await tx
    .select()
    .from(invitationProjects)
    .where(eq(invitationProjects.invitationId, invitationId));
  if (rows.length) {
    await tx
      .insert(projectMembers)
      .values(rows.map((r) => ({ projectId: r.projectId, userId, orgId: r.orgId })))
      .onConflictDoNothing();
  }
}

/** Shares exactly these projects with one member (owners and admins see them all anyway). */
export async function setMemberProjects(
  db: Db,
  actor: TenantContext & { role: string },
  userId: string,
  projectIds: string[],
) {
  if (!seesAllProjects(actor)) throw new Error("Solo quien administra la organización comparte proyectos.");
  await withTenant(db, actor, async (tx) => {
    const valid = projectIds.length
      ? (
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.id, [...new Set(projectIds)]))
        ).map((p) => p.id)
      : [];
    await tx.delete(projectMembers).where(eq(projectMembers.userId, userId));
    if (valid.length)
      await tx
        .insert(projectMembers)
        .values(
          valid.map((projectId) => ({ projectId, userId, orgId: actor.orgId, createdBy: actor.actorId })),
        );
    await audit(tx, actor, {
      event: "member.projects_changed",
      entityType: "user",
      entityId: userId,
      data: { projects: valid.length },
    });
  });
}

/** The projects shared with each member of the organization, by user id. */
export async function sharedProjectsByUser(db: Db, orgId: string): Promise<Map<string, string[]>> {
  const rows = await withTenant(db, { orgId }, (tx) =>
    tx.select({ userId: projectMembers.userId, projectId: projectMembers.projectId }).from(projectMembers),
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.projectId]);
  return out;
}
