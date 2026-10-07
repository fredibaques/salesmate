import { COLUMN_TYPE_LABELS, type BaseColumn, type RowKind } from "@/lib/prospect-columns";

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

export function saveRowsSchema(rowKind: RowKind, columns: BaseColumn[]): Record<string, unknown> {
  const fields = agentColumns(columns);
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
      fitScore: { type: "integer", minimum: 0, maximum: 100, description: "Encaje con el cliente ideal" },
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
    },
    required: rowKind === "person" ? ["personName", "companyName"] : ["companyName"],
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
