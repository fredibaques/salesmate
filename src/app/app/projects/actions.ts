"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { getBusinessProfile, saveBusinessProfile, saveProjectAudience } from "@/server/services/business";
import { createProject } from "@/server/services/projects";
import { audienceFromForm, businessFromForm, projectFromForm } from "./profile-form";

/** Creates a project with what the creation wizard collected and opens it. */
export async function createProjectAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const db = getDb();
    // The first project also describes the business (unless someone did meanwhile).
    if (str(form, "withBusiness") && !(await getBusinessProfile(db, tenant))?.offer)
      await saveBusinessProfile(db, tenant, businessFromForm(form));
    const project = await createProject(db, tenant, projectFromForm(form));
    await saveProjectAudience(db, tenant, project.id, { audience: audienceFromForm(form) });
    id = project.id;
  });
  if (id) {
    // The sidebar lists the projects: refresh it along with the page.
    revalidatePath("/app", "layout");
    redirect(`/app/projects/${id}`);
  }
  return result;
}
