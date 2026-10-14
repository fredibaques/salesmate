"use client";

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { ActionForm, type FormAction } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Field, Input, Segmented } from "@/components/ui";
import type { PlannedKind } from "@/server/agents/tasks";

const KIND_LABELS: Record<PlannedKind, string> = {
  find: "Buscar filas nuevas",
  complete: "Completar vacíos",
  outreach: "Ronda de primeros contactos",
};

/**
 * «Planificar tarea»: something for the agent to do on a given day and time
 * (new rows to find, the table's empty cells, a round of first contacts).
 * It shows in «Planificadas» until then.
 */
export function PlanTaskButton({
  action,
  kinds,
  defaults,
  variant = "secondary",
  maxFind,
}: {
  action: FormAction;
  kinds: PlannedKind[];
  /** Tomorrow at 09:00 in the project's time zone, and its usual rows per run. */
  defaults: { date: string; time: string; find: number };
  variant?: "primary" | "secondary";
  maxFind: number;
}) {
  const [kind, setKind] = useState<PlannedKind>(kinds[0]);
  return (
    <ModalButton
      label="Planificar tarea"
      icon={<CalendarPlus className="size-4" />}
      title="Planificar una tarea"
      variant={variant}
      size="sm"
    >
      <ActionForm action={action} submitLabel="Planificar" className="space-y-5">
        {kinds.length > 1 ? (
          <Field label="Qué tiene que hacer" group>
            <Segmented
              name="kind"
              options={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
              defaultValue={kind}
              onChange={(v) => setKind(v as PlannedKind)}
            />
          </Field>
        ) : (
          <>
            <input type="hidden" name="kind" value={kinds[0]} />
            <Field label="Qué tiene que hacer">
              <p className="text-sm">{KIND_LABELS[kinds[0]]}</p>
            </Field>
          </>
        )}
        {kind === "find" ? (
          <Field
            label="Filas nuevas que quieres"
            tip="Si en una ejecución no llega a todas, sigue por tandas hasta conseguirlas. Lo ves en «En curso»."
          >
            <Input name="find" type="number" min={1} max={maxFind} defaultValue={defaults.find} required />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Día">
            <Input name="date" type="date" defaultValue={defaults.date} required />
          </Field>
          <Field
            label="Hora"
            tip="En la hora del proyecto. Empieza en la primera pasada del programador desde entonces."
          >
            <Input name="time" type="time" defaultValue={defaults.time} required />
          </Field>
        </div>
      </ActionForm>
    </ModalButton>
  );
}
