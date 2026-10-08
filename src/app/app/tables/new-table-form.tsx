"use client";

import { Building2, User } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Choice, Field, Input, Select } from "@/components/ui";
import { createBaseAction } from "./actions";

const ROW_KINDS = [
  {
    value: "company",
    label: "Una empresa",
    description: "No se repiten: misma web, o mismo nombre y ciudad, es la misma fila.",
    icon: <Building2 className="size-4" />,
  },
  {
    value: "person",
    label: "Una persona",
    description: "Con la empresa donde trabaja. No se repite la misma persona en la misma empresa.",
    icon: <User className="size-4" />,
  },
];

/**
 * A new table: its name, what each row is and, if it goes with one, its
 * project. It opens with the usual columns, which are changed on the table.
 */
export function NewTableForm({
  projectId,
  projects = [],
}: {
  /** Preselected project (creating from a project's tab). */
  projectId?: string;
  projects?: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={createBaseAction} submitLabel="Crear tabla" className="space-y-5">
      <Field label="Nombre">
        <Input name="name" required maxLength={120} placeholder="p. ej. Concesionarios de Málaga" autoFocus />
      </Field>
      <Field label="Cada fila es" group>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROW_KINDS.map((k, i) => (
            <Choice
              key={k.value}
              card
              type="radio"
              name="rowKind"
              value={k.value}
              defaultChecked={i === 0}
              label={
                <span className="inline-flex items-center gap-2">
                  {k.icon}
                  {k.label}
                </span>
              }
              description={k.description}
            />
          ))}
        </div>
      </Field>
      <Field
        label="Proyecto"
        optional
        tip="Una tabla puede ir sola. Con un proyecto, sus agentes la usan con lo que sabe del proyecto; podrás cambiarlo en sus ajustes."
      >
        <Select name="projectId" defaultValue={projectId ?? ""}>
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
    </ActionForm>
  );
}
