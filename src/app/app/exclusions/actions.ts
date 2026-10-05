"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { addSuppression, removeSuppression } from "@/server/services/projects";

export async function addGlobalSuppression(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const type = (str(form, "type") ?? "email") as "email" | "domain" | "phone";
    const values = (str(form, "values") ?? "").split(/[\s,;]+/).filter(Boolean);
    if (values.length === 0) throw new Error("Escribe al menos un valor.");
    for (const value of values) {
      await addSuppression(getDb(), tenant, { projectId: null, type, value, reason: str(form, "reason") });
    }
    return `${values.length} exclusión(es) añadida(s).`;
  });
  revalidatePath("/app/exclusions");
  return result;
}

export async function deleteGlobalSuppression(id: string) {
  const tenant = await requireRole(["owner", "admin"]);
  await removeSuppression(getDb(), tenant, id);
  revalidatePath("/app/exclusions");
}
