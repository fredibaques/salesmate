import { describe, expect, it } from "vitest";
import { columnDraft, optionColor } from "./prospect-columns";

describe("option colours", () => {
  it("keeps the chosen colours of the choices the column has, and colours the rest by place", () => {
    const column = columnDraft.parse({
      name: "Tipo",
      type: "select",
      options: ["Multimarca", "Oficial", "Compraventa"],
      optionColors: { Oficial: "azul", Antigua: "rojo" },
    });
    expect(column.optionColors).toEqual({ Oficial: "azul" });
    expect(optionColor(column, "Oficial")).toBe("azul");
    expect(optionColor(column, "Multimarca")).toBe("rojo");
    expect(optionColor(column, "Compraventa")).toBe("amarillo");
    expect(optionColor(column, "Otra")).toBe("gris");
    // A text column has no choices, nor colours.
    expect(
      columnDraft.parse({ name: "Nota", type: "text", optionColors: { a: "rosa" } }).optionColors,
    ).toBeUndefined();
  });
});
