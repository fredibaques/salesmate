import type { SalesProfile } from "../playbooks/spec";

/**
 * The fit of a row is not a number the model makes up: the agent checks
 * each criterion of the project's ideal customer (Ventas → Oferta y cliente)
 * against what it found, and the score is computed from those checks.
 */

export const FIT_RESULTS = ["yes", "no", "unknown"] as const;
export type FitResult = (typeof FIT_RESULTS)[number];

export type FitCriterion = {
  /** Short reference the model answers with (c1, c2…). */
  id: string;
  criterion: string;
  /** A «no» here caps the score: it is not a customer. */
  required: boolean;
};

export type FitCheck = { criterion: string; required: boolean; result: FitResult };

const or = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} o ${items.at(-1)}` : items[0];

/** The criteria of the fit, from the project's customer profile; empty when it has none. */
export function fitCriteria(profile: SalesProfile): FitCriterion[] {
  const out: Omit<FitCriterion, "id">[] = [];
  const { include, exclude, geography } = profile.segment;
  if (include.length) out.push({ criterion: `Es ${or(include)}`, required: true });
  if (geography.length) out.push({ criterion: `Está en ${or(geography)}`, required: true });
  if (exclude.length) out.push({ criterion: `No es ${or(exclude)}`, required: true });
  for (const signal of profile.fitSignals) out.push({ criterion: signal, required: false });
  return out.map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

/** Highest score a row can get when it fails a required criterion. */
export const FAILED_REQUIRED_CAP = 20;

/**
 * 0-100 from the checks: a criterion met counts in full, one that couldn't be
 * checked counts half, one not met counts nothing; required criteria weigh
 * double, and failing one caps the score.
 */
export function scoreFit(checks: FitCheck[]): number | null {
  if (checks.length === 0) return null;
  let total = 0;
  let got = 0;
  for (const c of checks) {
    const weight = c.required ? 2 : 1;
    total += weight;
    got += weight * (c.result === "yes" ? 1 : c.result === "unknown" ? 0.5 : 0);
  }
  const score = Math.round((100 * got) / total);
  return checks.some((c) => c.required && c.result === "no") ? Math.min(score, FAILED_REQUIRED_CAP) : score;
}

/** The checks of a row from the model's answers by criterion id (missing = unknown). */
export function fitChecksFrom(
  criteria: FitCriterion[],
  answers: Record<string, unknown> | undefined,
): FitCheck[] {
  return criteria.map((c) => {
    const raw = answers?.[c.id];
    const result = FIT_RESULTS.find((r) => r === raw) ?? "unknown";
    return { criterion: c.criterion, required: c.required, result };
  });
}

/** The «Encaje» section of the prospecting agent's prompt. */
export function fitPrompt(criteria: FitCriterion[]): string {
  if (criteria.length === 0) {
    return "## Encaje\nEl proyecto todavía no ha definido criterios de cliente ideal: pon un fitScore orientativo (0-100) y explica en fitReason en qué te basas.";
  }
  return [
    "## Encaje",
    "Para cada fila nueva, marca en `fit` cada uno de estos criterios según lo que hayas comprobado en las fuentes: «yes» si lo cumple, «no» si no, «unknown» si no lo has podido comprobar. No supongas: lo que no veas publicado es «unknown». El número de encaje lo calculamos a partir de tus respuestas. En fitReason, en una frase, lo que más pesa.",
    criteria.map((c) => `- ${c.id}: ${c.criterion}${c.required ? " (imprescindible)" : ""}`).join("\n"),
    "No guardes filas que no cumplan un criterio imprescindible.",
  ].join("\n");
}
