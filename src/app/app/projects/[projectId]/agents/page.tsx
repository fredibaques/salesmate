import { AlertTriangle, Bot, ChevronRight, Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, Card, EmptyState, Field, RowLink, Select } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { SALES_MOTIONS } from "@/server/db/schema";
import { NEXT_STEP_LABELS, SALES_MOTION_LABELS } from "@/server/playbooks/spec";
import {
  AVAILABLE_AGENT_TYPES,
  listProjectAgents,
  PROJECT_AGENT_TYPES,
  type ProjectAgentType,
} from "@/server/services/agents";
import { addAgentAction } from "./actions";

export const metadata = { title: "Agentes" };

function AddAgentButton({ projectId, added }: { projectId: string; added: string[] }) {
  const options = PROJECT_AGENT_TYPES.filter((t) => !added.includes(t));
  const firstAvailable = options.find((t) => AVAILABLE_AGENT_TYPES.includes(t));
  return (
    <ModalButton
      label="Añadir agente"
      icon={<Plus className="size-4" />}
      title="Añadir un agente"
      description="Elige qué parte de la venta quieres que haga. Después le dirás cómo vendes y con qué buzón, calendario y CRM trabaja."
      size="lg"
    >
      <ActionForm
        action={addAgentAction.bind(null, projectId)}
        submitLabel="Añadir agente"
        className="space-y-4"
      >
        <div className="space-y-2">
          {options.map((type) => {
            const available = AVAILABLE_AGENT_TYPES.includes(type);
            return (
              <label
                key={type}
                className={
                  available
                    ? "flex gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-background has-[:checked]:border-accent has-[:checked]:bg-accent/5"
                    : "flex gap-3 rounded-xl border border-dashed border-border p-4 opacity-60"
                }
              >
                <input
                  type="radio"
                  name="agentType"
                  value={type}
                  disabled={!available}
                  defaultChecked={type === firstAvailable}
                  className="mt-1"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {AGENT_INFO[type].name}
                    {!available ? <Badge>Próximamente</Badge> : null}
                  </span>
                  <span className="block text-sm text-muted">{AGENT_INFO[type].description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <Field
          label="Modelo de venta"
          hint="Define la plantilla de partida del proceso: en B2B suele acabar en una reunión; en B2C, en un presupuesto o una contratación directa. Podrás cambiarlo después."
        >
          <Select name="salesMotion" defaultValue="b2b_consultative">
            {SALES_MOTIONS.map((m) => (
              <option key={m} value={m}>
                {SALES_MOTION_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

function missingChannels(type: ProjectAgentType, channels: { mailboxId?: string | null }) {
  if (type === "inbound" && !channels.mailboxId) return "Sin buzón: no puede responder por email.";
  return null;
}

export default async function AgentsPage({ params }: PageProps<"/app/projects/[projectId]/agents">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const agents = await listProjectAgents(getDb(), tenant, projectId);
  const added = agents.map((a) => a.config.agentType);
  const canAddMore = PROJECT_AGENT_TYPES.some((t) => !added.includes(t));

  return (
    <Card
      title="Agentes"
      description="Cada agente se encarga de una parte de la venta y sigue su propio proceso. Lo que es común a todos (qué vendes, a quién, objeciones, tono) está en «Oferta y cliente»."
      actions={
        agents.length > 0 && canAddMore ? <AddAgentButton projectId={projectId} added={added} /> : null
      }
    >
      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title="Este proyecto todavía no tiene agentes"
          description="Añade el agente que necesitas, por ejemplo el inbound para atender a quien rellena el formulario de tu web, y configúralo paso a paso."
          action={<AddAgentButton projectId={projectId} added={added} />}
        />
      ) : (
        <ul className="divide-y divide-border">
          {agents.map(({ config, playbook, spec }) => {
            const type = config.agentType as ProjectAgentType;
            const warning = missingChannels(type, config.channels);
            return (
              <li key={config.id}>
                <RowLink href={`/app/projects/${projectId}/agents/${type}`} className="group py-4">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-medium group-hover:text-accent">{AGENT_INFO[type].name}</span>
                      {config.enabled ? (
                        <Badge tone="success">Activo</Badge>
                      ) : (
                        <Badge tone="warning">Sin activar</Badge>
                      )}
                    </span>
                    {spec && playbook ? (
                      <span className="mt-1 block text-sm text-muted">
                        {SALES_MOTION_LABELS[playbook.salesMotion]} · Objetivo:{" "}
                        {NEXT_STEP_LABELS[spec.nextSteps[0]].toLowerCase()}
                        {spec.nextSteps.length > 1
                          ? ` (o ${spec.nextSteps
                              .slice(1)
                              .map((s) => NEXT_STEP_LABELS[s].toLowerCase())
                              .join(", ")})`
                          : ""}
                      </span>
                    ) : null}
                    {warning ? (
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                        <AlertTriangle className="size-3.5" />
                        {warning}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                </RowLink>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
