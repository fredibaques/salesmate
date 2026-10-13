import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { ScheduleFields } from "@/components/schedule-fields";
import { Choice, Field, FormSection } from "@/components/ui";
import type { agentConfigs } from "@/server/db/schema";
import { ScheduleStatus } from "./schedule-status";

/** Something that makes the agent work when it happens. */
export type TriggerEvent = {
  /** Checkbox name, read by the agent's save action. */
  name: string;
  label: string;
  description: string;
  checked: boolean;
  /** Shown under it (e.g. the WhatsApp number to listen to). */
  extra?: ReactNode;
};

/**
 * «Cuándo trabaja», the same for every agent: when asked is always there
 * («Ejecutar ahora»); on top of it, a schedule and the events that make
 * sense for this agent. What one run does is its own.
 */
export function TriggerFields({
  projectId,
  config,
  run,
  events,
  hookUrl,
  children,
}: {
  projectId: string;
  config: typeof agentConfigs.$inferSelect;
  /** What one run does, in a sentence. */
  run: string;
  events: TriggerEvent[];
  /** The webhook's secret URL, shown while its trigger is on. */
  hookUrl?: string | null;
  /** Fields about how much it does in each run. */
  children?: ReactNode;
}) {
  return (
    <FormSection
      title="Cuándo trabaja"
      tip={`Siempre que se lo pidas con «Ejecutar ahora» (arriba a la derecha), tenga o no horario. Además, puede trabajar por su cuenta con un horario o cuando ocurra algo. ${run}`}
    >
      <ScheduleFields schedule={config.schedule} label="Con horario" />
      <ScheduleStatus projectId={projectId} config={config} />
      <Field
        label="Cuando ocurre algo"
        group
        tip="Marca lo que quieras que lo ponga a trabajar sin esperar a su horario. Solo funciona con el agente activo; si ya está trabajando, lo hace al terminar."
      >
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.name} className="space-y-2">
              <Choice
                card
                name={e.name}
                defaultChecked={e.checked}
                label={e.label}
                description={e.description}
              />
              {e.extra ? <div className="pl-7">{e.extra}</div> : null}
            </div>
          ))}
        </div>
      </Field>
      {hookUrl ? (
        <div className="space-y-2 rounded-lg bg-background p-3">
          <p className="text-xs font-medium text-muted">Dirección del webhook (secreta)</p>
          <code className="block text-xs break-all">{hookUrl}</code>
          <CopyButton text={hookUrl} label="Copiar dirección" />
        </div>
      ) : null}
      {children}
    </FormSection>
  );
}
