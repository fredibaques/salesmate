import {
  Activity,
  Bot,
  Building2,
  CheckCircle2,
  Circle,
  FolderKanban,
  Inbox,
  Plug,
  Sheet,
  User,
} from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardGrid,
  EmptyState,
  EntityCard,
  LinkButton,
  Notice,
  RowLink,
  Table,
  Td,
} from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActionDefinition } from "@/server/gateway/definitions";
import { listActions, listAudit, listOrgConnections, listProjects } from "@/server/services/projects";
import { describeEvent, formatDateTime, plural } from "@/lib/format";
import { listAllBases } from "@/server/prospects/bases";
import { AI_CONNECT_HREF, AiNotice, currentAi } from "./ai-notice";
import { CopilotChat } from "./home/copilot-chat";
import { NewProjectButton } from "./projects/new-project";

export const metadata = { title: "Panel" };

/**
 * The home: Copilot to ask or ask for anything, and below it the latest
 * tables, the projects, what waits for approval and the latest activity.
 */
export default async function DashboardPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [projects, pending, connections, events, ai, bases] = await Promise.all([
    listProjects(db, tenant),
    listActions(db, tenant, { statuses: ["pending_approval"], limit: 5 }),
    listOrgConnections(db, tenant),
    listAudit(db, tenant, { limit: 8 }),
    currentAi(),
    listAllBases(db, tenant),
  ]);
  const first = tenant.user.name.split(" ")[0];
  // Copilot is always the top of the home; until it can answer, it says why and how to fix it.
  const unavailable = !ai ? (
    <Notice
      tone="warning"
      action={
        <LinkButton href={AI_CONNECT_HREF} size="sm">
          Conectar IA
        </LinkButton>
      }
    >
      Copilot usa la cuenta de IA de tu organización (Anthropic, OpenAI o Kimi). Conéctala para empezar.
    </Notice>
  ) : projects.length === 0 ? (
    <Notice action={<NewProjectButton size="sm" />}>
      Copilot responde con la información de tus proyectos: crea el primero.
    </Notice>
  ) : null;
  const shortcuts = (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-muted">O empieza por</p>
      <div className="flex flex-wrap justify-center gap-2">
        <LinkButton href="/app/tables" variant="secondary">
          <Sheet />
          Una tabla de prospectos
        </LinkButton>
        <NewProjectButton variant="secondary" label="Un proyecto nuevo" />
        <LinkButton href="/app/connections/new" variant="secondary">
          <Plug />
          Conectar herramientas
        </LinkButton>
      </div>
    </div>
  );

  const steps = [
    { done: Boolean(ai), label: "Conecta tu IA (Anthropic, OpenAI o Kimi)", href: AI_CONNECT_HREF },
    {
      done: connections.length > 0,
      label: "Conecta tus herramientas (CRM, correo, calendario)",
      href: "/app/connections",
    },
    { done: projects.length > 0, label: "Crea tu primer proyecto", href: "/app/projects/new" },
  ];

  const home = (
    <>
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

      {bases.length > 0 ? (
        <Card
          title="Tablas recientes"
          className="mb-8"
          actions={
            <LinkButton href="/app/tables" variant="ghost">
              Ver todas
            </LinkButton>
          }
        >
          <Table head={["Tabla", "Proyecto", "Filas", "Última actividad"]}>
            {bases.slice(0, 5).map((b) => (
              <tr key={b.id} className="relative transition-colors hover:bg-ink-25">
                <Td>
                  <Link
                    href={`/app/projects/${b.projectId}/prospects/${b.id}`}
                    className="inline-flex items-center gap-2 font-medium after:absolute after:inset-0 hover:text-accent"
                  >
                    {b.rowKind === "person" ? (
                      <User className="size-4 text-muted" aria-hidden />
                    ) : (
                      <Building2 className="size-4 text-muted" aria-hidden />
                    )}
                    {b.name}
                  </Link>
                </Td>
                <Td className="text-muted">{b.projectName}</Td>
                <Td className="tabular-nums">{plural(b.rows, "fila", "filas")}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(b.lastActivity)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Proyectos</h2>
          {projects.length ? <NewProjectButton variant="ghost" /> : null}
        </div>
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

  return (
    <>
      <CopilotChat
        title={`Hola, ${first}. ¿En qué te ayudo?`}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        unavailable={unavailable ?? (ai?.status === "active" ? null : <AiNotice feature="Copilot" />)}
        shortcuts={shortcuts}
      >
        {home}
      </CopilotChat>
    </>
  );
}

function summarize(data: Record<string, unknown>) {
  const s = (data.summary ?? data.name ?? data.column ?? data.base ?? data.type ?? "") as string;
  return typeof s === "string" ? s : "";
}
