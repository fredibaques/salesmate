import { ActionForm } from "@/components/action-form";
import { Card, Chip, Field, Input, Textarea } from "@/components/ui";
import type { agentConfigs } from "@/server/db/schema";
import { SCHEDULED_AGENT_TYPES, type ProjectAgentType } from "@/server/services/agents";
import { saveInstructions } from "../actions";
import { ScheduleStatus } from "./schedule-status";

const DAYS = [
  [1, "L"],
  [2, "M"],
  [3, "X"],
  [4, "J"],
  [5, "V"],
  [6, "S"],
  [7, "D"],
] as const;

const HINTS: Record<ProjectAgentType, string> = {
  inbound:
    "Lo que quieras que tenga en cuenta además de su proceso de venta: matices de tu negocio, casos especiales, qué no debe decir nunca…",
  outbound:
    "Qué empresas buscar y cómo: sector, tamaño, zona, señales de que encajan, qué fuentes usar o evitar y qué datos recoger.",
  account_manager: "Qué tiene que hacer con tus clientes actuales y cómo.",
};

/** What the agent must do, in the user's words, and when it works on its own. */
export function InstructionsCard({
  projectId,
  agentType,
  config,
}: {
  projectId: string;
  agentType: ProjectAgentType;
  config: typeof agentConfigs.$inferSelect;
}) {
  const scheduled = SCHEDULED_AGENT_TYPES.includes(agentType);
  const schedule = config.schedule ?? { time: "08:00", days: [1, 2, 3, 4, 5] };
  return (
    <Card
      title="Instrucciones"
      tip="Lo que comparten todos los agentes (qué vendes, a quién, tono) ya lo saben por Ajustes → Oferta y cliente. Aquí va lo propio de este agente."
    >
      <ActionForm
        key={`${config.instructions ?? ""}|${JSON.stringify(config.schedule)}|${JSON.stringify(config.settings)}`}
        action={saveInstructions.bind(null, projectId, agentType)}
        submitLabel="Guardar"
        className="space-y-5"
      >
        <Field label="Qué tiene que hacer y cómo" hint={HINTS[agentType]}>
          <Textarea name="instructions" defaultValue={config.instructions ?? ""} className="min-h-48" />
        </Field>
        {scheduled ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[auto_1fr_auto]">
              <Field
                label="Hora"
                tip="Hora del proyecto. Trabaja solo a partir de esa hora, los días marcados, mientras esté activo: el programador pasa cada 15 minutos de día y cada hora de noche."
              >
                <Input name="time" type="time" defaultValue={schedule.time} required className="w-32" />
              </Field>
              <Field label="Días" group>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(([n, label]) => (
                    <Chip key={n} name="days" value={n} defaultChecked={schedule.days.includes(n)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Prospectos por ejecución">
                <Input
                  name="prospectsPerRun"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={config.settings.prospectsPerRun ?? 10}
                  className="w-32"
                />
              </Field>
            </div>
            <ScheduleStatus projectId={projectId} config={config} />
          </>
        ) : null}
      </ActionForm>
    </Card>
  );
}
