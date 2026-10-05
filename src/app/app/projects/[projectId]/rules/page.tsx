import { ChevronDown, Plus, Scale, ShieldBan, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { SUPPRESSION_TYPE_LABELS, SuppressionFields } from "@/components/suppression-fields";
import { Badge, Button, Card, EmptyState, Field, Input, Select } from "@/components/ui";
import { AGENT_LABELS, AUTONOMY_LABELS } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { getProjectRules } from "@/server/services/projects";
import { addProjectSuppression, addRule, deleteRule, deleteSuppression, saveAgent } from "../actions";

const RULE_LABELS = {
  human_only: "Reservada a personas",
  mandatory_notice: "Aviso obligatorio",
  channel_restriction: "Canal restringido",
  retention: "Conservación",
} as const;

const actionTypes = Object.values(ACTION_DEFINITIONS);

function AddRuleButton({ projectId }: { projectId: string }) {
  return (
    <ModalButton
      label="Añadir regla"
      icon={<Plus className="size-4" />}
      title="Añadir regla de cumplimiento"
      description="Se aplica a cada acción de los agentes de este proyecto antes de ejecutarse."
      variant="secondary"
      size="lg"
    >
      <ActionForm action={addRule.bind(null, projectId)} submitLabel="Añadir" className="space-y-4">
        <Field label="Tipo">
          <Select name="kind" defaultValue="human_only">
            {Object.entries(RULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Descripción">
          <Input
            name="description"
            required
            placeholder="p. ej. Las propuestas las envía siempre una persona"
          />
        </Field>
        <Field label="Acciones afectadas">
          <div className="flex flex-wrap gap-3 text-sm">
            {actionTypes.map((d) => (
              <label key={d.type} className="flex items-center gap-1">
                <input type="checkbox" name="actionTypes" value={d.type} /> {d.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Texto obligatorio" hint="Solo para «Aviso obligatorio».">
          <Input name="text" />
        </Field>
        <Field label="Tipo de destinatario restringido" hint="Solo para «Canal restringido».">
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" name="customerTypes" value="b2b" /> Empresas (B2B)
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="customerTypes" value="b2c" /> Particulares (B2C)
            </label>
          </div>
        </Field>
        <Field label="Días de conservación" hint="Solo para «Conservación».">
          <Input name="days" type="number" min={1} />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

function AddSuppressionButton({ projectId }: { projectId: string }) {
  return (
    <ModalButton
      label="Añadir exclusión"
      icon={<Plus className="size-4" />}
      title="Añadir exclusión"
      description="El sistema bloquea cualquier acción dirigida a estos destinatarios."
      variant="secondary"
    >
      <ActionForm
        action={addProjectSuppression.bind(null, projectId)}
        submitLabel="Añadir"
        className="space-y-4"
      >
        <SuppressionFields withScope />
      </ActionForm>
    </ModalButton>
  );
}

export default async function RulesPage({ params }: PageProps<"/app/projects/[projectId]/rules">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const rules = await getProjectRules(getDb(), tenant, projectId);
  const agents = [...rules.agents].sort(
    (a, b) => Object.keys(AGENT_LABELS).indexOf(a.agentType) - Object.keys(AGENT_LABELS).indexOf(b.agentType),
  );

  return (
    <div className="space-y-6">
      <Card
        title="Autonomía de los agentes"
        description="Por defecto todo queda en borrador para tu aprobación (nivel 1). Sube el nivel solo donde la tasa de aprobación sin cambios lo justifique."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {agents.map((a) => (
            <details key={a.id} className="group rounded-xl border border-border">
              <summary className="flex list-none items-center justify-between gap-2 rounded-xl p-3 text-sm transition-colors hover:bg-background [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{AGENT_LABELS[a.agentType]}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "Activo" : "Inactivo"}</Badge>
                  <Badge>{AUTONOMY_LABELS[a.autonomy.default]}</Badge>
                  <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <div className="border-t border-border p-3">
                <ActionForm
                  action={saveAgent.bind(null, projectId, a.agentType)}
                  submitLabel="Guardar"
                  className="space-y-3"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="enabled" defaultChecked={a.enabled} /> Agente activo
                  </label>
                  <Field label="Nivel por defecto">
                    <Select name="defaultLevel" defaultValue={a.autonomy.default}>
                      {AUTONOMY_LABELS.map((l, i) => (
                        <option key={i} value={i}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="space-y-2 text-sm">
                    {actionTypes.map((def) => (
                      <div key={def.type} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <span>{def.label}</span>
                        <select
                          name={`level:${def.type}`}
                          defaultValue={a.autonomy.actions?.[def.type] ?? "default"}
                          className="rounded border border-border bg-surface px-2 py-1 text-xs"
                        >
                          <option value="default">Por defecto</option>
                          {AUTONOMY_LABELS.map((l, i) => (
                            <option key={i} value={i} disabled={i > def.maxAutonomy}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <input
                          name={`limit:${def.type}`}
                          type="number"
                          min={0}
                          placeholder="límite/día"
                          defaultValue={a.limits.daily?.[def.type]}
                          className="w-24 rounded border border-border bg-surface px-2 py-1 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </ActionForm>
              </div>
            </details>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Reglas de cumplimiento"
          description="Normas propias de este negocio que el sistema aplica a cada acción, sin que el núcleo conozca tu sector."
          actions={rules.compliance.length > 0 ? <AddRuleButton projectId={projectId} /> : null}
        >
          {rules.compliance.length === 0 ? (
            <EmptyState
              compact
              icon={<Scale />}
              title="Sin reglas específicas"
              description="Por ejemplo: que las propuestas las envíe siempre una persona, o que todos los emails lleven un aviso legal."
              action={<AddRuleButton projectId={projectId} />}
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {rules.compliance.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                  <span>
                    <Badge>{RULE_LABELS[r.kind]}</Badge> {r.description}
                    <code className="mt-1 block text-xs text-muted">{JSON.stringify(r.spec)}</code>
                  </span>
                  <form action={deleteRule.bind(null, projectId, r.id)}>
                    <Button variant="dangerGhost" aria-label="Quitar regla">
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Exclusiones"
          description="Personas, dominios o teléfonos con los que este proyecto no debe contactar."
          actions={rules.suppressions.length > 0 ? <AddSuppressionButton projectId={projectId} /> : null}
        >
          {rules.suppressions.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldBan />}
              title="Sin exclusiones propias"
              description="Bajas, clientes actuales o competidores a los que este proyecto no debe escribir. Las de toda la organización están en «Exclusiones»."
              action={<AddSuppressionButton projectId={projectId} />}
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {rules.suppressions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge>
                      {SUPPRESSION_TYPE_LABELS[s.type as keyof typeof SUPPRESSION_TYPE_LABELS] ?? s.type}
                    </Badge>
                    <span>{s.value}</span>
                    {s.reason ? <span className="text-muted">· {s.reason}</span> : null}
                  </span>
                  <form action={deleteSuppression.bind(null, projectId, s.id)}>
                    <Button variant="dangerGhost" aria-label={`Quitar ${s.value}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
