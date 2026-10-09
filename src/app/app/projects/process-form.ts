import { SALES_MOTIONS, type SalesMotion } from "@/server/db/schema";
import { list, num, str } from "@/server/form";
import { NEXT_STEPS, type NextStep, type PlaybookSpec } from "@/server/playbooks/spec";

const lines = (form: FormData, key: string) =>
  (str(form, key) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function salesMotionFromForm(form: FormData): SalesMotion {
  const motion = str(form, "salesMotion") as SalesMotion;
  if (!SALES_MOTIONS.includes(motion)) throw new Error("Elige un modelo de venta.");
  return motion;
}

/** One main outcome, then the chosen alternatives in catalog order. */
export function nextStepsFromForm(form: FormData): NextStep[] {
  const primary = str(form, "primaryStep") as NextStep | undefined;
  if (!primary || !NEXT_STEPS.includes(primary)) throw new Error("Elige cómo debe terminar la conversación.");
  const alternatives = NEXT_STEPS.filter((s) => s !== primary && list(form, "alternativeSteps").includes(s));
  return [primary, ...alternatives];
}

/** Reads the sales process form. */
export function processFromForm(form: FormData): Partial<PlaybookSpec> {
  return {
    customerType: str(form, "customerType") === "b2c" ? "b2c" : "b2b",
    objective: str(form, "objective") ?? "",
    nextSteps: nextStepsFromForm(form),
    meetingTypeId: str(form, "meetingTypeId"),
    qualification: lines(form, "qualification").map((l) => ({
      criterion: l.replace(/^\*\s*/, ""),
      required: l.startsWith("*"),
    })),
    disqualifiers: lines(form, "disqualifiers"),
    requiredData: lines(form, "requiredData"),
    rules: lines(form, "rules"),
    handoff: lines(form, "handoff"),
    responseTimeMinutes: num(form, "responseTimeMinutes") ?? 15,
  };
}
