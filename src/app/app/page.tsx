import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listActions, listAudit, listOrgConnections, listProjects } from "@/server/services/projects";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Panel" };

export default async function DashboardPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [projects, pending, connections, events] = await Promise.all([
    listProjects(db, tenant),
    listActions(db, tenant, { statuses: ["pending_approval"], limit: 5 }),
    listOrgConnections(db, tenant),
    listAudit(db, tenant, { limit: 8 }),
  ]);

  const steps = [
    {
      done: connections.length > 0,
      label: "Conecta tus herramientas (CRM, correo, calendario)",
      href: "/app/connections",
    },
    { done: projects.length > 0, label: "Crea tus proyectos", href: "/app/projects/new" },
  ];

  return (
    <>
      <PageHeader
        title={`Hola, ${tenant.user.name.split(" ")[0]}`}
        description="Resumen de tus proyectos y de lo que espera tu decisión."
        actions={
          <LinkButton href="/app/projects/new" variant="primary">
            Nuevo proyecto
          </LinkButton>
        }
      />

      {steps.some((s) => !s.done) ? (
        <Card title="Primeros pasos" className="mb-6">
          <ol className="space-y-2 text-sm">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span className={s.done ? "text-success" : "text-muted"}>{s.done ? "✓" : "○"}</span>
                <Link href={s.href} className={s.done ? "text-muted line-through" : "text-accent"}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Proyectos">
          {projects.length === 0 ? (
            <EmptyState>Aún no hay proyectos.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <Link href={`/app/projects/${p.id}`} className="font-medium hover:text-accent">
                    {p.name}
                  </Link>
                  <span className="flex gap-2">
                    {p.agentsPaused ? <Badge tone="warning">Agentes pausados</Badge> : null}
                    {p.pendingApprovals > 0 ? (
                      <Badge tone="accent">{p.pendingApprovals} pendientes</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Pendiente de aprobación">
          {pending.length === 0 ? (
            <EmptyState>Nada pendiente.</EmptyState>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {pending.map(({ action, projectName }) => (
                <li key={action.id} className="py-2">
                  <Link href="/app/inbox" className="hover:text-accent">
                    {action.type} · {projectName}
                  </Link>
                  <div className="text-xs text-muted">{formatDateTime(action.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Actividad reciente" className="lg:col-span-2">
          {events.length === 0 ? (
            <EmptyState>Sin actividad todavía.</EmptyState>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between gap-4 py-2">
                  <span>
                    <code className="text-xs">{e.event}</code>{" "}
                    <span className="text-muted">{summarize(e.data)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function summarize(data: Record<string, unknown>) {
  const s = (data.summary ?? data.name ?? data.type ?? "") as string;
  return typeof s === "string" ? s : "";
}
