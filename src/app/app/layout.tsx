import { Inbox, LayoutDashboard, Settings, Sheet } from "lucide-react";
import {
  CountBadge,
  Sidebar,
  SidebarBrand,
  SidebarDot,
  SidebarGroup,
  SidebarItem,
  SidebarSection,
  UserMenu,
} from "@/components/sidebar";
import { MenuSettingsButton } from "@/components/menu-settings";
import { ToastProvider } from "@/components/toast";
import { Tooltip } from "@/components/ui";
import { listMemberships, requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AgentIcon } from "@/components/agent-look-fields";
import { agentName } from "@/lib/agents";
import { listSidebarAgents } from "@/server/services/agents";
import { getNavPreferences, inOrder, NAV_SECTIONS, type NavSection } from "@/server/services/preferences";
import { listProjects } from "@/server/services/projects";
import { signOut, switchOrganization } from "./actions";
import { NewProjectButton } from "./projects/new-project";

export default async function AppLayout({ children, crumbs }: LayoutProps<"/app">) {
  const tenant = await requireTenant();
  const db = getDb();
  const [allProjects, memberships, agents, nav] = await Promise.all([
    listProjects(db, tenant),
    listMemberships(tenant.userId),
    listSidebarAgents(db, tenant),
    getNavPreferences(db, tenant),
  ]);
  // Each person arranges the sidebar their way (Mi cuenta → Menú).
  const projects = inOrder(allProjects, (p) => p.id, nav.projects);
  const pending = allProjects.reduce((n, p) => n + p.pendingApprovals, 0);
  const sections: Record<NavSection, React.ReactNode> = {
    home: (
      <SidebarItem key="home" href="/app" exact icon={<LayoutDashboard />}>
        Panel
      </SidebarItem>
    ),
    tables: (
      <SidebarItem key="tables" href="/app/tables" icon={<Sheet />}>
        Tablas
      </SidebarItem>
    ),
    inbox: (
      <SidebarItem key="inbox" href="/app/inbox" icon={<Inbox />} badge={<CountBadge count={pending} />}>
        Por aprobar
      </SidebarItem>
    ),
    settings: (
      <SidebarItem
        key="settings"
        href="/app/connections"
        also={["/app/ai", "/app/users", "/app/exclusions", "/app/audit"]}
        icon={<Settings />}
      >
        Configuración
      </SidebarItem>
    ),
  };

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar>
          <SidebarBrand
            href="/app"
            title="SalesMate"
            action={
              <MenuSettingsButton
                sections={inOrder([...NAV_SECTIONS], (k) => k, nav.sections)}
                canEditAgents={tenant.role !== "member"}
                projects={projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  paused: p.agentsPaused,
                  agents: inOrder(
                    agents.filter((a) => a.projectId === p.id),
                    (a) => a.agentType,
                    nav.agents?.[p.id],
                  ).map((a) => ({ type: a.agentType, name: a.name, icon: a.icon, color: a.color })),
                }))}
              />
            }
          />
          <SidebarSection>
            {inOrder([...NAV_SECTIONS], (k) => k, nav.sections).map((k) => sections[k])}
          </SidebarSection>

          <SidebarSection
            label="Proyectos"
            grow
            action={<NewProjectButton variant="ghost" size="sm" iconOnly label="Nuevo proyecto" />}
          >
            {projects.map((p) => (
              <SidebarGroup
                key={p.id}
                href={`/app/projects/${p.id}`}
                icon={<SidebarDot label={p.name} muted={p.agentsPaused} />}
                label={p.name}
                badge={
                  p.agentsPaused ? (
                    <Tooltip content="Agentes en pausa" align="end">
                      <span className="size-2 rounded-full bg-warning" aria-label="Agentes en pausa" />
                    </Tooltip>
                  ) : null
                }
                items={inOrder(
                  agents.filter((a) => a.projectId === p.id),
                  (a) => a.agentType,
                  nav.agents?.[p.id],
                ).map((a) => ({
                  href: `/app/projects/${p.id}/agents/${a.agentType}`,
                  icon: <AgentIcon type={a.agentType} icon={a.icon} color={a.color} />,
                  label: agentName(a.agentType, a.name),
                  badge: a.enabled ? null : (
                    <Tooltip content="En pausa" align="end">
                      <span className="size-1.5 rounded-full bg-ink-300" aria-label="En pausa" />
                    </Tooltip>
                  ),
                }))}
              />
            ))}
            {projects.length === 0 ? (
              <p className="px-2.5 py-2 text-sm text-muted">Todavía no hay proyectos.</p>
            ) : null}
          </SidebarSection>

          <UserMenu
            name={tenant.user.name}
            email={tenant.user.email}
            organization={tenant.organization}
            organizations={memberships}
            onSwitch={switchOrganization}
            onSignOut={signOut}
          />
        </Sidebar>
        <main className="min-w-0 flex-1">
          {/* Top bar with the trail, only on pages below a section. */}
          {crumbs}
          {/* Full width; forms keep their own reading width. */}
          <div className="px-8 pt-5 pb-10">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
