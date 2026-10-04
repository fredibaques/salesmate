import { describe, expect, it } from "vitest";
import { leadFromForm, looksAutomated, stripQuotedReply } from "./leads";

describe("leadFromForm", () => {
  it("recognises common Spanish and English field names and keeps the rest", () => {
    const lead = leadFromForm({
      "Nombre completo": "Pedro Gómez Ruiz",
      "Correo electrónico": "pedro@x.com",
      Teléfono: "+34 600 000 000",
      Empresa: "Gómez SL",
      Mensaje: "Quiero información",
      "Número de vehículos": "12",
      _gotcha: "",
      acepto: "on",
    });
    expect(lead).toMatchObject({
      firstName: "Pedro",
      lastName: "Gómez Ruiz",
      email: "pedro@x.com",
      phone: "+34 600 000 000",
      companyName: "Gómez SL",
      body: "Quiero información",
      consent: true,
      extra: { "Número de vehículos": "12" },
    });
  });
});

describe("email helpers", () => {
  it("strips quoted replies", () => {
    expect(
      stripQuotedReply("Perfecto, el martes.\n\nOn Mon, 5 Oct 2026 at 10:00, Ana <a@x.com> wrote:\n> Hola"),
    ).toBe("Perfecto, el martes.");
  });

  it("detects automated messages", () => {
    const base = leadFromForm({ email: "a@x.com" });
    expect(looksAutomated({ ...base, subject: "Out of Office: vacaciones" })).toBe(true);
    expect(looksAutomated({ ...base, email: "no-reply@x.com" })).toBe(true);
    expect(looksAutomated(base)).toBe(false);
  });
});
