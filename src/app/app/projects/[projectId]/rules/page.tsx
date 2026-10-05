import { Plus, Scale, ShieldBan, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { SUPPRESSION_TYPE_LABELS, SuppressionFields } from "@/components/suppression-fields";
import { Badge, Button, Card, EmptyState, Field, Input, Select, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { getProjectRules } from "@/server/services/projects";
import { addProjectSuppression, addRule, deleteRule, deleteSuppression } from "../actions";

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

  return (
    <>
      <PageHeader
        level="section"
        title="Reglas"
        description="Lo que el sistema comprueba antes de cada acción de los agentes de este proyecto, sea cual sea su nivel de autonomía."
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
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
    </>
  );
}
