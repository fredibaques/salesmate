import { ActionForm } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import type { AutonomyConfig, LimitsConfig } from "@/server/db/schema";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { saveAutonomy } from "../actions";

/** Autonomy levels in plain words (the numbers are what the gateway stores). */
const LEVELS = [
  { value: 1, label: "Pide mi aprobación" },
  { value: 2, label: "Lo hace solo, dentro de los límites y reglas" },
  { value: 3, label: "Lo hace solo" },
  { value: 0, label: "Solo sugiere (lo hago yo)" },
];

/**
 * What the agent may do without asking, action by action, and how many a
 * day: part of its configuration. The project's rules (hours, exclusions,
 * compliance) apply always.
 */
export function ApprovalsSettings({
  projectId,
  agentId,
  autonomy,
  limits,
}: {
  projectId: string;
  agentId: string;
  autonomy: AutonomyConfig;
  limits: LimitsConfig;
}) {
  return (
    <ActionForm
      action={saveAutonomy.bind(null, projectId, agentId)}
      submitLabel="Guardar"
      className="space-y-5"
    >
      <Field
        label="Por defecto"
        tip="Por defecto el agente prepara todo y espera tu aprobación en «Por aprobar». Deja hacer solo las acciones que apruebas casi siempre sin cambios. Las reglas del proyecto (horario, exclusiones, cumplimiento) se aplican siempre."
      >
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
  );
}
