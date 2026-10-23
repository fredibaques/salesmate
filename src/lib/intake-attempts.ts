/**
 * What happened to a submission sent to a table's form address that didn't
 * become a new row: kept on the table (the last few) so people can see why
 * a tool's leads don't arrive. Only field names are kept, never values.
 */

export const INTAKE_OUTCOMES = [
  "missing_key",
  "wrong_key",
  "closed",
  "invalid_body",
  "invalid",
  "duplicate",
] as const;
export type IntakeOutcome = (typeof INTAKE_OUTCOMES)[number];

export type IntakeAttempt = {
  at: string;
  outcome: IntakeOutcome;
  /** Details from the check (the values that didn't fit). */
  message?: string;
  /** The names of the fields it sent. */
  fields?: string[];
};

/** Submissions a table keeps. */
export const MAX_INTAKE_ATTEMPTS = 20;

export const INTAKE_OUTCOME_LABELS: Record<IntakeOutcome, string> = {
  missing_key:
    "Sin clave: mándala en la cabecera x-salesmate-key, en Authorization: Bearer, en el campo _key (o key) o en ?key= de la dirección.",
  wrong_key: "Clave incorrecta: copia la clave actual de la tabla (si la cambiaste, la anterior ya no vale).",
  closed: "El formulario de la tabla está desconectado.",
  invalid_body: "No se ha podido leer lo que envía: manda un objeto JSON o los campos de un formulario.",
  invalid: "Los datos no encajan con la tabla.",
  duplicate: "Ya estaba en la tabla: no se ha añadido otra vez.",
};

/** A submission that was turned away (a repeated row did arrive, as the one already there). */
export const isRejection = (a: IntakeAttempt) => a.outcome !== "duplicate";
