import { describe, expect, it } from "vitest";
import { salesProfileSchema } from "../playbooks/spec";
import { fitChecksFrom, fitCriteria, fitPrompt, scoreFit } from "./fit";

const profile = salesProfileSchema.parse({
  segment: {
    include: ["Concesionarios", "Compraventas"],
    geography: ["Andalucía"],
    exclude: ["Particulares"],
  },
  fitSignals: ["Vende coches de ocasión", "Más de 20 coches en stock"],
});

describe("fit", () => {
  it("takes its criteria from the ideal customer: segment, zone and exclusions are required", () => {
    expect(fitCriteria(profile)).toEqual([
      { id: "c1", criterion: "Es Concesionarios o Compraventas", required: true },
      { id: "c2", criterion: "Está en Andalucía", required: true },
      { id: "c3", criterion: "No es Particulares", required: true },
      { id: "c4", criterion: "Vende coches de ocasión", required: false },
      { id: "c5", criterion: "Más de 20 coches en stock", required: false },
    ]);
    expect(fitCriteria(salesProfileSchema.parse({}))).toEqual([]);
  });

  it("scores the checks: met in full, unknown half, required double", () => {
    const criteria = fitCriteria(profile);
    // 2+2+2 required met, one signal met, one unknown: (6 + 1 + 0.5) / 8
    const checks = fitChecksFrom(criteria, { c1: "yes", c2: "yes", c3: "yes", c4: "yes", c5: "unknown" });
    expect(scoreFit(checks)).toBe(94);
    // Everything unknown is a middle score, not a guess.
    expect(scoreFit(fitChecksFrom(criteria, {}))).toBe(50);
    // Answers it doesn't understand count as unknown.
    expect(fitChecksFrom(criteria, { c1: "probably" })[0].result).toBe("unknown");
  });

  it("caps the score when a required criterion fails", () => {
    const checks = fitChecksFrom(fitCriteria(profile), {
      c1: "yes",
      c2: "no",
      c3: "yes",
      c4: "yes",
      c5: "yes",
    });
    expect(scoreFit(checks)).toBe(20);
    expect(scoreFit([])).toBeNull();
  });

  it("tells the agent to check each criterion, or to estimate when there are none", () => {
    expect(fitPrompt(fitCriteria(profile))).toContain("- c2: Está en Andalucía (imprescindible)");
    expect(fitPrompt([])).toContain("fitScore orientativo");
  });
});
