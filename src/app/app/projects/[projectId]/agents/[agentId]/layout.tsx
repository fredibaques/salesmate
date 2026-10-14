import { Pencil, Trash2 } from "lucide-react";
import { Suspense } from "react";
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
  toggleAgent,
} from "../actions";
import { FindNowButton } from "../find-now";
import { ApprovalsSettings } from "./approvals-settings";
import { AgentConfigModal } from "./config-modal";
import { InboundSetup } from "./inbound-setup";
import { OutreachSetup } from "./outreach-setup";
import { ProspectingSetup } from "./prospecting-setup";

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
            <Suspense>
              <AgentConfigModal
                setup={
                  agentType === "prospecting" ? (
                    <ProspectingSetup projectId={projectId} agentId={agentId} />
                  ) : agentType === "outbound" ? (
                    <OutreachSetup projectId={projectId} agentId={agentId} />
                  ) : (
                    <InboundSetup projectId={projectId} agentId={agentId} />
                  )
                }
                approvals={
                  <ApprovalsSettings
                    projectId={projectId}
                    agentId={agentId}
                    autonomy={agent.config.autonomy}
                    limits={agent.config.limits}
                  />
                }
              />
            </Suspense>
            {tenant.role !== "member" && agentType === "prospecting" ? (
              <FindNowButton
                projectId={projectId}
                agentId={agentId}
                settings={agent.config.settings}
                back={base}
                label="Ejecutar ahora"
              />
            ) : tenant.role !== "member" ? (
              <ActionForm
                action={
                  agentType === "outbound"
                    ? runOutreachNow.bind(null, projectId, agentId)
                    : runInboundNow.bind(null, projectId, agentId)
                }
                submitLabel="Ejecutar ahora"
                submitVariant="secondary"
                className="flex items-center"
              >
                {/* Then its Tareas, which follows the run while it works. */}
                <input type="hidden" name="back" value={base} />
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
        <TabLink href={base} exact>
          Tareas
        </TabLink>
        <TabLink href={`${base}/channels`}>Herramientas</TabLink>
      </Tabs>
      {children}
    </>
  );
}
