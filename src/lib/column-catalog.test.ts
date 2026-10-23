import { describe, expect, it } from "vitest";
import { columnCatalog } from "./column-catalog";

describe("the column catalogue", () => {
  it("offers a person's company and its web as the table's own fields", () => {
    const company = columnCatalog("person").find((g) => g.title === "Su empresa")!;
    expect(company.columns.slice(0, 2).map((c) => [c.name, c.field])).toEqual([
      ["Empresa", "company"],
      ["Web", "web"],
    ]);
    expect(company.columns.some((c) => c.name === "Razón social")).toBe(true);
  });

  it("doesn't offer them in a table of companies, where each row is the company", () => {
    expect(
      columnCatalog("company")
        .flatMap((g) => g.columns)
        .some((c) => c.field),
    ).toBe(false);
  });
});
