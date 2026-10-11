import { describe, expect, it } from "vitest";
import { TONES } from "@/lib/profile-options";
import { audienceFromForm, businessFromForm, projectFromForm } from "./profile-form";

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("businessFromForm", () => {
  it("reads lists, chips with «Otros», objection pairs and a preset tone", () => {
    const profile = businessFromForm(
      form([
        ["offer", "Transferencias en 24 h"],
        ["segmentInclude", "Concesionarios"],
        ["segmentInclude", "  "],
        ["segmentInclude", "Compraventas"],
        ["decisionMakers", "Compras"],
        ["decisionMakersOther", ""],
        ["objection", "Es caro"],
        ["objectionResponse", "Ahorras tres días por operación"],
        ["objection", "Ya tenemos gestor"],
        ["objectionResponse", ""],
        ["tonePreset", "1"],
      ]),
    );
    expect(profile.offer).toBe("Transferencias en 24 h");
    expect(profile.segment.include).toEqual(["Concesionarios", "Compraventas"]);
    expect(profile.decisionMakers).toEqual(["Compras"]);
    // A row without an answer is not an objection the agents can use.
    expect(profile.objections).toEqual([
      { objection: "Es caro", response: "Ahorras tres días por operación" },
    ]);
    expect(profile.tone).toBe(TONES[1].text);
  });

  it("keeps a custom tone as written", () => {
    const profile = businessFromForm(
      form([
        ["tonePreset", "custom"],
        ["toneCustom", "Con humor"],
      ]),
    );
    expect(profile.tone).toBe("Con humor");
  });
});

describe("audienceFromForm", () => {
  it("reads who the project is for, with zones and «Otros»", () => {
    expect(
      audienceFromForm(
        form([
          ["audienceInclude", "Concesionarios"],
          ["audienceInclude", " "],
          ["geography", "Península"],
          ["geographyOther", "Andorra, Península"],
        ]),
      ),
    ).toEqual({ segment: { include: ["Concesionarios"], exclude: [], geography: ["Península", "Andorra"] } });
  });
});

describe("projectFromForm", () => {
  it("reads the chosen languages and falls back to Spanish", () => {
    expect(
      projectFromForm(
        form([
          ["name", "A"],
          ["languages", "es"],
          ["languages", "ca"],
        ]),
      ).languages,
    ).toEqual(["es", "ca"]);
    expect(projectFromForm(form([["name", "A"]])).languages).toEqual(["es"]);
  });
});
