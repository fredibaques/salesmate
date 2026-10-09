"use client";

import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Pencil,
  Plug,
  Settings,
  Settings2,
  Sheet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { resetMenu, saveMenu } from "@/app/app/account/actions";
import { setProjectColorAction } from "@/app/app/projects/[projectId]/actions";
import { customizeAgentAction } from "@/app/app/projects/[projectId]/agents/actions";
import { AGENT_INFO, agentName, type ProjectAgentKey } from "@/lib/agents";
import { ActionForm } from "./action-form";
import { AgentIcon, AgentLookFields, ColorField } from "./agent-look-fields";
import { ModalButton } from "./modal";
import { SidebarDot } from "./sidebar";
import { buttonClass, cx, Field, Input } from "./ui";

export type MenuAgent = {
  type: ProjectAgentKey;
  name: string | null;
  icon: string | null;
  color: string | null;
};
export type MenuProject = {
  id: string;
  name: string;
  color: string | null;
  paused: boolean;
  agents: MenuAgent[];
};

const SECTIONS: Record<string, { label: string; icon: ReactNode }> = {
  home: { label: "Panel", icon: <LayoutDashboard className="size-4 text-muted" /> },
  conversations: { label: "Conversaciones", icon: <MessagesSquare className="size-4 text-muted" /> },
  tables: { label: "Tablas", icon: <Sheet className="size-4 text-muted" /> },
  knowledge: { label: "Conocimiento", icon: <BookOpen className="size-4 text-muted" /> },
  integrations: { label: "Integraciones", icon: <Plug className="size-4 text-muted" /> },
  inbox: { label: "Por aprobar", icon: <Inbox className="size-4 text-muted" /> },
  settings: { label: "Configuración", icon: <Settings className="size-4 text-muted" /> },
};

