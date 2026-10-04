"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AGENT_TYPES, SALES_MOTIONS, type AgentType, type SalesMotion } from "@/server/db/schema";
import { list, num, runForm, str } from "@/server/form";
import { getLlm } from "@/server/llm/client";
import { draftPlaybook } from "@/server/playbooks/draft";
import {
  createPlaybook,
  getPlaybook,
  savePlaybookVersion,
  setPlaybookStatus,
} from "@/server/playbooks/service";
import { NEXT_STEPS, type PlaybookSpec } from "@/server/playbooks/spec";

const admin = () => requireRole(["owner", "admin"]);
const lines = (form: FormData, key: string) =>
  (str(form, key) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export async function newPlaybook(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const result = await runForm(async () => {
    const tenant = await admin();
    const motion = str(form, "salesMotion") as SalesMotion;
    if (!SALES_MOTIONS.includes(motion)) throw new Error("Elige un modelo de venta.");
    const agentTypes = list(form, "agentTypes").filter((a): a is AgentType =>
      AGENT_TYPES.includes(a as AgentType),
    );
    const row = await createPlaybook(getDb(), tenant, {
      projectId,
      name: str(form, "name") ?? "Playbook",
      salesMotion: motion,
      agentTypes: agentTypes.length ? agentTypes : ["inbound"],
    });
    id = row.id;
  });
  if (id) redirect(`/app/projects/${projectId}/playbooks/${id}`);
  return result;
}

/** Reads the editor form into a spec. */
function specFromForm(form: FormData): PlaybookSpec {
  const steps = NEXT_STEPS.filter((s) => form.get(`step:${s}`) === "on")
    .map((s) => ({ s, order: num(form, `order:${s}`) ?? 99 }))
    .sort((a, b) => a.order - b.order)
    .map((x) => x.s);
  return {
    objective: str(form, "objective") ?? "",
    customerType: str(form, "customerType") === "b2c" ? "b2c" : "b2b",
    nextSteps: steps,
    segment: {
      include: lines(form, "segmentInclude"),
      exclude: lines(form, "segmentExclude"),
      geography: lines(form, "geography"),
    },
    decisionMakers: lines(form, "decisionMakers"),
    pains: lines(form, "pains"),
    valueProposition: str(form, "valueProposition") ?? "",
    qualification: lines(form, "qualification").map((l) => ({
      criterion: l.replace(/^\*\s*/, ""),
      required: l.startsWith("*"),
    })),
    disqualifiers: lines(form, "disqualifiers"),
    requiredData: lines(form, "requiredData"),
    objections: lines(form, "objections").flatMap((l) => {
      const [objection, ...rest] = l.split("=>");
      const response = rest.join("=>").trim();
      return objection.trim() && response ? [{ objection: objection.trim(), response }] : [];
    }),
    rules: lines(form, "rules"),
    handoff: lines(form, "handoff"),
    tone: str(form, "tone") ?? "",
    signature: str(form, "signature") ?? "",
    meetingTypeId: str(form, "meetingTypeId"),
    responseTimeMinutes: num(form, "responseTimeMinutes") ?? 15,
  };
}

export async function saveVersion(
  projectId: string,
  playbookId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const spec = specFromForm(form);
    if (spec.nextSteps.length === 0) throw new Error("Marca al menos un siguiente paso.");
    const agentTypes = list(form, "agentTypes").filter((a): a is AgentType =>
      AGENT_TYPES.includes(a as AgentType),
    );
    const row = await savePlaybookVersion(getDb(), tenant, playbookId, {
      spec,
      notes: str(form, "notes"),
      name: str(form, "name"),
      agentTypes: agentTypes.length ? agentTypes : undefined,
    });
    return `Guardada la versión ${row.currentVersion}.`;
  });
  revalidatePath(`/app/projects/${projectId}/playbooks`, "layout");
  return result;
}

export async function changeStatus(
  projectId: string,
  playbookId: string,
  status: "draft" | "active" | "archived",
) {
  const tenant = await admin();
  await setPlaybookStatus(getDb(), tenant, playbookId, status);
  revalidatePath(`/app/projects/${projectId}/playbooks`, "layout");
}

export async function aiDraft(
  projectId: string,
  playbookId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const current = await getPlaybook(db, tenant, playbookId);
    if (!current) throw new Error("Playbook no encontrado.");
    const { spec, gaps } = await draftPlaybook({ db, llm: getLlm() }, tenant, {
      projectId,
      salesMotion: current.salesMotion,
      current: current.spec,
      instructions: str(form, "instructions"),
    });
    const saved = await savePlaybookVersion(db, tenant, playbookId, {
      spec,
      notes: `Borrador generado con IA${gaps.length ? `. Falta: ${gaps.join("; ")}` : ""}`,
    });
    return `Borrador guardado como versión ${saved.currentVersion}.${gaps.length ? ` Revisa lo que falta: ${gaps.join(" · ")}` : ""}`;
  });
  revalidatePath(`/app/projects/${projectId}/playbooks`, "layout");
  return result;
}
