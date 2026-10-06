import { LayoutDashboard, Settings, Sparkles } from "lucide-react";
import {
  CountBadge,
  Sidebar,
  SidebarBrand,
  SidebarDot,
  SidebarItem,
  SidebarSection,
  UserMenu,
} from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";
import { Tooltip } from "@/components/ui";
import { listMemberships, requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listActions, listProjects } from "@/server/services/projects";
import { signOut, switchOrganization } from "./actions";
import { NewProjectButton } from "./projects/new-project";

export default async function AppLayout({ children, crumbs }: LayoutProps<"/app">) {
  const tenant = await requireTenant();
  const db = getDb();
  const [projects, pending, memberships] = await Promise.all([
    listProjects(db, tenant),
    listActions(db, tenant, { statuses: ["pending_approval"], limit: 500 }),
    listMemberships(tenant.userId),
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
            <SidebarItem
              href="/app/copilot"
              also={["/app/inbox"]}
              icon={<Sparkles />}
              badge={<CountBadge count={pending.length} />}
            >
              Copilot
            </SidebarItem>
            <SidebarItem href="/app/connections" also={["/app/exclusions", "/app/audit"]} icon={<Settings />}>
              Configuración
            </SidebarItem>
          </SidebarSection>

          <SidebarSection
            label="Proyectos"
            grow
            action={<NewProjectButton variant="ghost" size="sm" iconOnly label="Nuevo proyecto" />}
          >
            {projects.map((p) => (
              <SidebarItem
                key={p.id}
                href={`/app/projects/${p.id}`}
                icon={<SidebarDot label={p.name} muted={p.agentsPaused} />}
                badge={
                  p.agentsPaused ? (
                    <Tooltip content="Agentes en pausa" align="end">
                      <span className="size-2 rounded-full bg-warning" aria-label="Agentes en pausa" />
                    </Tooltip>
                  ) : null
                }
              >
                {p.name}
              </SidebarItem>
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
          {/* Full width; forms keep their own reading width. */}
          <div className="px-8 pt-5 pb-10">
            {crumbs}
            {children}
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
