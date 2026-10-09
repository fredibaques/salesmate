"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { requireOrgLlm } from "@/server/llm/org-ai";
import { draftPlaybook } from "@/server/playbooks/draft";
import { getProjectProcess } from "@/server/playbooks/service";
import { PLAYBOOK_TEMPLATES, PROCESS_FIELDS, type PlaybookSpec } from "@/server/playbooks/spec";
import { saveProjectProcess } from "@/server/services/agents";
import { processFromForm, salesMotionFromForm } from "../../process-form";

const admin = () => requireRole(["owner", "admin"]);
const refresh = (projectId: string) => revalidatePath(`/app/projects/${projectId}`, "layout");

export async function saveProcess(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const row = await saveProjectProcess(getDb(), tenant, projectId, {
      salesMotion: salesMotionFromForm(form),
      process: processFromForm(form),
      notes: str(form, "notes"),
    });
    return `Proceso guardado (versión ${row.currentVersion}).`;
  });
  refresh(projectId);
  return result;
}

/** Lets the AI propose the process from the project's offer and knowledge, as a new version. */
export async function draftProcess(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const current = await getProjectProcess(db, tenant, projectId);
    const motion = current?.salesMotion ?? "b2b_consultative";
    const { spec, gaps } = await draftPlaybook({ db, llm: await requireOrgLlm(db, tenant) }, tenant, {
      projectId,
      salesMotion: motion,
      current: current?.spec ?? PLAYBOOK_TEMPLATES[motion],
      instructions: str(form, "instructions"),
    });
    const process = Object.fromEntries(PROCESS_FIELDS.map((f) => [f, spec[f]])) as Partial<PlaybookSpec>;
    // Keep the meeting type the user chose: the draft can't know it.
    process.meetingTypeId = current?.spec.meetingTypeId;
    const row = await saveProjectProcess(db, tenant, projectId, {
      salesMotion: motion,
      process,
      notes: `Propuesta de la IA${gaps.length ? `. Falta: ${gaps.join("; ")}` : ""}`,
    });
    return `Propuesta guardada como versión ${row.currentVersion}.${gaps.length ? ` Revisa lo que falta: ${gaps.join(" · ")}` : ""}`;
  });
  refresh(projectId);
  return result;
}
