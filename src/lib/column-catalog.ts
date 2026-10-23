import type { ColumnDraft, RowKind, SystemField } from "./prospect-columns";

/**
 * Columns that are useful in almost any sales table, whatever the business:
 * picked from a list instead of asking an AI (which would cost tokens for
 * the same handful of answers). Each one says what to put in it, which is
 * what the agent reads to fill it.
 */
export type CatalogColumn = ColumnDraft & {
  name: string;
  /** A fixed field of the table (hidden until added): adding it shows it instead of a new column. */
  field?: SystemField;
};

export type CatalogGroup = { title: string; columns: CatalogColumn[] };

const CONTACT: CatalogColumn[] = [
  {
    name: "Email",
    type: "email",
    filledBy: "agent",
    instructions: "Email general o de ventas que publica la propia empresa.",
  },
  {
    name: "Teléfono",
    type: "phone",
    filledBy: "agent",
    instructions: "Teléfono general o de ventas que publica la propia empresa.",
  },
  {
    name: "Persona de contacto",
    type: "text",
    filledBy: "agent",
    instructions: "Quién decide la compra, solo si la empresa la publica para ser contactada.",
  },
  { name: "Cargo", type: "text", filledBy: "agent", instructions: "Cargo de la persona de contacto." },
  {
    name: "LinkedIn",
    type: "url",
    filledBy: "agent",
    instructions: "Página de empresa en LinkedIn.",
  },
  {
    name: "Instagram",
    type: "url",
    filledBy: "agent",
    instructions: "Perfil de Instagram de la empresa, si lo enlaza en su web.",
  },
];

const PERSON_CONTACT: CatalogColumn[] = [
  {
    name: "Email",
    type: "email",
    filledBy: "agent",
    instructions: "Email profesional, solo si se publica para ser contactada.",
  },
  {
    name: "Teléfono",
    type: "phone",
    filledBy: "agent",
    instructions: "Teléfono profesional, solo si se publica para ser contactada.",
  },
  { name: "Cargo", type: "text", filledBy: "agent", instructions: "Cargo en la empresa." },
  { name: "LinkedIn", type: "url", filledBy: "agent", instructions: "Perfil público de LinkedIn." },
];

/**
 * In a table of people, the company they work at and its web are fixed
 * fields (the agent fills them, and they tell people apart): offered here as
 * columns, adding one shows it.
 */
const PERSON_COMPANY: CatalogColumn[] = [
  {
    name: "Empresa",
    field: "company",
    type: "text",
    filledBy: "agent",
    instructions: "Nombre de la empresa donde trabaja: el comercial, no la razón social.",
  },
  { name: "Web", field: "web", type: "url", filledBy: "agent", instructions: "Web de su empresa." },
];

const COMPANY: CatalogColumn[] = [
  {
    name: "Sector",
    type: "text",
    filledBy: "agent",
    instructions: "A qué se dedica la empresa, en pocas palabras.",
  },
  { name: "Ciudad", type: "text", filledBy: "agent", instructions: "Ciudad de la sede." },
  {
    name: "Provincia / región",
    type: "text",
    filledBy: "agent",
    instructions: "Provincia o región de la sede.",
  },
  { name: "País", type: "text", filledBy: "agent" },
  { name: "Dirección", type: "text", filledBy: "agent", instructions: "Dirección de la sede o tienda." },
  {
    name: "Tamaño",
    type: "select",
    options: ["1-10", "11-50", "51-200", "201-1000", "Más de 1000"],
    filledBy: "agent",
    instructions: "Empleados aproximados, si se publica (web, LinkedIn, registros). Si no, déjalo vacío.",
  },
  {
    name: "CIF",
    type: "text",
    filledBy: "agent",
    instructions: "CIF de la empresa: suele estar en el aviso legal de su web.",
  },
  {
    name: "Razón social",
    type: "text",
    filledBy: "agent",
    instructions: "Nombre legal de la empresa, como figura en el aviso legal.",
  },
  {
    name: "Año de fundación",
    type: "number",
    filledBy: "agent",
    instructions: "Año en que se fundó, si lo dice su web.",
  },
  {
    name: "Descripción",
    type: "long",
    filledBy: "agent",
    instructions: "Qué hace la empresa y para quién, en una o dos frases, según su web.",
  },
];

const SALES: CatalogColumn[] = [
  {
    name: "Fase",
    type: "stage",
    options: ["Nuevo", "Contactado", "Interesado", "Reunión", "Propuesta", "Ganado", "Perdido"],
    filledBy: "person",
  },
  { name: "Responsable", type: "text", filledBy: "person" },
  { name: "Prioridad", type: "select", options: ["Alta", "Media", "Baja"], filledBy: "person" },
  { name: "Próximo paso", type: "text", filledBy: "person" },
  { name: "Fecha del próximo paso", type: "date", filledBy: "person" },
  { name: "Último contacto", type: "date", filledBy: "person" },
  { name: "Valor estimado (€)", type: "number", filledBy: "person" },
  {
    name: "Origen",
    type: "select",
    options: ["Web", "Referido", "Evento", "Prospección", "Otro"],
    filledBy: "person",
  },
  { name: "Notas", type: "long", filledBy: "person" },
];

/** The catalogue for a table of companies or of people. */
export function columnCatalog(rowKind: RowKind): CatalogGroup[] {
  return [
    { title: "Contacto", columns: rowKind === "person" ? PERSON_CONTACT : CONTACT },
    {
      title: rowKind === "person" ? "Su empresa" : "Empresa",
      columns: rowKind === "person" ? [...PERSON_COMPANY, ...COMPANY] : COMPANY,
    },
    { title: "Seguimiento comercial", columns: SALES },
  ];
}
