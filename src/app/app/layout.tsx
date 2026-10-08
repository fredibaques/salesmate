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
import { ToastProvider } from "@/components/toast";
import { Tooltip } from "@/components/ui";
import { listMemberships, requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AGENT_ICONS } from "@/components/agent-icons";
import { AGENT_INFO } from "@/lib/agents";
import { listSidebarAgents } from "@/server/services/agents";
import { listActions, listProjects } from "@/server/services/projects";
import { signOut, switchOrganization } from "./actions";
import { NewProjectButton } from "./projects/new-project";

export default async function AppLayout({ children, crumbs }: LayoutProps<"/app">) {
  const tenant = await requireTenant();
  const db = getDb();
  const [projects, pending, memberships, agents] = await Promise.all([
    listProjects(db, tenant),
    listActions(db, tenant, { statuses: ["pending_approval"], limit: 500 }),
    listMemberships(tenant.userId),
    listSidebarAgents(db, tenant),
  ]);

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar>
          <SidebarBrand href="/app" title="SalesMate" />
          <SidebarSection>
            <SidebarItem href="/app" exact icon={<LayoutDashboard />}>
              Panel
            </SidebarItem>
            <SidebarItem href="/app/tables" icon={<Sheet />}>
              Tablas
            </SidebarItem>
            <SidebarItem href="/app/inbox" icon={<Inbox />} badge={<CountBadge count={pending.length} />}>
              Por aprobar
            </SidebarItem>
            <SidebarItem
              href="/app/connections"
              also={["/app/ai", "/app/exclusions", "/app/audit"]}
              icon={<Settings />}
            >
              Configuración
            </SidebarItem>
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
                items={agents
                  .filter((a) => a.projectId === p.id)
                  .map((a) => ({
                    href: `/app/projects/${p.id}/agents/${a.agentType}`,
                    icon: AGENT_ICONS[a.agentType],
                    label: AGENT_INFO[a.agentType].name,
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
