import { ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { SwitchButton } from "@/components/switch";
import { ModalButton } from "@/components/modal";
import { Badge, CardGrid, EntityCard } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { NEXT_STEP_LABELS, SALES_MOTION_LABELS } from "@/server/playbooks/spec";
import {
  AVAILABLE_AGENT_TYPES,
  PROJECT_AGENT_TYPES,
  type listProjectAgents,
  type ProjectAgentType,
} from "@/server/services/agents";
import { toggleAgent } from "./actions";

export { AGENT_ICONS };

type Agents = Awaited<ReturnType<typeof listProjectAgents>>;

/**
 * «Añadir agente»: the kinds of agent the project doesn't have yet, to start
 * setting one up. Nothing when it has them all.
 */
export function AddAgentButton({
  projectId,
  agents,
  variant = "primary",
}: {
  projectId: string;
  agents: Agents;
  variant?: "primary" | "secondary";
}) {
  const added = new Set(agents.map((a) => a.config.agentType));
  const missing = PROJECT_AGENT_TYPES.filter((type) => !added.has(type));
  if (!missing.some((type) => AVAILABLE_AGENT_TYPES.includes(type))) return null;
  return (
    <ModalButton
      label="Añadir agente"
      icon={<Plus className="size-4" />}
      title="Añadir agente"
      variant={variant}
      width="lg"
    >
      <div className="grid gap-3">
        {missing.map((type) => {
          const info = AGENT_INFO[type];
          const available = AVAILABLE_AGENT_TYPES.includes(type);
          return (
            <EntityCard
              key={type}
              href={available ? `/app/projects/${projectId}/agents/new/${type}` : undefined}
              icon={AGENT_ICONS[type]}
              title={info.name}
              variant={available ? "default" : "disabled"}
              badge={available ? null : <Badge>Próximamente</Badge>}
              description={info.description}
            />
          );
        })}
      </div>
    </ModalButton>
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

/** What the prospecting agent does in each run, in one line. */
function outboundSummary(settings: { prospectsPerRun?: number; mode?: string; cellsPerRun?: number }) {
  const find = `busca ${settings.prospectsPerRun ?? 10} prospectos nuevos`;
  const complete = `completa hasta ${settings.cellsPerRun ?? 20} datos que faltan`;
  const mode = settings.mode ?? "find";
  const text = mode === "complete" ? complete : mode === "both" ? `${complete} y ${find}` : find;
  return `En cada ejecución ${text}.`;
}

/** The project's agents as cards, with their on/off switch. */
export function AgentCards({ projectId, agents }: { projectId: string; agents: Agents }) {
  return (
    <CardGrid>
      {agents.map((agent) => {
        const type = agent.config.agentType as ProjectAgentType;
        const info = AGENT_INFO[type];
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
                ? outboundSummary(agent.config.settings)
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
      })}
    </CardGrid>
  );
}
