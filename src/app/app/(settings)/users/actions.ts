"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { cancelInvitation, changeMemberRole, inviteMember, removeMember } from "@/server/services/team";

const USERS_PAGE = "/app/users";

export async function inviteMemberAction(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await inviteMember(getDb(), tenant, {
      email: str(form, "email") ?? "",
      role: str(form, "role") ?? "member",
    });
    return "Invitación creada. Copia su enlace y envíaselo.";
  });
  revalidatePath(USERS_PAGE);
  return result;
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
