"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { orgLlm } from "@/server/llm/org-ai";
import { importMeetTranscript, retryMeetingTranscript } from "@/server/meetings/service";

const editor = () => requireRole(["owner", "admin"]);

const deps = () => {
  const db = getDb();
  return { db, llmFor: (orgId: string) => orgLlm(db, { orgId }) };
};

/** Brings the transcript of a Meet call by its link. */
export async function importMeetAction(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await editor();
    const meeting = await importMeetTranscript(deps(), tenant, {
      projectId,
      url: str(form, "url") ?? "",
      title: str(form, "title"),
    });
    return meeting.summary
      ? `Transcripción de «${meeting.title}» añadida y resumida.`
      : `Transcripción de «${meeting.title}» añadida.`;
  });
  revalidatePath(`/app/projects/${projectId}/meetings`);
  return result;
}

/** Looks for a meeting's transcript now. */
export async function retryTranscriptAction(
  projectId: string,
  meetingId: string,
  _: FormState,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await editor();
    const meeting = await retryMeetingTranscript(deps(), tenant, meetingId);
    if (meeting.transcriptStatus === "ready") return "Transcripción encontrada.";
    if (meeting.transcriptStatus === "waiting") return "Aún no está: volveremos a mirar en unos minutos.";
    // The reason shows on the page.
    return "Buscada de nuevo, sin transcripción.";
  });
  revalidatePath(`/app/projects/${projectId}/meetings`, "layout");
  return result;
}
