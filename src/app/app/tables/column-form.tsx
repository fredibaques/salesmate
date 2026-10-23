"use client";

import { useState } from "react";
import { ActionForm, type FormAction } from "@/components/action-form";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import { OptionsInput } from "./options-input";
import {
  COLUMN_TYPE_LABELS,
  COLUMN_TYPES,
  DEFAULT_STAGES,
  hasOptions,
  type BaseColumn,
  type ColumnType,
} from "@/lib/prospect-columns";

const FILLED_BY_OPTIONS = [
  { value: "agent", label: "El agente" },
  { value: "person", label: "Una persona" },
  { value: "both", label: "Los dos" },
];

/** A table a relation column can point at. */
export type LinkTarget = { id: string; name: string };

/**
 * Adds a column or changes one: name, type, choices and how the agent fills
 * it. A relation picks the table it points at (`tables`: the others).
 */
export function ColumnForm({
  action,
  column,
  tables = [],
}: {
  action: FormAction;
  column?: BaseColumn;
  tables?: LinkTarget[];
}) {
  const [type, setType] = useState<ColumnType>(column?.type ?? "text");
  const link = type === "link";
  return (
    <ActionForm action={action} submitLabel={column ? "Guardar" : "Añadir columna"} className="space-y-5">
      <Field label="Nombre">
        <Input
          name="name"
          required
          maxLength={80}
          defaultValue={column?.name}
          placeholder="p. ej. ¿Tiene tienda online?"
        />
      </Field>
      <Field
        label="Tipo"
        hint={
          column
            ? "Si cambias el tipo o las opciones, los valores que ya no encajen se borran."
            : "El agente solo guarda valores de este tipo."
        }
      >
        <Select name="type" value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t}>
              {COLUMN_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      {link ? (
        <Field
          label="Tabla relacionada"
          hint={
            column?.type === "link"
              ? "Si eliges otra tabla, las filas pierden la relación que tenían."
              : "Cada fila apuntará a una fila de esa tabla, p. ej. la empresa de cada persona."
          }
          tip="Una tabla solo tiene una relación. Si borras una fila de la tabla relacionada, se borran también las filas que apuntan a ella."
        >
          <Select name="linkBaseId" required defaultValue={column?.linkBaseId ?? ""}>
            <option value="" disabled>
              Elige una tabla
            </option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {type === "stage" ? (
        <Field
          label="Fases"
          group
          hint="En orden. Con esta columna puedes ver la tabla como un tablero, con una lista por fase."
          tip="Una tabla solo tiene una columna de fase. El agente solo puede elegir entre estas."
        >
          <OptionsInput
            key="stage"
            column={column}
            defaultValue={column?.type === "stage" ? (column.options ?? []) : DEFAULT_STAGES}
            addLabel="Añadir fase"
          />
        </Field>
      ) : hasOptions(type) ? (
        <Field
          label="Opciones"
          group
          hint="El agente solo puede elegir entre estas. El punto elige el color de su etiqueta."
        >
          <OptionsInput
            key="options"
            column={column}
            defaultValue={column?.options ?? []}
            addLabel="Añadir opción"
          />
        </Field>
      ) : null}
      {link ? (
        // The agent links each row it saves to the row it searched in; people pick it by hand.
        <input type="hidden" name="filledBy" value="both" />
      ) : (
        <>
          <Field
            label="Instrucciones para el agente"
            optional
            hint="Qué poner y de dónde sacarlo. Es lo que más mejora lo que encuentra."
          >
            <Textarea name="instructions" defaultValue={column?.instructions ?? ""} className="min-h-24" />
          </Field>
          <Field label="La rellena" group tip="Las columnas de una persona no se le muestran al agente.">
            {/* The phase of a row is moved by people (or the board), not looked up by the agent. */}
            <Segmented
              key={column ? "saved" : type === "stage" ? "stage" : "other"}
              name="filledBy"
              options={FILLED_BY_OPTIONS}
              defaultValue={column?.filledBy ?? (type === "stage" ? "person" : "agent")}
            />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
