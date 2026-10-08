"use client";

import { useState } from "react";
import { ActionForm, type FormAction } from "@/components/action-form";
import { ListInput } from "@/components/list-input";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import { COLUMN_TYPE_LABELS, COLUMN_TYPES, type BaseColumn, type ColumnType } from "@/lib/prospect-columns";

const FILLED_BY_OPTIONS = [
  { value: "agent", label: "El agente" },
  { value: "person", label: "Una persona" },
  { value: "both", label: "Los dos" },
];

const hasOptions = (type: ColumnType) => type === "select" || type === "multi";

/** Adds a column or changes one: name, type, choices and how the agent fills it. */
export function ColumnForm({ action, column }: { action: FormAction; column?: BaseColumn }) {
  const [type, setType] = useState<ColumnType>(column?.type ?? "text");
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
      {hasOptions(type) ? (
        <Field label="Opciones" group hint="El agente solo puede elegir entre estas.">
          <ListInput name="options" defaultValue={column?.options ?? []} addLabel="Añadir opción" />
        </Field>
      ) : null}
      <Field
        label="Instrucciones para el agente"
        optional
        hint="Qué poner y de dónde sacarlo. Es lo que más mejora lo que encuentra."
      >
        <Textarea name="instructions" defaultValue={column?.instructions ?? ""} className="min-h-24" />
      </Field>
      <Field label="La rellena" group tip="Las columnas de una persona no se le muestran al agente.">
        <Segmented name="filledBy" options={FILLED_BY_OPTIONS} defaultValue={column?.filledBy ?? "agent"} />
      </Field>
    </ActionForm>
  );
}
