"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm } from "@/server/form";
import { saveBusinessProfile } from "@/server/services/business";
import { businessFromForm } from "../../projects/profile-form";

/** Saves «Tu negocio»: every project's agents read it. */
export async function saveBusinessAction(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    await saveBusinessProfile(getDb(), await requireRole(["owner", "admin"]), businessFromForm(form));
  }, "Tu negocio, guardado.");
  revalidatePath("/app", "layout");
  return result;
}
