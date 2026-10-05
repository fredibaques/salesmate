import { ChevronRight, HeartHandshake, MessageSquareReply, Plus, Send, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { SwitchButton } from "@/components/switch";
import { Badge, CardGrid, EntityCard, Field, Select } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { SALES_MOTIONS } from "@/server/db/schema";
import { NEXT_STEP_LABELS, SALES_MOTION_LABELS } from "@/server/playbooks/spec";
import {
  AVAILABLE_AGENT_TYPES,
  PROJECT_AGENT_TYPES,
  type listProjectAgents,
  type ProjectAgentType,
} from "@/server/services/agents";
import { addAgentAction, toggleAgent } from "./actions";

export const AGENT_ICONS: Record<ProjectAgentType, ReactNode> = {
  inbound: <MessageSquareReply />,
  outbound: <Send />,
  account_manager: <HeartHandshake />,
};

type Agents = Awaited<ReturnType<typeof listProjectAgents>>;

function AddAgentButton({ projectId, type }: { projectId: string; type: ProjectAgentType }) {
  const info = AGENT_INFO[type];
  return (
    <ModalButton
      label="Añadir"
      icon={<Plus className="size-4" />}
      title={`Añadir el ${info.name.toLowerCase()}`}
      description="Empezará con un proceso de venta de partida que podrás ajustar. No actuará hasta que lo actives."
      variant="secondary"
    >
      <ActionForm
        action={addAgentAction.bind(null, projectId)}
        submitLabel="Añadir agente"
        className="space-y-4"
      >
        <input type="hidden" name="agentType" value={type} />
        <Field
          label="Modelo de venta"
          hint="En B2B la conversación suele acabar en una reunión; en B2C, en un presupuesto o una contratación directa. Podrás cambiarlo después."
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

function missingSetup(type: ProjectAgentType, channels: { mailboxId?: string | null }) {
  if (type === "inbound" && !channels.mailboxId) return "Elige con qué buzón responde";
  return null;
}

/**
 * Every agent a project can have, as cards: the added ones with their
 * on/off switch, the available ones ready to add, the rest as «próximamente».
 */
export function AgentCards({ projectId, agents }: { projectId: string; agents: Agents }) {
  return (
    <CardGrid>
      {PROJECT_AGENT_TYPES.map((type) => {
        const info = AGENT_INFO[type];
        const agent = agents.find((a) => a.config.agentType === type);
        if (agent) {
          const href = `/app/projects/${projectId}/agents/${type}`;
          const warning = missingSetup(type, agent.config.channels);
          const steps = agent.spec?.nextSteps ?? [];
          return (
            <EntityCard
              key={type}
              href={href}
              icon={AGENT_ICONS[type]}
              iconTone={agent.config.enabled ? "success" : "neutral"}
              title={info.name}
              meta={agent.playbook ? SALES_MOTION_LABELS[agent.playbook.salesMotion] : null}
              description={
                steps.length > 0
                  ? `Objetivo: ${NEXT_STEP_LABELS[steps[0]].toLowerCase()}${
                      steps.length > 1
                        ? ` (o ${steps
                            .slice(1)
                            .map((s) => NEXT_STEP_LABELS[s].toLowerCase())
                            .join(", ")})`
                        : ""
                    }.`
                  : info.description
              }
              footer={
                <>
                  <form action={toggleAgent.bind(null, projectId, type, !agent.config.enabled)}>
                    <SwitchButton
                      on={agent.config.enabled}
                      offLabel="En pausa"
                      label={
                        agent.config.enabled
                          ? `Pausar el ${info.name.toLowerCase()}`
                          : `Activar el ${info.name.toLowerCase()}`
                      }
                    />
                  </form>
                  <span className="inline-flex items-center gap-0.5 text-sm text-muted transition-colors group-hover:text-accent">
                    Configurar
                    <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </>
              }
            >
              {warning ? (
                <span className="flex items-center gap-1.5 text-xs text-warning">
                  <TriangleAlert className="size-3.5" />
                  {warning}
                </span>
              ) : null}
            </EntityCard>
          );
        }
        const available = AVAILABLE_AGENT_TYPES.includes(type);
        return (
          <EntityCard
            key={type}
            icon={AGENT_ICONS[type]}
            title={info.name}
            variant={available ? "placeholder" : "disabled"}
            badge={available ? null : <Badge>Próximamente</Badge>}
            description={info.description}
            footer={available ? <AddAgentButton projectId={projectId} type={type} /> : null}
          />
        );
      })}
    </CardGrid>
  );
}
