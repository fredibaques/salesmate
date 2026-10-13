"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { list, runForm, str } from "@/server/form";
import { setInvitationProjects, setMemberProjects } from "@/server/services/access";
import { env } from "@/server/env";
import { mailConfigured } from "@/server/mail";
import {
  cancelInvitation,
  changeMemberRole,
  emailInvitation,
  inviteMember,
  removeMember,
} from "@/server/services/team";
import type { CurrentTenant } from "@/server/auth/session";

const asActor = (tenant: CurrentTenant) => ({
  orgId: tenant.orgId,
  userId: tenant.userId,
  role: tenant.role,
  name: tenant.user.name,
  organizationName: tenant.organization.name,
});

const USERS_PAGE = "/app/users";

export async function inviteMemberAction(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const db = getDb();
    const role = str(form, "role") ?? "member";
    const id = await inviteMember(db, tenant, { email: str(form, "email") ?? "", role });
    // A member sees only the projects shared with them; owners and admins, all.
    if (role === "member") await setInvitationProjects(db, tenant.orgId, id, list(form, "projects"));
    if (!mailConfigured()) return "Invitación creada. Copia su enlace y envíaselo.";
    try {
      const email = await emailInvitation(db, asActor(tenant), id, { appUrl: env().APP_URL });
      return `Invitación enviada a ${email}.`;
    } catch (err) {
      return `Invitación creada, pero el email no ha salido (${err instanceof Error ? err.message : String(err)}). Copia su enlace y envíaselo.`;
    }
  });
  revalidatePath(USERS_PAGE);
  return result;
}

/** The projects a member sees. */
export async function setMemberProjectsAction(
  userId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    await setMemberProjects(getDb(), await requireRole(["owner", "admin"]), userId, list(form, "projects"));
  }, "Proyectos guardados.");
  revalidatePath("/app", "layout");
  return result;
}

/** «Reenviar»: emails the invitation's link again. */
export async function resendInvitationAction(invitationId: string, _: FormState): Promise<FormState> {
  return runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const email = await emailInvitation(getDb(), asActor(tenant), invitationId, { appUrl: env().APP_URL });
    return `Invitación reenviada a ${email}.`;
  });
}

export async function cancelInvitationAction(invitationId: string, _: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await cancelInvitation(getDb(), tenant, invitationId);
  }, "Invitación cancelada.");
  revalidatePath(USERS_PAGE);
  return result;
}

export async function changeMemberRoleAction(
  memberId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await changeMemberRole(getDb(), tenant, memberId, str(form, "role") ?? "");
  }, "Rol guardado.");
  revalidatePath(USERS_PAGE);
  return result;
}

export async function removeMemberAction(memberId: string, _: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await removeMember(getDb(), tenant, memberId);
  }, "Ya no forma parte de la organización.");
  revalidatePath(USERS_PAGE);
  return result;
}
