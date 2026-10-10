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
import { listBases } from "@/server/prospects/bases";
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
 * «Añadir agente»: a modal to choose the kind of agent and set it up step by
 * step. A project can have as many agents of each kind as it needs (one
 * fills a table, another enriches it…); kinds that aren't ready say so.
 * As `card`, it is the last card of the agents' grid. `open` opens it on
 * arrival with that kind chosen (old links to the page).
 */
export async function AddAgentButton({
  projectId,
  variant = "primary",
  card = false,
  open,
}: {
  projectId: string;
  variant?: "primary" | "secondary";
  card?: boolean;
  open?: string;
}) {
  const types = PROJECT_AGENT_TYPES.map((type) => ({
    type,
    available: AVAILABLE_AGENT_TYPES.includes(type),
    note: AVAILABLE_AGENT_TYPES.includes(type) ? null : "Próximamente",
  }));
  const tenant = await requireTenant();
  const db = getDb();
  const [options, servers, process, bases] = await Promise.all([
    listChannelOptions(db, tenant),
    listMcpServers(db, tenant),
    withTenant(db, tenant, (tx) => projectProcess(tx, projectId)),
    listBases(db, tenant, projectId, { standalone: true }),
  ]);
  const initial = types.find((t) => t.available && t.type === open)?.type;
  return (
    <ModalButton
      label={
        card ? (
          <>
            <span className="flex size-9 items-center justify-center rounded-lg border border-dashed border-border-strong text-muted transition-colors group-hover:border-accent group-hover:text-accent">
              <Plus className="size-4" />
            </span>
            <span className="text-sm font-medium">Añadir agente</span>
            <span className="text-xs text-muted">
              Atiende contactos, busca clientes o completa tus tablas
            </span>
          </>
        ) : (
          "Añadir agente"
        )
      }
      icon={card ? undefined : <Plus className="size-4" />}
      title="Añadir agente"
      variant={variant}
      width="lg"
      defaultOpen={Boolean(initial)}
      triggerClass={
        card
          ? "group flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-transparent p-5 text-center transition-colors hover:border-accent hover:bg-surface"
          : undefined
      }
    >
      <NewAgentFlow
        projectId={projectId}
        types={types}
        initial={initial}
        options={options}
        servers={servers}
        defaults={AGENT_DEFAULTS}
        bases={bases.map((b) => ({ id: b.id, name: b.projectId ? b.name : `${b.name} (sin proyecto)` }))}
        process={process ? { objective: process.spec.objective, nextSteps: process.spec.nextSteps } : null}
      />
    </ModalButton>
  );
}

function missingSetup(
  type: ProjectAgentType,
  config: { channels: { mailboxId?: string | null }; prospectBaseId: string | null },
) {
  if (type === "inbound" && !config.channels.mailboxId) return "Elige con qué buzón responde";
  if (type === "outbound" && !config.prospectBaseId) return "Elige con qué tabla trabaja";
  if (type === "outbound" && !config.channels.mailboxId) return "Elige desde qué buzón escribe";
  return null;
}

/** Whom the outbound agent writes to in each run, in one line. */
function outreachSummary(settings: { handoff?: { minFit?: number; perRun?: number } }) {
  const minFit = settings.handoff?.minFit ?? 70;
  const fit = minFit > 0 ? ` con encaje ${minFit} o más` : "";
  return `En cada ejecución escribe el primer email a hasta ${settings.handoff?.perRun ?? 5} filas de su tabla${fit}.`;
}

/** What the prospecting agent does in each run, in one line. */
function prospectingSummary(settings: { prospectsPerRun?: number; mode?: string; cellsPerRun?: number }) {
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
export function AgentCards({
  projectId,
  agents,
  addCard,
}: {
  projectId: string;
  agents: Agents;
  /** The last card: «Añadir agente». */
  addCard?: React.ReactNode;
}) {
  return (
    <CardGrid>
      {agents.map((agent) => {
        const type = agent.config.agentType as ProjectAgentType;
        const info = AGENT_INFO[type];
        const href = `/app/projects/${projectId}/agents/${agent.config.id}`;
        const warning = missingSetup(type, agent.config);
        const schedule = agent.config.schedule;
        return (
          <EntityCard
            key={agent.config.id}
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
            meta={type === "prospecting" || type === "outbound" ? describeSchedule(schedule) : null}
            description={
              type === "prospecting"
                ? prospectingSummary(agent.config.settings)
                : type === "outbound"
                  ? outreachSummary(agent.config.settings)
                  : type === "inbound"
                    ? inboundSummary(agent.config.channels)
                    : info.description
            }
            badge={
              // Above the card's link, so it switches instead of opening the agent.
              <form
                action={toggleAgent.bind(null, projectId, agent.config.id, !agent.config.enabled)}
                className="relative z-10 -mt-1"
              >
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
            }
            footer={
              <span className="ml-auto inline-flex items-center gap-0.5 text-sm text-muted transition-colors group-hover:text-accent">
                Configurar
                <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
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
      {addCard}
    </CardGrid>
  );
}
