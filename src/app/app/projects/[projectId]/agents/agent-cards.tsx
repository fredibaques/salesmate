import { ChevronRight, HeartHandshake, MessageSquareReply, Plus, Send, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { SwitchButton } from "@/components/switch";
import { Badge, CardGrid, EntityCard, LinkButton } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { NEXT_STEP_LABELS, SALES_MOTION_LABELS } from "@/server/playbooks/spec";
import {
  AVAILABLE_AGENT_TYPES,
  PROJECT_AGENT_TYPES,
  type listProjectAgents,
  type ProjectAgentType,
} from "@/server/services/agents";
import { toggleAgent } from "./actions";

export const AGENT_ICONS: Record<ProjectAgentType, ReactNode> = {
  inbound: <MessageSquareReply />,
  outbound: <Send />,
  account_manager: <HeartHandshake />,
};

type Agents = Awaited<ReturnType<typeof listProjectAgents>>;

function AddAgentButton({ projectId, type }: { projectId: string; type: ProjectAgentType }) {
  return (
    <LinkButton href={`/app/projects/${projectId}/agents/new/${type}`} variant="secondary">
      <Plus />
      Añadir
    </LinkButton>
  );
}

const DAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function scheduleDays(days: number[]) {
  const sorted = [...days].sort();
  if (sorted.join() === "1,2,3,4,5") return "día laborable";
  if (sorted.length === 7) return "día";
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
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
          const schedule = agent.config.schedule;
          return (
            <EntityCard
              key={type}
              href={href}
              icon={AGENT_ICONS[type]}
              iconTone={agent.config.enabled ? "success" : "neutral"}
              title={info.name}
              meta={
                type === "outbound"
                  ? schedule
                    ? `Cada ${scheduleDays(schedule.days)} a las ${schedule.time}`
                    : "Sin horario"
                  : agent.playbook
                    ? SALES_MOTION_LABELS[agent.playbook.salesMotion]
                    : null
              }
              description={
                type === "outbound"
                  ? `Busca ${agent.config.settings.prospectsPerRun ?? 10} prospectos nuevos en cada ejecución.`
                  : steps.length > 0
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
