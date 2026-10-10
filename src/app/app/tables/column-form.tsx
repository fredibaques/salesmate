"use client";

import { useState } from "react";
import { ActionForm, type FormAction } from "@/components/action-form";
import { ListInput } from "@/components/list-input";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui";
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
      {type === "stage" ? (
        <Field
          label="Fases"
          group
          hint="En orden. Con esta columna puedes ver la tabla como un tablero, con una lista por fase."
          tip="Una tabla solo tiene una columna de fase. El agente solo puede elegir entre estas."
        >
          <ListInput
            key="stage"
            name="options"
            defaultValue={column?.type === "stage" ? (column.options ?? []) : DEFAULT_STAGES}
            addLabel="Añadir fase"
          />
        </Field>
      ) : hasOptions(type) ? (
        <Field label="Opciones" group hint="El agente solo puede elegir entre estas.">
          <ListInput
            key="options"
            name="options"
            defaultValue={column?.options ?? []}
            addLabel="Añadir opción"
          />
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
        {/* The phase of a row is moved by people (or the board), not looked up by the agent. */}
        <Segmented
          key={column ? "saved" : type === "stage" ? "stage" : "other"}
          name="filledBy"
          options={FILLED_BY_OPTIONS}
          defaultValue={column?.filledBy ?? (type === "stage" ? "person" : "agent")}
        />
      </Field>
    </ActionForm>
  );
}
