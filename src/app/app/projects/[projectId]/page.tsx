import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, Textarea } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSalesProfile, listProjectAgents } from "@/server/services/agents";
import { getProject, listKnowledge } from "@/server/services/projects";
import { saveProject } from "./actions";

const DAYS = [
  [1, "L"],
  [2, "M"],
  [3, "X"],
  [4, "J"],
  [5, "V"],
  [6, "S"],
  [7, "D"],
] as const;

export default async function ProjectGeneralPage({ params }: PageProps<"/app/projects/[projectId]">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [projectRow, profile, sources, agents] = await Promise.all([
    getProject(db, tenant, projectId),
    getSalesProfile(db, tenant, projectId),
    listKnowledge(db, tenant, projectId),
    listProjectAgents(db, tenant, projectId),
  ]);
  const project = projectRow!;
  const s = project.settings;
  const sendDays = s.sendDays ?? [1, 2, 3, 4, 5];
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
      done: agents.some((a) => a.config.channels.mailboxId),
      label: "Dile con qué buzón, calendario y CRM trabaja",
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
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
      {pending > 0 ? (
        <Card
          title="Puesta en marcha"
          description={`Te ${pending === 1 ? "queda 1 paso" : `quedan ${pending} pasos`} para que este proyecto venda solo.`}
          className="xl:order-2"
        >
          <ol className="space-y-1">
            {steps.map((step) => (
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
                      {step.label}
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
      <Card title="Datos del proyecto">
        <ActionForm action={saveProject.bind(null, project.id)} submitLabel="Guardar" className="space-y-4">
          <Field label="Nombre">
            <Input name="name" defaultValue={project.name} required />
          </Field>
          <Field label="Descripción">
            <Textarea name="description" defaultValue={project.description ?? ""} />
          </Field>
          <Field label="Web">
            <Input name="website" type="url" defaultValue={project.website ?? ""} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Zona horaria">
              <Input name="timezone" defaultValue={project.timezone} />
            </Field>
            <Field label="Idiomas">
              <Input name="languages" defaultValue={project.languages.join(", ")} />
            </Field>
          </div>

          <h3 className="pt-2 text-sm font-semibold">Contacto con terceros</h3>
          <p className="text-xs text-muted">
            Las acciones que llegan a personas de fuera (emails, invitaciones) solo se ejecutan en esta
            franja; fuera de ella quedan programadas.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Desde">
              <Input name="sendFrom" type="time" defaultValue={s.sendWindow?.[0] ?? "08:00"} />
            </Field>
            <Field label="Hasta">
              <Input name="sendTo" type="time" defaultValue={s.sendWindow?.[1] ?? "20:00"} />
            </Field>
            <Field label="Días">
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
                {DAYS.map(([n, label]) => (
                  <label key={n} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="sendDays" value={n} defaultChecked={sendDays.includes(n)} />
                    {label}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Field
            label="Enfriamiento entre proyectos (días)"
            hint="Si otro de tus proyectos contactó con la misma persona en este plazo, la acción pedirá tu aprobación."
          >
            <Input
              name="cooldown"
              type="number"
              min={0}
              max={365}
              defaultValue={s.crossProjectCooldownDays ?? 30}
            />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
