import { FolderKanban, LayoutDashboard, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import { ToastProvider } from "@/components/toast";
import { listMemberships, requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listActions, listProjects } from "@/server/services/projects";
import { signOut, switchOrganization } from "./actions";
import { NewProjectButton } from "./projects/new-project";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
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
        {/* The sidebar is always exactly one screen tall: only the project list scrolls. */}
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
          <div className="px-7 pb-2 pt-5">
            <Link href="/app" className="text-lg font-semibold tracking-tight">
              SalesMate
            </Link>
            <p className="truncate text-xs text-muted">{tenant.organization.name}</p>
          </div>

          <nav className="mt-3 space-y-1 px-4">
            <NavLink href="/app" exact icon={<LayoutDashboard />}>
              Panel
            </NavLink>
            <NavLink
              href="/app/copilot"
              also={["/app/inbox"]}
              icon={<Sparkles />}
              badge={
                pending.length > 0 ? (
                  <span className="rounded-full bg-accent px-2 text-xs text-accent-foreground">
                    {pending.length}
                  </span>
                ) : null
              }
            >
              Copilot
            </NavLink>
            <NavLink href="/app/connections" also={["/app/exclusions", "/app/audit"]} icon={<Settings />}>
              Configuración
            </NavLink>
          </nav>

          <div className="mt-6 flex items-center justify-between px-7 text-xs font-medium uppercase tracking-wide text-muted">
            Proyectos
          </div>
          <nav className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-2">
            {projects.map((p) => (
              <NavLink
                key={p.id}
                href={`/app/projects/${p.id}`}
                icon={<FolderKanban />}
                badge={p.agentsPaused ? <span className="text-xs text-warning">pausado</span> : null}
              >
                {p.name}
              </NavLink>
            ))}
            <NewProjectButton
              variant="ghost"
              label="Nuevo proyecto"
              className="w-full justify-start gap-2.5 font-normal text-muted hover:text-foreground"
            />
          </nav>

          <div className="space-y-1 border-t border-border p-4 text-sm">
            {memberships.length > 1 ? (
              <details>
                <summary className="rounded-lg px-3 py-1 text-muted transition-colors hover:bg-background hover:text-foreground">
                  Cambiar de organización
                </summary>
                <div className="mt-1 space-y-1">
                  {memberships
                    .filter((m) => m.id !== tenant.orgId)
                    .map((m) => (
                      <form key={m.id} action={switchOrganization.bind(null, m.id)}>
                        <button className="w-full rounded-lg px-3 py-1 text-left transition-colors hover:bg-background">
                          {m.name}
                        </button>
                      </form>
                    ))}
                </div>
              </details>
            ) : null}
            <div className="truncate px-3 text-muted" title={tenant.user.email}>
              {tenant.user.email}
            </div>
            <form action={signOut}>
              <button className="w-full rounded-lg px-3 py-1 text-left text-muted transition-colors hover:bg-background hover:text-foreground">
                Salir
              </button>
            </form>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
