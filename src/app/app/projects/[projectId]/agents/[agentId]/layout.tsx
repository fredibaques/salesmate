import { Pencil, Trash2 } from "lucide-react";
import { requireAgent } from "./require-agent";
import { ActionForm } from "@/components/action-form";
import { AgentLookFields, AgentTile, agentState } from "@/components/agent-look-fields";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmForm } from "@/components/confirm-form";
import { ModalButton } from "@/components/modal";
import { TabLink, Tabs } from "@/components/nav-link";
import { SwitchButton } from "@/components/switch";
import { Button, Field, Input, PageHeader } from "@/components/ui";
import { AGENT_INFO, agentName } from "@/lib/agents";
import type { ProjectAgentType } from "@/server/services/agents";
import {
  customizeAgentAction,
  removeAgentAction,
  runInboundNow,
  runOutreachNow,
  runProspectingNow,
  toggleAgent,
} from "../actions";

export default async function AgentLayout({
  children,
  params,
}: LayoutProps<"/app/projects/[projectId]/agents/[agentId]">) {
  const { projectId, agentId } = await params;
  const { tenant, agent } = await requireAgent(projectId, agentId);
  const agentType = agent.config.agentType as ProjectAgentType;
  const base = `/app/projects/${projectId}/agents/${agentId}`;
  const info = AGENT_INFO[agentType];
  const name = agentName(agentType, agent.config.name);

  return (
    <>
      {/* While it works, the page follows it (and the dot turns grey when it ends). */}
      {agent.working ? <AutoRefresh seconds={10} /> : null}
      <PageHeader
        media={
          <AgentTile
            type={agentType}
            icon={agent.config.icon}
            color={agent.config.color}
            size="title"
            state={agentState({ enabled: agent.config.enabled, working: agent.working })}
          />
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
              action={customizeAgentAction.bind(null, projectId, agentId)}
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
            {tenant.role !== "member" ? (
              <ActionForm
                action={
                  agentType === "prospecting"
                    ? runProspectingNow.bind(null, projectId, agentId)
                    : agentType === "outbound"
                      ? runOutreachNow.bind(null, projectId, agentId)
                      : runInboundNow.bind(null, projectId, agentId)
                }
                submitLabel="Ejecutar ahora"
                submitVariant="secondary"
                className="flex items-center"
              >
                {/* Then its Log, which follows the run while it works. */}
                <input type="hidden" name="back" value={`${base}/log`} />
              </ActionForm>
            ) : null}
            <ConfirmForm
              action={removeAgentAction.bind(null, projectId, agentId)}
              message={`¿Quitar «${name}» de este proyecto? Dejará de trabajar; sus ejecuciones se conservan en el registro.`}
            >
              <Button variant="dangerGhost">
                <Trash2 className="size-4" />
                Quitar
              </Button>
            </ConfirmForm>
            <form
              action={toggleAgent.bind(null, projectId, agentId, !agent.config.enabled)}
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
        <TabLink href={base} exact also={[`${base}/automation`, `${base}/instructions`]}>
          Configuración
        </TabLink>
        <TabLink href={`${base}/channels`}>Herramientas</TabLink>
        <TabLink href={`${base}/log`}>Log</TabLink>
        <TabLink href={`${base}/approvals`}>Aprobaciones</TabLink>
      </Tabs>
      {children}
    </>
  );
}
