import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import { listMemberships, requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listActions, listProjects } from "@/server/services/projects";
import { signOut, switchOrganization } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const tenant = await requireTenant();
  const db = getDb();
  const [projects, pending, memberships] = await Promise.all([
    listProjects(db, tenant),
    listActions(db, tenant, { statuses: ["pending_approval"], limit: 500 }),
    listMemberships(tenant.userId),
  ]);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface p-4">
        <Link href="/app" className="px-3 text-lg font-semibold tracking-tight">
          SalesMate
        </Link>
        <p className="px-3 text-xs text-muted">{tenant.organization.name}</p>

        <nav className="mt-6 space-y-1">
          <NavLink href="/app" exact>
            Panel
          </NavLink>
          <NavLink href="/app/inbox">
            <span>Bandeja</span>
            {pending.length > 0 ? (
              <span className="rounded-full bg-accent px-2 text-xs text-accent-foreground">
                {pending.length}
              </span>
            ) : null}
          </NavLink>
          <NavLink href="/app/connections">Conexiones</NavLink>
          <NavLink href="/app/audit">Auditoría</NavLink>
        </nav>

        <div className="mt-6 px-3 text-xs font-medium uppercase tracking-wide text-muted">Proyectos</div>
        <nav className="mt-2 space-y-1">
          {projects.map((p) => (
            <NavLink key={p.id} href={`/app/projects/${p.id}`}>
              <span className="truncate">{p.name}</span>
              {p.agentsPaused ? <span className="text-xs text-warning">pausado</span> : null}
            </NavLink>
          ))}
          <NavLink href="/app/projects/new">+ Nuevo proyecto</NavLink>
        </nav>

        <div className="mt-auto space-y-2 border-t border-border pt-4 text-sm">
          {memberships.length > 1 ? (
            <details>
              <summary className="cursor-pointer px-3 text-muted">Cambiar de organización</summary>
              <div className="mt-1 space-y-1">
                {memberships
                  .filter((m) => m.id !== tenant.orgId)
                  .map((m) => (
                    <form key={m.id} action={switchOrganization.bind(null, m.id)}>
                      <button className="w-full rounded-lg px-3 py-1 text-left hover:bg-background">
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
            <button className="w-full rounded-lg px-3 py-1 text-left text-muted hover:bg-background">
              Salir
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
