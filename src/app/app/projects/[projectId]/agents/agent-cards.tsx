import { ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { AgentTile, agentState } from "@/components/agent-look-fields";
import { AGENT_ICONS } from "@/components/agent-icons";
import { SwitchButton } from "@/components/switch";
import { ModalButton } from "@/components/modal";
import { CardGrid, EntityCard } from "@/components/ui";
import { AGENT_INFO, agentName } from "@/lib/agents";
import { describeSchedule } from "@/lib/schedule";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { projectProcess } from "@/server/playbooks/service";
import {
  AGENT_DEFAULTS,
  AVAILABLE_AGENT_TYPES,
  listChannelOptions,
  listMcpServers,
  PROJECT_AGENT_TYPES,
  type listProjectAgents,
  type ProjectAgentType,
} from "@/server/services/agents";
import { toggleAgent } from "./actions";
import { NewAgentFlow } from "./new-agent-flow";

export { AGENT_ICONS };

type Agents = Awaited<ReturnType<typeof listProjectAgents>>;

/**
 * «Añadir agente»: a modal to choose the kind of agent the project doesn't
 * have yet and set it up step by step. Nothing when it has them all.
 * `open` opens it on arrival with that kind chosen (old links to the page).
 */
export async function AddAgentButton({
  projectId,
  agents,
  variant = "primary",
  open,
}: {
  projectId: string;
  agents: Agents;
  variant?: "primary" | "secondary";
  open?: string;
}) {
  const added = new Set(agents.map((a) => a.config.agentType));
  const types = PROJECT_AGENT_TYPES.filter((type) => !added.has(type)).map((type) => ({
    type,
    available: AVAILABLE_AGENT_TYPES.includes(type),
  }));
  if (!types.some((t) => t.available)) return null;
  const tenant = await requireTenant();
  const db = getDb();
  const [options, servers, process] = await Promise.all([
    listChannelOptions(db, tenant),
    listMcpServers(db, tenant),
    withTenant(db, tenant, (tx) => projectProcess(tx, projectId)),
  ]);
  const initial = types.find((t) => t.available && t.type === open)?.type;
  return (
    <ModalButton
      label="Añadir agente"
      icon={<Plus className="size-4" />}
      title="Añadir agente"
      variant={variant}
      width="lg"
      defaultOpen={Boolean(initial)}
    >
      <NewAgentFlow
        projectId={projectId}
        types={types}
        initial={initial}
        options={options}
        servers={servers}
        defaults={AGENT_DEFAULTS.outbound}
        process={process ? { objective: process.spec.objective, nextSteps: process.spec.nextSteps } : null}
      />
    </ModalButton>
  );
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

/** Where the inbound agent listens, in one line. */
function inboundSummary(channels: { readMailbox?: boolean; whatsappId?: string | null }) {
  const where = [
    "el formulario de tu web",
    channels.readMailbox ? "el buzón" : null,
    channels.whatsappId ? "WhatsApp" : null,
  ].filter(Boolean);
  const list = where.length > 1 ? `${where.slice(0, -1).join(", ")} y ${where.at(-1)}` : where[0];
  return `Atiende a quien escribe por ${list}, según el proceso de venta del proyecto.`;
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
        const schedule = agent.config.schedule;
        return (
          <EntityCard
            key={type}
            href={href}
            media={
              <AgentTile
                type={type}
                icon={agent.config.icon}
                color={agent.config.color}
                state={agentState({ enabled: agent.config.enabled, working: agent.working })}
              />
            }
            title={agentName(type, agent.config.name)}
            meta={type === "outbound" ? describeSchedule(schedule) : null}
            description={
              type === "outbound"
                ? outboundSummary(agent.config.settings)
                : type === "inbound"
                  ? inboundSummary(agent.config.channels)
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
                        ? `Pausar «${agentName(type, agent.config.name)}»`
                        : `Activar «${agentName(type, agent.config.name)}»`
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
