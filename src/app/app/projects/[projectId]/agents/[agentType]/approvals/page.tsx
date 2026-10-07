import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, Select } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { getAgent, isProjectAgentType } from "@/server/services/agents";
import { saveAutonomy } from "../../actions";

/** Autonomy levels in plain words (the numbers are what the gateway stores). */
const LEVELS = [
  { value: 1, label: "Pide mi aprobación" },
  { value: 2, label: "Lo hace solo, dentro de los límites y reglas" },
  { value: 3, label: "Lo hace solo" },
  { value: 0, label: "Solo sugiere (lo hago yo)" },
];

export default async function AgentApprovalsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/approvals">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  const tenant = await requireTenant();
  const agent = await getAgent(getDb(), tenant, projectId, agentType);
  if (!agent) notFound();
  const { autonomy, limits } = agent.config;

  return (
    <Card
      title="Qué puede hacer sin preguntarte"
      tip="Por defecto el agente prepara todo y espera tu aprobación en «Por aprobar». Deja hacer solo las acciones que apruebas casi siempre sin cambios. Las reglas del proyecto (horario, exclusiones, cumplimiento) se aplican siempre."
      className="max-w-4xl"
    >
      <ActionForm
        action={saveAutonomy.bind(null, projectId, agentType)}
        submitLabel="Guardar"
        className="space-y-5"
      >
        <Field label="Por defecto">
          <Select name="defaultLevel" defaultValue={autonomy.default} className="max-w-sm">
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="py-2 pr-3 font-medium">Acción</th>
                <th className="py-2 pr-3 font-medium">Cómo actúa</th>
                <th className="w-32 py-2 font-medium">Máximo al día</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.values(ACTION_DEFINITIONS).map((def) => (
                <tr key={def.type} className="transition-colors hover:bg-background">
                  <td className="py-2 pr-3">{def.label}</td>
                  <td className="py-2 pr-3">
                    <Select
                      size="sm"
                      name={`level:${def.type}`}
                      defaultValue={autonomy.actions?.[def.type] ?? "default"}
                    >
                      <option value="default">Como por defecto</option>
                      {LEVELS.map((l) => (
                        <option key={l.value} value={l.value} disabled={l.value > def.maxAutonomy}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2">
                    <Input
                      size="sm"
                      name={`limit:${def.type}`}
                      type="number"
                      min={0}
                      placeholder="Sin límite"
                      defaultValue={limits.daily?.[def.type]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ActionForm>
    </Card>
  );
}
