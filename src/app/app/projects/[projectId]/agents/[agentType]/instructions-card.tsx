import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ScheduleFields } from "@/components/schedule-fields";
import { Card, Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import { AI_PROVIDER_INFO } from "@/lib/ai-providers";
import { DEFAULT_CELLS_PER_RUN } from "@/server/agents/prospector";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getOrgAi } from "@/server/llm/org-ai";
import type { agentConfigs } from "@/server/db/schema";
import { SCHEDULED_AGENT_TYPES, type ProjectAgentType } from "@/server/services/agents";
import { saveInstructions } from "../actions";
import { ScheduleStatus } from "./schedule-status";

const MODES = [
  { value: "find", label: "Buscar nuevos" },
  { value: "complete", label: "Completar vacíos" },
  { value: "both", label: "Las dos cosas" },
];

const HINTS: Record<ProjectAgentType, string> = {
  inbound:
    "Lo que quieras que tenga en cuenta además de su proceso de venta: matices de tu negocio, casos especiales, qué no debe decir nunca…",
  outbound:
    "Qué empresas buscar y cómo: sector, tamaño, zona, señales de que encajan, qué fuentes usar o evitar y qué datos recoger.",
  account_manager: "Qué tiene que hacer con tus clientes actuales y cómo.",
};

/** What the agent must do, in the user's words, and when it works on its own. */
export async function InstructionsCard({
  projectId,
  agentType,
  config,
  bases,
}: {
  projectId: string;
  agentType: ProjectAgentType;
  config: typeof agentConfigs.$inferSelect;
  /** The project's prospect bases, for agents that fill one. */
  bases?: { id: string; name: string }[];
}) {
  const scheduled = SCHEDULED_AGENT_TYPES.includes(agentType);
  const ai = scheduled ? await getOrgAi(getDb(), await requireTenant()) : null;
  const models = ai ? AI_PROVIDER_INFO[ai.provider].models : [];
  const orgModel = models.find((m) => m.id === ai?.model);
  return (
    <Card
      title="Instrucciones"
      tip="Lo que comparten todos los agentes (qué vendes, a quién, tono) ya lo saben por Ajustes → Oferta y cliente. Aquí va lo propio de este agente."
    >
      <ActionForm
        key={`${config.prospectBaseId ?? ""}|${config.instructions ?? ""}|${JSON.stringify(config.schedule)}|${JSON.stringify(config.settings)}`}
        action={saveInstructions.bind(null, projectId, agentType)}
        submitLabel="Guardar"
        className="space-y-5"
      >
        {bases?.length ? (
          <Field
            label="Trabaja sobre"
            tip="La tabla del proyecto donde guarda lo que encuentra. Recoge los datos de sus columnas."
            hint={
              <Link href={`/app/projects/${projectId}/prospects/new`} className="text-accent hover:underline">
                Crear otra tabla
              </Link>
            }
          >
            <Select name="baseId" defaultValue={config.prospectBaseId ?? bases[0].id} className="max-w-sm">
              {bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Qué tiene que hacer y cómo" hint={HINTS[agentType]}>
          <Textarea name="instructions" defaultValue={config.instructions ?? ""} className="min-h-48" />
        </Field>
        {scheduled ? (
          <>
            <ScheduleFields schedule={config.schedule} />
            <ScheduleStatus projectId={projectId} config={config} />
            <Field
              label="En cada ejecución"
              group
              tip="Completar rellena las celdas vacías de filas que ya están en la tabla, empezando por las de mejor encaje. No toca lo que ha escrito una persona."
            >
              <Segmented name="mode" options={MODES} defaultValue={config.settings.mode ?? "find"} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Filas nuevas por ejecución"
                tip="Cuántas empresas o personas nuevas busca cada vez."
              >
                <Input
                  name="prospectsPerRun"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={config.settings.prospectsPerRun ?? 10}
                  className="w-32"
                />
              </Field>
              <Field
                label="Celdas a completar por ejecución"
                tip="Tope de datos que busca para filas que ya existen. Junto con las filas nuevas, controla lo que cuesta cada ejecución."
              >
                <Input
                  name="cellsPerRun"
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={config.settings.cellsPerRun ?? DEFAULT_CELLS_PER_RUN}
                  className="w-32"
                />
              </Field>
            </div>
            {models.length ? (
              <Field
                label="Modelo de IA"
                tip="Uno más económico para tareas repetitivas (completar datos), el más capaz para investigar. Del mismo proveedor que la organización."
              >
                <Select
                  name="model"
                  defaultValue={
                    models.some((m) => m.id === config.settings.model) ? config.settings.model : ""
                  }
                  className="max-w-sm"
                >
                  <option value="">El de la organización ({orgModel?.label ?? ai?.model})</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </>
        ) : null}
      </ActionForm>
    </Card>
  );
}
