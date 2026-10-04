import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { inferTable, parseDate, parseNumber, parseTabularFile } from "./tabular";

describe("number and date parsing", () => {
  it("understands Spanish and English formats", () => {
    expect(parseNumber("1.234,56 €", true)).toBe(1234.56);
    expect(parseNumber("12,5%", true)).toBe(12.5);
    expect(parseNumber("1,234.56", false)).toBe(1234.56);
    expect(parseNumber("49", false)).toBe(49);
    expect(parseNumber("abc", false)).toBeNull();
    expect(parseNumber("1.2.3", false)).toBeNull();
  });

  it("normalizes dates to ISO", () => {
    expect(parseDate("31/12/2026")).toBe("2026-12-31");
    expect(parseDate("2026-01-05T10:00:00Z")).toBe("2026-01-05");
    expect(parseDate("13/13/2026")).toBeNull();
  });
});

describe("inferTable", () => {
  it("types columns and keys them by slug", () => {
    const table = inferTable({
      name: "Tarifas",
      headers: ["Servicio", "Precio (€)", "Precio (€)", "Activo", "Desde"],
      rows: [
        ["Básico", "49,90", "1.200,00", "sí", "01/01/2026"],
        ["Pro", "99", "2.400,50", "no", "15/03/2026"],
        ["", "", "", "", ""],
      ],
    });
    expect(table.columns).toEqual([
      { key: "servicio", label: "Servicio", type: "text" },
      { key: "precio", label: "Precio (€)", type: "number" },
      { key: "precio_2", label: "Precio (€)", type: "number" },
      { key: "activo", label: "Activo", type: "boolean" },
      { key: "desde", label: "Desde", type: "date" },
    ]);
    expect(table.rows).toEqual([
      { servicio: "Básico", precio: 49.9, precio_2: 1200, activo: true, desde: "2026-01-01" },
      { servicio: "Pro", precio: 99, precio_2: 2400.5, activo: false, desde: "2026-03-15" },
    ]);
  });

  it("falls back to text when values are mixed", () => {
    const table = inferTable({ name: "t", headers: ["Código"], rows: [["12"], ["A-7"]] });
    expect(table.columns[0].type).toBe("text");
    expect(table.rows).toEqual([{ codigo: "12" }, { codigo: "A-7" }]);
  });
});

describe("parseTabularFile", () => {
  it("reads CSV with BOM", async () => {
    const csv = "﻿Nombre,Importe\nA,10\nB,20\n";
    const [sheet] = await parseTabularFile(Buffer.from(csv), "precios.csv");
    expect(sheet).toEqual({
      name: "precios",
      headers: ["Nombre", "Importe"],
      rows: [
        ["A", "10"],
        ["B", "20"],
      ],
    });
  });

  it("reads every sheet of an XLSX workbook, including formulas and dates", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Tarifas");
    ws.addRow(["Plan", "Precio", "Total", "Alta"]);
    ws.addRow(["Básico", 10, { formula: "B2*2", result: 20 }, new Date(Date.UTC(2026, 0, 2))]);
    wb.addWorksheet("Vacía");
    const buffer = await wb.xlsx.writeBuffer();
    const sheets = await parseTabularFile(buffer as ArrayBuffer, "libro.xlsx");
    expect(sheets).toHaveLength(1);
    const table = inferTable(sheets[0]);
    expect(table.rows).toEqual([{ plan: "Básico", precio: 10, total: 20, alta: "2026-01-02" }]);
  });
});
