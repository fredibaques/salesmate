"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Choice, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { ScheduleFields } from "@/components/schedule-fields";
import { Wizard, type WizardStep } from "@/components/wizard";
import { AGENT_INFO } from "@/lib/agents";
import { describeSchedule, scheduleFromForm } from "@/lib/schedule";
import type { SalesMotion } from "@/server/db/schema";
import { NEXT_STEP_LABELS, SALES_MOTION_LABELS, type NextStep } from "@/server/playbooks/spec";
import type { AGENT_DEFAULTS, listChannelOptions, listMcpServers } from "@/server/services/agents";
import { setupAgentAction } from "./actions";

const MOTION_HELP: Record<SalesMotion, string> = {
  b2b_consultative: "Vendes a empresas y hace falta hablar: suele acabar en una reunión o demo.",
  b2b_transactional: "Vendes a empresas con precio claro: suele acabar en un presupuesto o una contratación.",
  b2c_assisted: "Vendes a particulares que necesitan ayuda para decidir.",
  b2c_self_serve: "Vendes a particulares que contratan solos con un enlace.",
  custom: "Empiezas en blanco y lo defines tú.",
};

const AUTONOMY = [
  {
    value: 1,
    label: "Pide mi aprobación",
    description:
      "Prepara cada respuesta y espera a que la apruebes en «Por aprobar». Recomendado al empezar.",
  },
  {
    value: 2,
    label: "Actúa solo, dentro de límites",
    description: "Responde sin esperar, con los límites diarios y las reglas del proyecto.",
  },
  { value: 0, label: "Solo sugiere", description: "Te propone qué hacer, pero lo haces tú." },
];

/** One line of the review step. */
function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

/** Its name, to tell it apart from other agents of the project (empty = the template's). */
function NameField({ placeholder }: { placeholder: string }) {
  return (
    <Field
      label="Nombre"
      optional
      tip="Para distinguirlo de los demás agentes del proyecto. Se cambia en su ficha."
    >
      <Input name="name" maxLength={60} placeholder={placeholder} />
    </Field>
  );
}

function ActivateChoice() {
  return (
    <Choice
      card
      name="activate"
      label="Activarlo al terminar"
      description="Si no, se queda en pausa hasta que lo actives desde su tarjeta."
    />
  );
}

/** The project's sales process: shown if it has one, otherwise the kind of sale to start from. */
function saleStep(
  projectId: string,
  process: { objective: string; nextSteps: NextStep[] } | null,
  withProcess: string,
): WizardStep {
  return {
    id: "sale",
    title: "Proceso de venta",
    summary: process
      ? withProcess
      : "El proyecto todavía no tiene proceso de venta: partimos de uno de ejemplo para tu tipo de venta.",
    content: process ? (
      <dl className="divide-y divide-border">
        <ReviewRow label="Objetivo">{process.objective}</ReviewRow>
        <ReviewRow label="Cómo termina">
          {process.nextSteps.map((s) => NEXT_STEP_LABELS[s]).join(", o ")}
        </ReviewRow>
        <ReviewRow label="Dónde se cambia">
          <Link
            href={`/app/projects/${projectId}/sales/process`}
            target="_blank"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            Ventas → Proceso de venta
            <ExternalLink className="size-3.5" />
          </Link>
        </ReviewRow>
      </dl>
    ) : (
      <Field
        label="Tipo de venta"
        group
        tip="Es del proyecto: lo seguirán todos los agentes que hablan con personas. Lo ajustas en Ventas → Proceso de venta."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(SALES_MOTION_LABELS) as SalesMotion[]).map((m) => (
            <Choice
              key={m}
              card
              type="radio"
              name="salesMotion"
              value={m}
              defaultChecked={m === "b2b_consultative"}
              label={SALES_MOTION_LABELS[m]}
              description={MOTION_HELP[m]}
            />
          ))}
        </div>
      </Field>
    ),
  };
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

type ChannelOptions = Awaited<ReturnType<typeof listChannelOptions>>;

