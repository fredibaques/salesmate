import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSalesProfile, listProjectAgents } from "@/server/services/agents";
import { listKnowledge } from "@/server/services/projects";
import { AgentCards } from "./agents/agent-cards";

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
      href: `${base}/offer`,
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
      href: `${base}/agents`,
    },
    {
      // Only agents that write to people need a mailbox.
      done:
        agents.length > 0 &&
        agents.every((a) => a.config.agentType === "outbound" || a.config.channels.mailboxId),
      label: "Dile con qué cuentas y herramientas trabaja",
      hint: "Usa las cuentas que tu organización ya ha conectado.",
      href: firstAgent ? `${base}/agents/${firstAgent}/channels` : `${base}/agents`,
    },
    {
      done: agents.some((a) => a.config.enabled),
      label: "Actívalo",
      hint: "Hasta entonces, los contactos se guardan pero nadie los atiende.",
      href: firstAgent ? `${base}/agents/${firstAgent}` : `${base}/agents`,
    },
  ];
  const pending = steps.filter((x) => !x.done).length;

  return (
    <div className="space-y-8">
      {pending > 0 ? (
        <Card
          title="Puesta en marcha"
          description={`Te ${pending === 1 ? "queda 1 paso" : `quedan ${pending} pasos`} para que este proyecto venda solo.`}
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

      <section>
        <PageHeader
          level="section"
          title="Agentes"
          description="Actívalos o pausa cada uno desde aquí; entra en uno para ajustar su proceso, sus canales y qué necesita tu aprobación."
        />
        <AgentCards projectId={projectId} agents={agents} />
      </section>
    </div>
  );
}
