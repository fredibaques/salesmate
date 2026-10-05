import { Activity, Bot, CheckCircle2, Circle, FolderKanban, Inbox } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardGrid,
  EmptyState,
  EntityCard,
  LinkButton,
  PageHeader,
  RowLink,
} from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActionDefinition } from "@/server/gateway/definitions";
import { listActions, listAudit, listOrgConnections, listProjects } from "@/server/services/projects";
import { describeEvent, formatDateTime } from "@/lib/format";
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

      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold">Proyectos</h2>
        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            title="Aún no hay proyectos"
            description="Crea uno por cada empresa, marca o actividad que vendas. Dentro añadirás sus agentes y lo que necesitan saber."
            action={<NewProjectButton />}
          />
        ) : (
          <CardGrid>
            {projects.map((p) => {
              const active = p.agents.filter((a) => a.enabled).length;
              return (
                <EntityCard
                  key={p.id}
                  href={`/app/projects/${p.id}`}
                  icon={<FolderKanban />}
                  title={p.name}
                  meta={p.website?.replace(/^https?:\/\//, "") || null}
                  badge={p.agentsPaused ? <Badge tone="warning">En pausa</Badge> : null}
                  description={p.description ?? undefined}
                  footer={
                    <>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <Bot className="size-3.5" />
                        {p.agents.length === 0
                          ? "Sin agentes"
                          : `${active} de ${p.agents.length} ${p.agents.length === 1 ? "agente activo" : "agentes activos"}`}
                      </span>
                      {p.pendingApprovals > 0 ? (
                        <Badge tone="accent">{p.pendingApprovals} por aprobar</Badge>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </CardGrid>
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
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
                    {describeEvent(e.event)} <span className="text-muted">{summarize(e.data)}</span>
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
