"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { FormState } from "@/components/action-form";
import { getAuth } from "@/server/auth/auth";
import { requireRole, requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { organization } from "@/server/db/schema";
import { bool, runForm, str } from "@/server/form";

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    await requireTenant();
    const name = str(form, "name");
    if (!name || name.length < 2) throw new Error("Escribe tu nombre.");
    await getAuth().api.updateUser({ headers: await headers(), body: { name } });
  }, "Perfil guardado.");
  revalidatePath("/app", "layout");
  return result;
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    await requireTenant();
    const currentPassword = str(form, "currentPassword") ?? "";
    const newPassword = str(form, "newPassword") ?? "";
    if (newPassword.length < 10) throw new Error("La contraseña nueva necesita al menos 10 caracteres.");
    if (newPassword !== str(form, "confirmPassword"))
      throw new Error("Las dos contraseñas nuevas no coinciden.");
    try {
      await getAuth().api.changePassword({
        headers: await headers(),
        body: { currentPassword, newPassword, revokeOtherSessions: bool(form, "revokeOthers") },
      });
    } catch {
      throw new Error("La contraseña actual no es correcta.");
    }
  }, "Contraseña cambiada.");
}

export async function signOutOtherSessions(_: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    await requireTenant();
    await getAuth().api.revokeOtherSessions({ headers: await headers() });
  }, "Has cerrado la sesión en los demás dispositivos.");
  revalidatePath("/app/account/security");
  return result;
}

export async function renameOrganization(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const name = str(form, "name");
    if (!name || name.length < 2) throw new Error("Escribe el nombre de la organización.");
    await getDb().update(organization).set({ name }).where(eq(organization.id, tenant.orgId));
  }, "Organización guardada.");
  revalidatePath("/app", "layout");
  return result;
}
