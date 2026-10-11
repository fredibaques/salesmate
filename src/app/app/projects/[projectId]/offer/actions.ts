"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { saveProjectAudience } from "@/server/services/business";
import { audienceFromForm } from "../../profile-form";

/** Saves what the project is for and who it's for. */
export async function saveGoal(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await saveProjectAudience(getDb(), tenant, projectId, {
      goal: str(form, "description") ?? "",
      audience: audienceFromForm(form),
    });
  }, "Objetivo guardado.");
  revalidatePath(`/app/projects/${projectId}`, "layout");
  return result;
}
