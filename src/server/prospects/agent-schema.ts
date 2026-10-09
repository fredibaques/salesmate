import { FIT_RESULTS, type FitCriterion } from "./fit";
import { COLUMN_TYPE_LABELS, formatCell, type BaseColumn, type RowKind } from "@/lib/prospect-columns";

/**
 * What an agent sees of a base: the JSON Schema of the rows it saves
 * (system fields plus one property per column it fills) and the prompt
 * section that explains each column.
 */

/** Columns the agent fills: the ones not reserved for people. */
export function agentColumns(columns: BaseColumn[]) {
  return columns.filter((c) => c.filledBy !== "person");
}

function columnSchema(column: BaseColumn): Record<string, unknown> {
  const description = [column.name, column.instructions].filter(Boolean).join(": ");
  switch (column.type) {
    case "number":
      return { type: "number", description };
    case "score":
      return { type: "integer", minimum: 0, maximum: 100, description };
    case "bool":
      return { type: "boolean", description };
    case "date":
      return { type: "string", description: `${description} (AAAA-MM-DD)` };
    case "select":
      return { type: "string", enum: column.options ?? [], description };
    case "multi":
      return { type: "array", items: { type: "string", enum: column.options ?? [] }, description };
    case "url":
      return { type: "string", description: `${description} (URL)` };
    case "email":
      return { type: "string", description: `${description} (email)` };
    default:
      return { type: "string", description };
  }
}

/** The page each value comes from, by column id. */
function sourcesSchema(columns: BaseColumn[]): Record<string, unknown> {
  return {
    type: "object",
    description: "URL de la página de donde sale cada valor, por id de columna.",
    properties: Object.fromEntries(columns.map((c) => [c.id, { type: "string" }])),
    additionalProperties: false,
  };
}

export function saveRowsSchema(
  rowKind: RowKind,
  columns: BaseColumn[],
  criteria: FitCriterion[] = [],
): Record<string, unknown> {
  const fields = agentColumns(columns);
  // With criteria the agent checks each one and the score is computed; without, it estimates it.
  const fit = criteria.length
    ? {
        fit: {
          type: "object",
          description: "Si la fila cumple cada criterio de encaje: yes, no o unknown (no comprobado).",
          properties: Object.fromEntries(
            criteria.map((c) => [c.id, { type: "string", enum: [...FIT_RESULTS], description: c.criterion }]),
          ),
          required: criteria.map((c) => c.id),
          additionalProperties: false,
        },
      }
    : {
        fitScore: { type: "integer", minimum: 0, maximum: 100, description: "Encaje con el cliente ideal" },
      };
  const row: Record<string, unknown> = {
    type: "object",
    properties: {
      ...(rowKind === "person"
        ? { personName: { type: "string", description: "Nombre y apellidos de la persona" } }
        : {}),
      companyName: {
        type: "string",
        description: rowKind === "person" ? "Empresa donde trabaja" : "Nombre de la empresa",
      },
      website: { type: "string", description: "Web de la empresa" },
      ...fit,
      fitReason: { type: "string", description: "Por qué encaja, en una frase" },
      sources: {
        type: "array",
        items: { type: "string" },
        maxItems: 10,
        description: "URLs públicas de donde salen los datos",
      },
      fields: {
        type: "object",
        description: "Valores de las columnas de la base. Deja fuera las que no hayas podido confirmar.",
        properties: Object.fromEntries(fields.map((c) => [c.id, columnSchema(c)])),
        additionalProperties: false,
      },
      fieldSources: sourcesSchema(fields),
    },
    required: [
      ...(rowKind === "person" ? ["personName", "companyName"] : ["companyName"]),
      ...(criteria.length ? ["fit"] : []),
    ],
  };
  return {
    type: "object",
    properties: { prospects: { type: "array", items: row, minItems: 1, maxItems: 25 } },
    required: ["prospects"],
  };
}

/** The «Qué datos recoger» section of the agent's prompt. */
export function columnsPrompt(base: { name: string; rowKind: RowKind; columns: BaseColumn[] }): string {
  const fields = agentColumns(base.columns);
  const lines = fields.map((c) => {
    const kind = c.options?.length
      ? `${COLUMN_TYPE_LABELS[c.type]}: ${c.options.join(" / ")}`
      : COLUMN_TYPE_LABELS[c.type];
    return `- ${c.name} (\`${c.id}\`, ${kind}${c.required ? ", obligatoria" : ""})${c.instructions ? `: ${c.instructions}` : ""}`;
  });
  return [
    `## Qué datos recoger\nGuardas en la base «${base.name}». Cada fila es ${base.rowKind === "person" ? "una persona (con su empresa)" : "una empresa"}. Además del nombre, la web, el encaje y las fuentes, rellena en \`fields\` estas columnas:`,
    lines.length ? lines.join("\n") : "(La base no tiene columnas propias.)",
    "Si no puedes confirmar un dato en una fuente pública, deja la columna fuera: no lo inventes ni lo estimes salvo que la columna lo pida.",
  ].join("\n");
}

/** JSON Schema of `update_prospects`: values for the empty cells of rows already in the base. */
export function completeRowsSchema(columns: BaseColumn[]): Record<string, unknown> {
  const fields = agentColumns(columns);
  return {
    type: "object",
    properties: {
      rows: {
        type: "array",
        minItems: 1,
        maxItems: 25,
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "Referencia de la fila (F1, F2…)" },
            fields: {
              type: "object",
              description: "Valores encontrados para sus celdas vacías.",
              properties: Object.fromEntries(fields.map((c) => [c.id, columnSchema(c)])),
              additionalProperties: false,
            },
            fieldSources: sourcesSchema(fields),
            notFound: {
              type: "array",
              items: { type: "string", enum: fields.map((c) => c.id) },
              description: "Columnas que has buscado y no están publicadas: no se volverán a buscar.",
            },
          },
          required: ["ref"],
        },
      },
    },
    required: ["rows"],
  };
}

/** The «Filas por completar» section: each row with what is known and the cells to fill. */
export function completionPrompt(
  base: { rowKind: RowKind; columns: BaseColumn[] },
  rows: {
    ref: string;
    companyName: string;
    personName: string | null;
    website: string | null;
    known: Record<string, unknown>;
    columns: string[];
  }[],
  cells: number,
): string {
  const byId = new Map(base.columns.map((c) => [c.id, c]));
  const lines = rows.map((r) => {
    const name = base.rowKind === "person" ? `${r.personName ?? "?"} (${r.companyName})` : r.companyName;
    const known = Object.entries(r.known)
      .map(([id, v]) => (byId.get(id) ? `${byId.get(id)!.name}: ${formatCell(byId.get(id)!, v)}` : null))
      .filter(Boolean)
      .join("; ");
    const missing = r.columns.map((id) => byId.get(id)?.name ?? id).join(", ");
    return `- ${r.ref} · ${name}${r.website ? ` · ${r.website}` : ""}${known ? `\n  Ya sabemos: ${known}` : ""}\n  Falta: ${missing}`;
  });
  return [
    `## Filas por completar\nEstas filas ya están en la base y les faltan datos (${cells} celdas). Búscalos en fuentes públicas y guárdalos con update_prospects, indicando la referencia de la fila, la URL de donde sale cada valor (fieldSources) y en notFound las columnas que hayas buscado sin encontrarlas publicadas. Las celdas que ya tienen valor no se cambian.`,
    lines.join("\n"),
  ].join("\n");
}
