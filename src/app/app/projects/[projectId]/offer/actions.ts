"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { requireOrgLlm } from "@/server/llm/org-ai";
import { draftPlaybook } from "@/server/playbooks/draft";
import { activePlaybookFor } from "@/server/playbooks/service";
import { PLAYBOOK_TEMPLATES } from "@/server/playbooks/spec";
import { withTenant } from "@/server/db/tenant";
import { getSalesProfile, saveSalesProfile } from "@/server/services/agents";
import { profileFromForm } from "../../profile-form";

const admin = () => requireRole(["owner", "admin"]);
export async function saveOffer(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await saveSalesProfile(getDb(), tenant, projectId, profileFromForm(form));
  });
  revalidatePath(`/app/projects/${projectId}`, "layout");
  return result;
}

/** Lets the AI fill the shared profile from the project's description and knowledge. */
export async function draftOffer(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const current = await getSalesProfile(db, tenant, projectId);
    const process = await withTenant(db, tenant, (tx) => activePlaybookFor(tx, projectId, "inbound"));
    const motion = process?.salesMotion ?? "b2b_consultative";
    const { spec, gaps } = await draftPlaybook({ db, llm: await requireOrgLlm(db, tenant) }, tenant, {
      projectId,
      salesMotion: motion,
      current: {
        ...(process?.spec ?? PLAYBOOK_TEMPLATES[motion]),
        valueProposition: current.valueProposition,
        segment: current.segment,
        decisionMakers: current.decisionMakers,
        pains: current.pains,
        objections: current.objections,
        tone: current.tone,
        signature: current.signature,
      },
      instructions: str(form, "instructions"),
    });
    await saveSalesProfile(db, tenant, projectId, {
      ...current,
      valueProposition: spec.valueProposition,
      segment: spec.segment,
      decisionMakers: spec.decisionMakers,
      pains: spec.pains,
      objections: spec.objections,
      tone: spec.tone,
    });
    return `Propuesta aplicada. Revísala y guarda los cambios que hagas.${gaps.length ? ` Falta: ${gaps.join(" · ")}` : ""}`;
  });
  revalidatePath(`/app/projects/${projectId}`, "layout");
  return result;
}
