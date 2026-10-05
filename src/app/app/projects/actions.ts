"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { createProject } from "@/server/services/projects";

export async function createProjectAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const project = await createProject(getDb(), tenant, {
      name: str(form, "name") ?? "",
      description: str(form, "description"),
      website: str(form, "website") ?? "",
      timezone: str(form, "timezone") ?? "Europe/Madrid",
      languages: (str(form, "languages") ?? "es")
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    });
    id = project.id;
  });
  if (id) redirect(`/app/projects/${id}`);
  return result;
}
