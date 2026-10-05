import { ArrowLeft, Pause, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { TabLink } from "@/components/nav-link";
import { Badge, Button } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAgent, isProjectAgentType } from "@/server/services/agents";
import { removeAgentAction, toggleAgent } from "../actions";

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
      <Link
        href={`/app/projects/${projectId}/agents`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Agentes
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{info.name}</h2>
            {agent.config.enabled ? (
              <Badge tone="success">Activo</Badge>
            ) : (
              <Badge tone="warning">Sin activar</Badge>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">{info.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConfirmForm
            action={removeAgentAction.bind(null, projectId, agentType)}
            message={`¿Quitar el ${info.name.toLowerCase()} de este proyecto? Dejará de atender contactos. Su proceso se conserva por si lo vuelves a añadir.`}
          >
            <Button variant="dangerGhost">
              <Trash2 className="size-4" />
              Quitar
            </Button>
          </ConfirmForm>
          <form action={toggleAgent.bind(null, projectId, agentType, !agent.config.enabled)}>
            {agent.config.enabled ? (
              <Button variant="secondary">
                <Pause className="size-4" />
                Pausar
              </Button>
            ) : (
              <Button>
                <Play className="size-4" />
                Activar
              </Button>
            )}
          </form>
        </div>
      </div>
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