function move(list: string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** `keys` in the order of `order` (kept in state), with new ones after. */
function ordered(keys: string[], order: string[]): string[] {
  const known = order.filter((k) => keys.includes(k));
  return [...known, ...keys.filter((k) => !known.includes(k))];
}

function Arrows({
  label,
  index,
  count,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const arrow = cx(buttonClass({ variant: "ghost", size: "sm", iconOnly: true }), "disabled:opacity-30");
  return (
    <>
      <button
        type="button"
        className={arrow}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        aria-label={`Subir ${label}`}
      >
        <ArrowUp className="size-4" />
      </button>
      <button
        type="button"
        className={arrow}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        aria-label={`Bajar ${label}`}
      >
        <ArrowDown className="size-4" />
      </button>
    </>
  );
}

const rowClass = "flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-50";

/**
 * The sidebar's own settings: the order of its sections, projects and each
 * project's agents (for this person), and each agent's name, icon and colour
 * (for the whole team). Rows always come from the latest data; only the
 * order lives here until it is saved.
 */
function MenuEditor({
  sections,
  projects,
  canEditAgents,
}: {
  sections: string[];
  projects: MenuProject[];
  canEditAgents: boolean;
}) {
  const [sectionOrder, setSectionOrder] = useState(sections);
  const [projectOrder, setProjectOrder] = useState(projects.map((p) => p.id));
  const [agentOrder, setAgentOrder] = useState<Record<string, string[]>>(
    Object.fromEntries(projects.map((p) => [p.id, p.agents.map((a) => a.type)])),
  );
  const [editing, setEditing] = useState<string | null>(null);

  const sectionKeys = ordered(sections, sectionOrder);
  const projectIds = ordered(
    projects.map((p) => p.id),
    projectOrder,
  );
  const agentsOf = (p: MenuProject) =>
    ordered(
      p.agents.map((a) => a.type),
      agentOrder[p.id] ?? [],
    ).map((type) => p.agents.find((a) => a.type === type)!);
  const nav = {
    sections: sectionKeys,
    projects: projectIds,
    agents: Object.fromEntries(projects.map((p) => [p.id, agentsOf(p).map((a) => a.type)])),
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Secciones</h3>
        {sectionKeys.map((key, i) => (
          <div key={key} className={rowClass}>
            {SECTIONS[key]?.icon}
            <span className="min-w-0 flex-1 truncate text-sm">{SECTIONS[key]?.label ?? key}</span>
            <Arrows
              label={SECTIONS[key]?.label ?? key}
              index={i}
              count={sectionKeys.length}
              onMove={(to) => setSectionOrder(move(sectionKeys, i, to))}
            />
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Proyectos y agentes</h3>
        {projects.length === 0 ? <p className="px-2 text-sm text-muted">Todavía no hay proyectos.</p> : null}
        {projectIds.map((id, i) => {
          const project = projects.find((p) => p.id === id)!;
          const agents = agentsOf(project);
          const projectOpen = editing === id;
          return (
            <div key={id}>
              <div className={rowClass}>
                <SidebarDot label={project.name} muted={project.paused} color={project.color} />
                <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                {canEditAgents ? (
                  <button
                    type="button"
                    onClick={() => setEditing(projectOpen ? null : id)}
                    aria-expanded={projectOpen}
                    aria-label={`Personalizar ${project.name}`}
                    className={cx(
                      buttonClass({ variant: "ghost", size: "sm", iconOnly: true }),
                      projectOpen && "bg-ink-100",
                    )}
                  >
                    <Pencil className="size-4" />
                  </button>
                ) : null}
                <Arrows
                  label={project.name}
                  index={i}
                  count={projectIds.length}
                  onMove={(to) => setProjectOrder(move(projectIds, i, to))}
                />
              </div>
              {projectOpen ? (
                <div className="my-2 ml-9 rounded-lg border border-border p-4">
                  <ActionForm
                    key={project.color ?? ""}
                    action={setProjectColorAction.bind(null, id)}
                    submitLabel="Guardar el color"
                    submitVariant="secondary"
                    cancel={false}
                    stayOpen
                    className="space-y-4"
                  >
                    <ColorField label="Color del proyecto" color={project.color} />
                  </ActionForm>
                </div>
              ) : null}
              {agents.map((agent, j) => {
                const name = agentName(agent.type, agent.name);
                const editKey = `${id}:${agent.type}`;
                const open = editing === editKey;
                return (
                  <div key={agent.type}>
                    <div className={cx(rowClass, "pl-9")}>
                      <AgentIcon type={agent.type} icon={agent.icon} color={agent.color} className="size-4" />
                      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                      {canEditAgents ? (
                        <button
                          type="button"
                          onClick={() => setEditing(open ? null : editKey)}
                          aria-expanded={open}
                          aria-label={`Personalizar ${name}`}
                          className={cx(
                            buttonClass({ variant: "ghost", size: "sm", iconOnly: true }),
                            open && "bg-ink-100",
                          )}
                        >
                          <Pencil className="size-4" />
                        </button>
                      ) : null}
                      <Arrows
                        label={name}
                        index={j}
                        count={agents.length}
                        onMove={(to) =>
                          setAgentOrder({
                            ...agentOrder,
                            [id]: move(
                              agents.map((a) => a.type),
                              j,
                              to,
                            ),
                          })
                        }
                      />
                    </div>
                    {open ? (
                      <div className="my-2 ml-9 rounded-lg border border-border p-4">
                        <ActionForm
                          // Fresh fields after each save.
                          key={`${agent.name}|${agent.icon}|${agent.color}`}
                          action={customizeAgentAction.bind(null, id, agent.type)}
                          submitLabel="Guardar el agente"
                          submitVariant="secondary"
                          cancel={false}
                          stayOpen
                          className="space-y-4"
                        >
                          <Field
                            label="Nombre"
                            hint={`Vacío para volver a «${AGENT_INFO[agent.type].name}».`}
                          >
                            <Input
                              name="name"
                              maxLength={60}
                              defaultValue={agent.name ?? ""}
                              placeholder={AGENT_INFO[agent.type].name}
                            />
                          </Field>
                          <AgentLookFields type={agent.type} icon={agent.icon} color={agent.color} />
                        </ActionForm>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <ActionForm action={saveMenu} submitLabel="Guardar el orden" cancel={false}>
          <input type="hidden" name="nav" value={JSON.stringify(nav)} />
        </ActionForm>
        <ActionForm action={resetMenu} submitLabel="Orden por defecto" submitVariant="ghost" cancel={false} />
      </div>
    </div>
  );
}

/** The gear of the sidebar: opens its settings. */
export function MenuSettingsButton(props: {
  sections: string[];
  projects: MenuProject[];
  canEditAgents: boolean;
}) {
  return (
    <ModalButton
      label="Personalizar el menú"
      icon={<Settings2 className="size-4" />}
      title="Personalizar el menú"
      variant="ghost"
      size="sm"
      iconOnly
      width="lg"
      className="text-muted"
    >
      <MenuEditor {...props} />
    </ModalButton>
  );
}
