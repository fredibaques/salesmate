import { Bot, CheckCircle2, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSalesProfile, listProjectAgents } from "@/server/services/agents";
import { listKnowledge } from "@/server/services/projects";
import { AddAgentButton, AgentCards } from "./agents/agent-cards";

/**
 * The project's summary: what is left to set it up and its agents. Each
 * agent also has its own entry under the project in the sidebar.
 */
export default async function ProjectOverviewPage({ params }: PageProps<"/app/projects/[projectId]">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [profile, sources, agents] = await Promise.all([
    getSalesProfile(db, tenant, projectId),
    listKnowledge(db, tenant, projectId),
    listProjectAgents(db, tenant, projectId),
  ]);
  const base = `/app/projects/${projectId}`;
  const firstAgent = agents[0]?.config.agentType;
  const steps = [
    {
      done: Boolean(profile.offer || profile.valueProposition || profile.segment.include.length),
      label: "Describe tu oferta y tu cliente ideal",
      hint: "Lo comparten todos los agentes del proyecto.",
      href: `${base}/settings#oferta`,
    },
    {
      done: sources.length > 0,
      label: "Sube tu conocimiento",
      hint: "Tarifas, condiciones, presentaciones… para que respondan con datos reales.",
      href: `${base}/knowledge`,
    },
    {
      done: agents.length > 0,
      label: "Añade un agente y define su proceso de venta",
      hint: "Por ejemplo, el inbound para atender a quien te contacta.",
      href: `${base}#agentes`,
    },
    {
      // Only agents that write to people need a mailbox.
      done:
        agents.length > 0 &&
        agents.every((a) => a.config.agentType === "outbound" || a.config.channels.mailboxId),
      label: "Dile con qué cuentas y herramientas trabaja",
      hint: "Usa las cuentas que tu organización ya ha conectado.",
      href: firstAgent ? `${base}/agents/${firstAgent}/channels` : `${base}#agentes`,
    },
    {
      done: agents.some((a) => a.config.enabled),
      label: "Actívalo",
      hint: "Hasta entonces, los contactos se guardan pero nadie los atiende.",
      href: firstAgent ? `${base}/agents/${firstAgent}` : `${base}#agentes`,
    },
  ];
  const pending = steps.filter((x) => !x.done).length;
  const canEdit = tenant.role !== "member";

  return (
    <div className="space-y-6">
      {canEdit && agents.length > 0 ? (
        <Toolbar>
          <AddAgentButton projectId={projectId} agents={agents} />
        </Toolbar>
      ) : null}
      {pending > 0 ? (
        <Card
          title="Puesta en marcha"
          actions={<Badge tone="accent">{pending === 1 ? "Queda 1 paso" : `Quedan ${pending} pasos`}</Badge>}
        >
          <ol className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            {steps.map((step, i) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-background"
                >
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted" />
                  )}
                  <span className="flex-1">
                    <span className={step.done ? "text-sm text-muted line-through" : "text-sm font-medium"}>
                      {i + 1}. {step.label}
                    </span>
                    {!step.done ? <span className="block text-xs text-muted">{step.hint}</span> : null}
                  </span>
                  <ChevronRight className="mt-0.5 size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <section id="agentes" className="scroll-mt-6">
        {agents.length > 0 ? (
          <AgentCards projectId={projectId} agents={agents} />
        ) : (
          <EmptyState
            icon={<Bot />}
            title="Este proyecto todavía no tiene agentes"
            description="Añade uno para que atienda a quien te contacta o busque clientes nuevos. Después lo encontrarás bajo el proyecto, en el menú de la izquierda."
            action={canEdit ? <AddAgentButton projectId={projectId} agents={agents} /> : null}
          />
        )}
      </section>
    </div>
  );
}
