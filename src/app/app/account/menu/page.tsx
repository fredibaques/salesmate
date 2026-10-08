import { Inbox, LayoutDashboard, Pencil, Settings, Sheet } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AgentIcon, AgentLookFields } from "@/components/agent-look-fields";
import { ModalButton } from "@/components/modal";
import { SidebarDot } from "@/components/sidebar";
import { Card, Field, Input } from "@/components/ui";
import { AGENT_INFO, agentName } from "@/lib/agents";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getNavPreferences, inOrder, NAV_SECTIONS } from "@/server/services/preferences";
import { listSidebarAgents } from "@/server/services/agents";
import { listProjects } from "@/server/services/projects";
import { customizeAgentAction } from "../../projects/[projectId]/agents/actions";
import { resetMenu } from "../actions";
import { MenuEditor } from "./menu-editor";

export const metadata = { title: "Menú" };

const SECTIONS = {
  home: { label: "Panel", icon: <LayoutDashboard className="text-muted" /> },
  tables: { label: "Tablas", icon: <Sheet className="text-muted" /> },
  inbox: { label: "Por aprobar", icon: <Inbox className="text-muted" /> },
  settings: { label: "Configuración", icon: <Settings className="text-muted" /> },
};

/** How the signed-in person arranges the sidebar, and how its agents look. */
export default async function MenuPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [projects, agents, nav] = await Promise.all([
    listProjects(db, tenant),
    listSidebarAgents(db, tenant),
    getNavPreferences(db, tenant),
  ]);
  const canEdit = tenant.role !== "member";

  return (
    <>
      <Card
        title="Menú lateral"
        tip="Ordena las secciones, los proyectos y los agentes de cada proyecto. El orden es solo tuyo; el icono y el color de un agente los ve todo el equipo."
      >
        <MenuEditor
          sections={inOrder([...NAV_SECTIONS], (k) => k, nav.sections).map((k) => ({
            key: k,
            ...SECTIONS[k],
          }))}
          projects={inOrder(projects, (p) => p.id, nav.projects).map((p) => ({
            key: p.id,
            label: p.name,
            icon: <SidebarDot label={p.name} muted={p.agentsPaused} />,
            agents: inOrder(
              agents.filter((a) => a.projectId === p.id),
              (a) => a.agentType,
              nav.agents?.[p.id],
            ).map((a) => {
              const name = agentName(a.agentType, a.name);
              return {
                key: a.agentType,
                label: name,
                icon: <AgentIcon type={a.agentType} icon={a.icon} color={a.color} />,
                extra: canEdit ? (
                  <ModalButton
                    label={`Personalizar ${name}`}
                    icon={<Pencil className="size-4" />}
                    title="Personalizar el agente"
                    variant="ghost"
                    size="sm"
                    iconOnly
                  >
                    <ActionForm
                      action={customizeAgentAction.bind(null, p.id, a.agentType)}
                      submitLabel="Guardar"
                      className="space-y-4"
                    >
                      <Field label="Nombre" hint={`Vacío para volver a «${AGENT_INFO[a.agentType].name}».`}>
                        <Input
                          name="name"
                          maxLength={60}
                          defaultValue={a.name ?? ""}
                          placeholder={AGENT_INFO[a.agentType].name}
                        />
                      </Field>
                      <AgentLookFields type={a.agentType} icon={a.icon} color={a.color} />
                    </ActionForm>
                  </ModalButton>
                ) : null,
              };
            }),
          }))}
        />
      </Card>
      {nav.sections || nav.projects ? (
        <ActionForm action={resetMenu} submitLabel="Volver al orden por defecto" submitVariant="ghost" />
      ) : null}
    </>
  );
}
