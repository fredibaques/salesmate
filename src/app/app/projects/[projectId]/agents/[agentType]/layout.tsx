import { Pencil, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AgentLookFields, AgentTile } from "@/components/agent-look-fields";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { ModalButton } from "@/components/modal";
import { TabLink, Tabs } from "@/components/nav-link";
import { SwitchButton } from "@/components/switch";
import { Button, Field, Input, PageHeader } from "@/components/ui";
import { AGENT_INFO, agentName } from "@/lib/agents";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAgent, isProjectAgentType } from "@/server/services/agents";
import { removeAgentAction, customizeAgentAction, toggleAgent } from "../actions";

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
  const name = agentName(agentType, agent.config.name);

  return (
    <>
      <PageHeader
        media={
          <AgentTile type={agentType} icon={agent.config.icon} color={agent.config.color} size="title" />
        }
        title={name}
        badge={
          <ModalButton
            label="Personalizar el agente"
            icon={<Pencil className="size-4" />}
            title="Personalizar el agente"
            variant="ghost"
            size="sm"
            iconOnly
          >
            <ActionForm
              action={customizeAgentAction.bind(null, projectId, agentType)}
              submitLabel="Guardar"
              className="space-y-4"
            >
              <Field label="Nombre" hint={`Vacío para volver a «${info.name}».`}>
                <Input
                  name="name"
                  maxLength={60}
                  defaultValue={agent.config.name ?? ""}
                  placeholder={info.name}
                />
              </Field>
              <AgentLookFields type={agentType} icon={agent.config.icon} color={agent.config.color} />
            </ActionForm>
          </ModalButton>
        }
        actions={
          <>
            <ConfirmForm
              action={removeAgentAction.bind(null, projectId, agentType)}
              message={`¿Quitar «${name}» de este proyecto? Dejará de atender contactos. Su proceso se conserva por si lo vuelves a añadir.`}
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
                label={agent.config.enabled ? `Pausar «${name}»` : `Activar «${name}»`}
              />
            </form>
          </>
        }
      />
      <Tabs>
        {agentType === "outbound" ? (
          <>
            <TabLink href={base} exact>
              Instrucciones
            </TabLink>
            <TabLink href={`${base}/channels`}>Herramientas</TabLink>
            <TabLink href={`${base}/automation`}>Automatización</TabLink>
          </>
        ) : (
          <>
            <TabLink href={base} exact>
              Proceso de venta
            </TabLink>
            <TabLink href={`${base}/instructions`}>Instrucciones</TabLink>
            <TabLink href={`${base}/channels`}>Canales y herramientas</TabLink>
          </>
        )}
        <TabLink href={`${base}/approvals`}>Aprobaciones</TabLink>
      </Tabs>
      {children}
    </>
  );
}
