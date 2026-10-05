import { Activity, CheckCircle2, Circle, FolderKanban, Inbox } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader, RowLink } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActionDefinition } from "@/server/gateway/definitions";
import { listActions, listAudit, listOrgConnections, listProjects } from "@/server/services/projects";
import { formatDateTime } from "@/lib/format";
import { NewProjectButton } from "./projects/new-project";

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
    { done: projects.length > 0, label: "Crea tu primer proyecto", href: "/app/projects/new" },
  ];

  return (
    <>
      <PageHeader
        title={`Hola, ${tenant.user.name.split(" ")[0]}`}
        description="Resumen de tus proyectos y de lo que espera tu decisión."
        actions={<NewProjectButton />}
      />

      {steps.some((s) => !s.done) ? (
        <Card title="Primeros pasos" className="mb-6">
          <ol className="space-y-1 text-sm">
            {steps.map((s) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-background"
                >
                  {s.done ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <Circle className="size-4 text-muted" />
                  )}
                  <span className={s.done ? "text-muted line-through" : "font-medium"}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Proyectos">
          {projects.length === 0 ? (
            <EmptyState
              compact
              icon={<FolderKanban />}
              title="Aún no hay proyectos"
              description="Crea uno por cada empresa, marca o actividad que vendas."
              action={<NewProjectButton />}
            />
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id}>
                  <RowLink href={`/app/projects/${p.id}`}>
                    <span className="font-medium">{p.name}</span>
                    <span className="flex gap-2">
                      {p.agentsPaused ? <Badge tone="warning">Agentes pausados</Badge> : null}
                      {p.pendingApprovals > 0 ? (
                        <Badge tone="accent">{p.pendingApprovals} pendientes</Badge>
                      ) : null}
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Pendiente de aprobación">
          {pending.length === 0 ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title="Nada pendiente"
              description="Cuando un agente prepare algo que necesite tu visto bueno, aparecerá aquí."
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {pending.map(({ action, projectName }) => (
                <li key={action.id}>
                  <RowLink href="/app/inbox" className="py-2">
                    <span>
                      {getActionDefinition(action.type)?.summary(action.payload) ?? action.type}
                      <span className="block text-xs text-muted">
                        {projectName} · {formatDateTime(action.createdAt)}
                      </span>
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Actividad reciente"
          className="lg:col-span-2"
          actions={
            events.length > 0 ? (
              <LinkButton href="/app/audit" variant="ghost">
                Ver todo
              </LinkButton>
            ) : null
          }
        >
          {events.length === 0 ? (
            <EmptyState
              compact
              icon={<Activity />}
              title="Sin actividad todavía"
              description="Aquí verás lo último que han hecho las personas y los agentes de tu organización."
            />
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