export function InboundWizard({
  projectId,
  options,
  process,
}: {
  projectId: string;
  options: ChannelOptions;
  /** The project's sales process, if it has one already. */
  process: { objective: string; nextSteps: NextStep[] } | null;
}) {
  const nothingConnected = options.mailboxes.length + options.calendars.length + options.crms.length === 0;

  const steps: WizardStep[] = [
    saleStep(projectId, process, "Atenderá a cada contacto con el proceso de venta del proyecto."),
    {
      id: "channels",
      title: "Canales",
      summary: "Desde dónde escribe, dónde agenda y qué CRM consulta. Puedes dejarlo para más tarde.",
      content: (
        <>
          {nothingConnected ? (
            <Notice
              tone="warning"
              action={
                <Link
                  href="/app/connections?add=1"
                  target="_blank"
                  className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                >
                  Conectar una cuenta
                  <ExternalLink className="size-3.5" />
                </Link>
              }
            >
              Tu organización todavía no ha conectado ningún correo, calendario ni CRM. Sin buzón, el agente
              prepara las respuestas pero no puede enviarlas.
            </Notice>
          ) : null}
          <Field label="Buzón desde el que escribe" optional>
            <Select name="mailboxId" defaultValue={options.mailboxes[0]?.id ?? ""}>
              <option value="">— Ninguno por ahora —</option>
              {options.mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                  {m.canSend ? "" : " (sin permiso para enviar)"}
                </option>
              ))}
            </Select>
          </Field>
          {options.mailboxes.length ? (
            <Choice
              name="readMailbox"
              label="Atender también los emails que llegan a este buzón"
              description="Cada email nuevo se trata como un contacto entrante."
            />
          ) : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Calendario donde agenda" optional>
              <Select name="calendarId" defaultValue={options.calendars[0]?.id ?? ""}>
                <option value="">— Ninguno por ahora —</option>
                {options.calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.address}
                    {c.canBook ? "" : " (solo disponibilidad)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="CRM" optional>
              <Select name="crmConnectionId" defaultValue={options.crms[0]?.id ?? ""}>
                <option value="">— Ninguno por ahora —</option>
                {options.crms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.canWrite ? "" : " (solo lectura)"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      ),
    },
    {
      id: "autonomy",
      title: "Autonomía",
      summary: "Qué hace sin preguntarte. Las reglas del proyecto se aplican siempre.",
      content: (
        <div className="grid gap-2">
          {AUTONOMY.map((a) => (
            <Choice
              key={a.value}
              card
              type="radio"
              name="defaultLevel"
              value={a.value}
              defaultChecked={a.value === 1}
              label={a.label}
              description={a.description}
            />
          ))}
        </div>
      ),
    },
    {
      id: "review",
      title: "Revisar",
      summary: "Así empezará a trabajar. Todo se puede cambiar en su ficha.",
      content: (values) => {
        const mailbox = options.mailboxes.find((m) => m.id === values.get("mailboxId"));
        const calendar = options.calendars.find((c) => c.id === values.get("calendarId"));
        const crm = options.crms.find((c) => c.id === values.get("crmConnectionId"));
        const autonomy = AUTONOMY.find((a) => String(a.value) === values.get("defaultLevel"));
        return (
          <>
            <dl className="divide-y divide-border">
              <ReviewRow label="Proceso de venta">
                {process
                  ? "El del proyecto"
                  : `Nuevo, de ejemplo: ${SALES_MOTION_LABELS[(values.get("salesMotion") as SalesMotion) ?? "b2b_consultative"]}`}
              </ReviewRow>
              <ReviewRow label="Canales">
                {[mailbox?.address, calendar && `calendario ${calendar.address}`, crm?.label]
                  .filter(Boolean)
                  .join(" · ") || <Badge tone="warning">Sin canales todavía</Badge>}
              </ReviewRow>
              <ReviewRow label="Autonomía">{autonomy?.label}</ReviewRow>
            </dl>
            <NameField placeholder={AGENT_INFO.inbound.name} />
            <ActivateChoice />
          </>
        );
      },
    },
  ];

  return (
    <Wizard
      steps={steps}
      action={setupAgentAction.bind(null, projectId, "inbound")}
      submitLabel="Crear agente"
      cancelHref={`/app/projects/${projectId}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Prospecting
// ---------------------------------------------------------------------------

type Servers = Awaited<ReturnType<typeof listMcpServers>>;

export function ProspectingWizard({
  projectId,
  defaults,
  servers,
}: {
  projectId: string;
  defaults: (typeof AGENT_DEFAULTS)["prospecting"];
  servers: Servers;
}) {
  const steps: WizardStep[] = [
    {
      id: "what",
      title: "Qué buscar",
      summary: "Qué empresas te interesan y cómo reconocerlas. Ya conoce tu oferta y tu cliente ideal.",
      content: (
        <Field
          label="Instrucciones"
          tip="Sector, tamaño, zona, señales de que encajan, qué fuentes usar o evitar y qué datos recoger. Lo común a todos los agentes (qué vendes, a quién) lo toma de Ventas → Oferta y cliente."
        >
          <Textarea name="instructions" required defaultValue={defaults.instructions} className="min-h-56" />
        </Field>
      ),
    },
    {
      id: "tools",
      title: "Herramientas",
      summary: "Dónde puede buscar. No contacta con nadie: solo guarda lo que encuentra.",
      content: (
        <>
          <Choice
            card
            name="web"
            defaultChecked={Boolean(defaults.tools.web)}
            label="Búsqueda en internet"
            description="Busca y lee páginas públicas: webs de empresas, directorios, noticias. Cada búsqueda cuesta alrededor de un céntimo."
          />
          {servers.length ? (
            servers.map((server) => (
              <Field key={server.id} label={server.label} group>
                <div className="space-y-2">
                  {server.tools.map((t) => (
                    <Choice
                      key={t.name}
                      name="mcp"
                      value={`${server.id}::${t.name}`}
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          <code className="text-xs">{t.name}</code>
                          {t.readOnly ? (
                            <Badge>Solo lectura</Badge>
                          ) : (
                            <Badge tone="warning">Cambia datos</Badge>
                          )}
                        </span>
                      }
                      description={t.description}
                    />
                  ))}
                </div>
              </Field>
            ))
          ) : (
            <p className="text-sm text-muted">
              Si usas un directorio de empresas o un CRM con MCP, conéctalo en Integraciones y añádelo después
              en la ficha del agente.
            </p>
          )}
        </>
      ),
    },
    {
      id: "when",
      title: "Cuándo trabaja",
      summary: "Solo cuando se lo pidas, una vez o de forma recurrente. Siempre en la hora del proyecto.",
      content: (
        <>
          <ScheduleFields schedule={defaults.schedule} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Prospectos por ejecución"
              tip="Mejor pocos y buenos: cada ejecución busca hasta este número de empresas nuevas."
            >
              <Input
                name="prospectsPerRun"
                type="number"
                min={1}
                max={50}
                required
                defaultValue={defaults.settings.prospectsPerRun ?? 10}
              />
            </Field>
          </div>
        </>
      ),
    },
    {
      id: "review",
      title: "Revisar",
      summary: "Así empezará a trabajar. Todo se puede cambiar en su ficha.",
      content: (values) => {
        const schedule = scheduleFromForm(values);
        const tools = [
          values.get("web") ? "búsqueda en internet" : null,
          ...values.getAll("mcp").map((v) => String(v).split("::").slice(1).join("::")),
        ].filter(Boolean);
        return (
          <>
            <dl className="divide-y divide-border">
              <ReviewRow label="Qué busca">
                <span className="line-clamp-4 whitespace-pre-wrap">
                  {String(values.get("instructions") ?? "")}
                </span>
              </ReviewRow>
              <ReviewRow label="Herramientas">
                {tools.length ? tools.join(", ") : <Badge tone="warning">Ninguna: no podrá buscar</Badge>}
              </ReviewRow>
              <ReviewRow label="Cuándo">
                {schedule && "days" in schedule && !schedule.days.length ? (
                  <Badge tone="danger">Elige al menos un día</Badge>
                ) : (
                  describeSchedule(schedule)
                )}
              </ReviewRow>
              <ReviewRow label="Por ejecución">{`${values.get("prospectsPerRun")} prospectos nuevos`}</ReviewRow>
            </dl>
            <NameField placeholder={AGENT_INFO.prospecting.name} />
            <ActivateChoice />
          </>
        );
      },
    },
  ];

  return (
    <Wizard
      steps={steps}
      action={setupAgentAction.bind(null, projectId, "prospecting")}
      submitLabel="Crear agente"
      cancelHref={`/app/projects/${projectId}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Outbound (first contact with the rows of a table)
// ---------------------------------------------------------------------------

export function OutreachWizard({
  projectId,
  defaults,
  bases,
  mailboxes,
  process,
}: {
  projectId: string;
  defaults: (typeof AGENT_DEFAULTS)["outbound"];
  bases: { id: string; name: string }[];
  mailboxes: { id: string; address: string }[];
  process: { objective: string; nextSteps: NextStep[] } | null;
}) {
  const handoff = defaults.settings.handoff;
  const steps: WizardStep[] = [
    {
      id: "table",
      title: "A quién escribe",
      summary: "Las filas de una tabla con email que encajan, una sola vez cada una.",
      content: (
        <>
          {bases.length ? (
            <Field label="Trabaja con la tabla" tip="Suele ser la que rellena un agente de prospección.">
              <Select name="baseId" required defaultValue={bases[0]?.id}>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Notice tone="warning">
              El proyecto todavía no tiene tablas. Créala antes, o añade primero un agente de prospección que
              la rellene.
            </Notice>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Encaje mínimo" tip="0 para escribir también a las filas sin encaje calculado.">
              <Input
                name="minFit"
                type="number"
                min={0}
                max={100}
                required
                defaultValue={handoff?.minFit ?? 70}
              />
            </Field>
            <Field label="Emails por ejecución">
              <Input
                name="perRun"
                type="number"
                min={1}
                max={25}
                required
                defaultValue={handoff?.perRun ?? 5}
              />
            </Field>
          </div>
        </>
      ),
    },
    saleStep(projectId, process, "Escribirá siguiendo el proceso de venta del proyecto."),
    {
      id: "how",
      title: "Cómo escribe",
      summary: "Desde qué buzón y con qué estilo. Cada email espera tu aprobación.",
      content: (
        <>
          {mailboxes.length ? (
            <Field label="Buzón desde el que escribe" tip="Las respuestas llegan a este buzón.">
              <Select name="mailboxId" required defaultValue={mailboxes[0]?.id}>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Notice
              tone="warning"
              action={
                <Link
                  href="/app/connections?add=gmail"
                  target="_blank"
                  className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                >
                  Conectar
                  <ExternalLink className="size-3.5" />
                </Link>
              }
            >
              No hay ningún buzón que pueda enviar. Puedes crearlo igual y elegirlo después.
            </Notice>
          )}
          <Field label="Cómo escribe el primer email" tip="Qué vendes y a quién ya lo sabe por Ventas.">
            <Textarea name="instructions" defaultValue={defaults.instructions} className="min-h-40" />
          </Field>
        </>
      ),
    },
    {
      id: "when",
      title: "Cuándo trabaja",
      summary: "Con horario, cuando se añaden filas a su tabla o cuando se lo pidas.",
      content: (
        <>
          <ScheduleFields schedule={defaults.schedule} />
          <Choice
            card
            name="triggerNewRows"
            defaultChecked
            label="También cuando se añade una fila a su tabla"
            description="Escribe a las filas nuevas que encajan en cuanto llegan."
          />
        </>
      ),
    },
    {
      id: "review",
      title: "Revisar",
      summary: "Así empezará a trabajar. Todo se puede cambiar en su ficha.",
      content: (values) => {
        const base = bases.find((b) => b.id === values.get("baseId"));
        const mailbox = mailboxes.find((m) => m.id === values.get("mailboxId"));
        const minFit = Number(values.get("minFit") ?? 0);
        return (
          <>
            <dl className="divide-y divide-border">
              <ReviewRow label="Tabla">{base?.name ?? <Badge tone="warning">Sin tabla</Badge>}</ReviewRow>
              <ReviewRow label="A quién">
                {`Hasta ${values.get("perRun")} filas por ejecución${minFit > 0 ? `, con encaje ${minFit} o más` : ""}`}
              </ReviewRow>
              <ReviewRow label="Desde">
                {mailbox?.address ?? <Badge tone="warning">Sin buzón</Badge>}
              </ReviewRow>
              <ReviewRow label="Cuándo">
                {[
                  describeSchedule(scheduleFromForm(values)),
                  values.get("triggerNewRows") ? "y con cada fila nueva" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </ReviewRow>
            </dl>
            <NameField placeholder={AGENT_INFO.outbound.name} />
            <ActivateChoice />
          </>
        );
      },
    },
  ];

  return (
    <Wizard
      steps={steps}
      action={setupAgentAction.bind(null, projectId, "outbound")}
      submitLabel="Crear agente"
      cancelHref={`/app/projects/${projectId}`}
    />
  );
}
