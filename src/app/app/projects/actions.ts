"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm } from "@/server/form";
import { saveSalesProfile } from "@/server/services/agents";
import { createProject } from "@/server/services/projects";
import { profileFromForm, projectFromForm } from "./profile-form";

/** Creates a project with what the creation wizard collected and opens it. */
export async function createProjectAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const db = getDb();
    const project = await createProject(db, tenant, projectFromForm(form));
    await saveSalesProfile(db, tenant, project.id, profileFromForm(form));
    id = project.id;
  });
  if (id) {
    // The sidebar lists the projects: refresh it along with the page.
    revalidatePath("/app", "layout");
    redirect(`/app/projects/${id}`);
  }
  return result;
}
