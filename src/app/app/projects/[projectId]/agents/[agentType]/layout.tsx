import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { TabLink } from "@/components/nav-link";
import { SwitchButton } from "@/components/switch";
import { Button, PageHeader } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAgent, isProjectAgentType } from "@/server/services/agents";
import { removeAgentAction, toggleAgent } from "../actions";
import { AGENT_ICONS } from "../agent-cards";

export default async function AgentLayout({
  children,
  params,
}: LayoutProps<"/app/projects/[projectId]/agents/[agentType]">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  const tenant = await requireTenant();
  const agent = await getAgent(getDb(), tenant, projectId, agentType);
  if (!agent) notFound();
  const base = `/app/projects/${projectId}/agents/${agentType}`;
  const info = AGENT_INFO[agentType];

  return (
    <>
      <PageHeader
        level="section"
        back={{ href: `/app/projects/${projectId}/agents`, label: "Agentes" }}
        icon={AGENT_ICONS[agentType]}
        title={info.name}
        description={info.description}
        actions={
          <>
            <ConfirmForm
              action={removeAgentAction.bind(null, projectId, agentType)}
              message={`¿Quitar el ${info.name.toLowerCase()} de este proyecto? Dejará de atender contactos. Su proceso se conserva por si lo vuelves a añadir.`}
            >
              <Button variant="dangerGhost">
                <Trash2 className="size-4" />
                Quitar
              </Button>
            </ConfirmForm>
            <form
              action={toggleAgent.bind(null, projectId, agentType, !agent.config.enabled)}
              className="rounded-lg border border-border bg-surface px-3 py-1"
            >
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
          </>
        }
      />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        <TabLink href={base} exact>
          Proceso de venta
        </TabLink>
        <TabLink href={`${base}/channels`}>Canales</TabLink>
        <TabLink href={`${base}/approvals`}>Aprobaciones</TabLink>
      </nav>
      {children}
    </>
  );
}
