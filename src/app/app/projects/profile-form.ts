import { list, listWithOther, pairs, str } from "@/server/form";
import { TONES } from "@/lib/profile-options";
import type { BusinessProfile, ProjectAudience } from "@/server/playbooks/spec";

const lines = (form: FormData, name: string) =>
  list(form, name)
    .map((v) => v.trim())
    .filter(Boolean);

/** Reads the fields of `ProjectBasicsFields` (and the goal, when the form has it). */
export function projectFromForm(form: FormData) {
  const languages = list(form, "languages");
  return {
    name: str(form, "name") ?? "",
    description: str(form, "description"),
    timezone: str(form, "timezone") ?? "Europe/Madrid",
    languages: languages.length ? languages : ["es"],
    color: str(form, "color"),
  };
}

/** Reads the audience in `GoalFields`. */
export function audienceFromForm(form: FormData): ProjectAudience {
  return {
    segment: {
      include: lines(form, "audienceInclude"),
      exclude: lines(form, "audienceExclude"),
      geography: listWithOther(form, "geography"),
    },
  };
}

/** Reads the fields of `OfferFields`, `CustomerFields` and `VoiceFields` («Tu negocio»). */
export function businessFromForm(form: FormData): BusinessProfile {
  const preset = str(form, "tonePreset");
  return {
    website: str(form, "website") ?? "",
    offer: str(form, "offer") ?? "",
    valueProposition: str(form, "valueProposition") ?? "",
    segment: { include: lines(form, "segmentInclude"), exclude: lines(form, "segmentExclude") },
    decisionMakers: listWithOther(form, "decisionMakers"),
    pains: lines(form, "pains"),
    objections: pairs(form, "objection", "objectionResponse").map(([objection, response]) => ({
      objection,
      response,
    })),
    tone: preset === "custom" ? (str(form, "toneCustom") ?? "") : (TONES[Number(preset ?? 0)]?.text ?? ""),
    signature: str(form, "signature") ?? "",
  };
}
