import { list, listWithOther, pairs, str } from "@/server/form";
import { TONES } from "@/lib/profile-options";
import type { SalesProfile } from "@/server/playbooks/spec";

/** Reads the fields of `ProjectBasicsFields`. */
export function projectFromForm(form: FormData) {
  const languages = list(form, "languages");
  return {
    name: str(form, "name") ?? "",
    description: str(form, "description"),
    website: str(form, "website") ?? "",
    timezone: str(form, "timezone") ?? "Europe/Madrid",
    languages: languages.length ? languages : ["es"],
    color: str(form, "color"),
  };
}

/** Reads the fields of `OfferFields`, `CustomerFields` and `VoiceFields`. */
export function profileFromForm(form: FormData): SalesProfile {
  const preset = str(form, "tonePreset");
  return {
    offer: str(form, "offer") ?? "",
    valueProposition: str(form, "valueProposition") ?? "",
    segment: {
      include: list(form, "segmentInclude")
        .map((v) => v.trim())
        .filter(Boolean),
      exclude: list(form, "segmentExclude")
        .map((v) => v.trim())
        .filter(Boolean),
      geography: listWithOther(form, "geography"),
    },
    decisionMakers: listWithOther(form, "decisionMakers"),
    pains: list(form, "pains")
      .map((v) => v.trim())
      .filter(Boolean),
    fitSignals: list(form, "fitSignals")
      .map((v) => v.trim())
      .filter(Boolean),
    objections: pairs(form, "objection", "objectionResponse").map(([objection, response]) => ({
      objection,
      response,
    })),
    tone: preset === "custom" ? (str(form, "toneCustom") ?? "") : (TONES[Number(preset ?? 0)]?.text ?? ""),
    signature: str(form, "signature") ?? "",
  };
}
