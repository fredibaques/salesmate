"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge, Chip, Choice, Field, Input, Notice, Segmented, Select, Textarea } from "@/components/ui";
import { Wizard, type WizardStep } from "@/components/wizard";
import type { SalesMotion } from "@/server/db/schema";
import {
  NEXT_STEP_DESCRIPTIONS,
  NEXT_STEP_LABELS,
  NEXT_STEPS,
  SALES_MOTION_LABELS,
  type NextStep,
} from "@/server/playbooks/spec";
import type { AGENT_DEFAULTS, listChannelOptions, listMcpServers } from "@/server/services/agents";
import { setupAgentAction } from "../../actions";

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
      "Prepara cada respuesta y espera a que la apruebes en Copilot → Por aprobar. Recomendado al empezar.",
  },
  {
    value: 2,
    label: "Actúa solo, dentro de límites",
    description: "Responde sin esperar, con los límites diarios y las reglas del proyecto.",
  },
  { value: 0, label: "Solo sugiere", description: "Te propone qué hacer, pero lo haces tú." },
];

const DAYS = [
  [1, "L"],
  [2, "M"],
  [3, "X"],
  [4, "J"],
  [5, "V"],
  [6, "S"],
  [7, "D"],
] as const;

const DAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** One line of the review step. */
function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted">—</span>}</dd>
    </div>
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

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

type Template = { objective: string; customerType: "b2b" | "b2c"; nextSteps: NextStep[] };
type ChannelOptions = Awaited<ReturnType<typeof listChannelOptions>>;

export function InboundWizard({
  projectId,
  options,
  templates,
}: {
  projectId: string;
  options: ChannelOptions;
  templates: Record<string, Template>;
}) {
  const [motion, setMotion] = useState<SalesMotion>("b2b_consultative");
  const template = templates[motion];
  const nothingConnected = options.mailboxes.length + options.calendars.length + options.crms.length === 0;

  const steps: WizardStep[] = [
    {
      id: "sale",
      title: "Tu venta",
      summary: "Partimos de un proceso de ejemplo para este tipo de venta. Podrás ajustarlo todo después.",
      content: (
        <>
          <Field label="Tipo de venta" group>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(SALES_MOTION_LABELS) as SalesMotion[]).map((m) => (
                <Choice
                  key={m}
                  card
                  type="radio"
                  name="salesMotion"
                  value={m}
                  checked={m === motion}
                  onChange={() => setMotion(m)}
                  label={SALES_MOTION_LABELS[m]}
                  description={MOTION_HELP[m]}
                />
              ))}
            </div>
          </Field>
          {/* Keyed by motion: choosing another type of sale reloads its suggested answers. */}
          <div key={motion} className="space-y-5">
            <Field label="Atiende a" group>
              <Segmented
                name="customerType"
                defaultValue={template.customerType}
                options={[
                  { value: "b2b", label: "Empresas (B2B)" },
                  { value: "b2c", label: "Particulares (B2C)" },
                ]}
              />
            </Field>
            <Field label="Objetivo" tip="En una frase, qué consigue una conversación que va bien.">
              <Input name="objective" required defaultValue={template.objective} />
            </Field>
          </div>
        </>
      ),
    },
    {
      id: "outcome",
      title: "Cómo termina",
      summary: "Es lo que el agente intenta conseguir con cada contacto.",
      content: (
        <div key={motion} className="space-y-5">
          <Field label="Resultado principal" group>
            <div className="grid gap-2 sm:grid-cols-2">
              {NEXT_STEPS.map((step) => (
                <Choice
                  key={step}
                  card
                  type="radio"
                  name="primaryStep"
                  value={step}
                  required
                  defaultChecked={step === template.nextSteps[0]}
                  label={NEXT_STEP_LABELS[step]}
                  description={NEXT_STEP_DESCRIPTIONS[step]}
                />
              ))}
            </div>
          </Field>
          <Field
            label="Si no es posible, alternativas"
            tip="Si con un contacto no se puede conseguir el resultado principal, prueba con estas, en este orden."
            group
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {NEXT_STEPS.map((step) => (
                <Choice
                  key={step}
                  name="alternativeSteps"
                  value={step}
                  defaultChecked={template.nextSteps.slice(1).includes(step)}
                  label={NEXT_STEP_LABELS[step]}
                />
              ))}
            </div>
          </Field>
        </div>
      ),
    },
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
                  href="/app/connections/new"
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
        const primary = values.get("primaryStep") as NextStep | null;
        const alternatives = values.getAll("alternativeSteps").filter((s) => s !== primary) as NextStep[];
        const mailbox = options.mailboxes.find((m) => m.id === values.get("mailboxId"));
        const calendar = options.calendars.find((c) => c.id === values.get("calendarId"));
        const crm = options.crms.find((c) => c.id === values.get("crmConnectionId"));
        const autonomy = AUTONOMY.find((a) => String(a.value) === values.get("defaultLevel"));
        return (
          <>
            <dl className="divide-y divide-border">
              <ReviewRow label="Tipo de venta">
                {SALES_MOTION_LABELS[values.get("salesMotion") as SalesMotion]} ·{" "}
                {values.get("customerType") === "b2c" ? "particulares" : "empresas"}
              </ReviewRow>
              <ReviewRow label="Objetivo">{String(values.get("objective") ?? "")}</ReviewRow>
              <ReviewRow label="Cómo termina">
                {primary ? NEXT_STEP_LABELS[primary] : null}
                {alternatives.length ? (
                  <span className="text-muted">
                    {" "}
                    (si no: {alternatives.map((s) => NEXT_STEP_LABELS[s].toLowerCase()).join(", ")})
                  </span>
                ) : null}
              </ReviewRow>
              <ReviewRow label="Canales">
                {[mailbox?.address, calendar && `calendario ${calendar.address}`, crm?.label]
                  .filter(Boolean)
                  .join(" · ") || <Badge tone="warning">Sin canales todavía</Badge>}
              </ReviewRow>
              <ReviewRow label="Autonomía">{autonomy?.label}</ReviewRow>
            </dl>
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
// Outbound (prospecting)
// ---------------------------------------------------------------------------

type Servers = Awaited<ReturnType<typeof listMcpServers>>;

export function OutboundWizard({
  projectId,
  defaults,
  servers,
}: {
  projectId: string;
  defaults: (typeof AGENT_DEFAULTS)["outbound"];
  servers: Servers;
}) {
  const schedule = defaults.schedule ?? { time: "08:00", days: [1, 2, 3, 4, 5] };
  const steps: WizardStep[] = [
    {
      id: "what",
      title: "Qué buscar",
      summary: "Qué empresas te interesan y cómo reconocerlas. Ya conoce tu oferta y tu cliente ideal.",
      content: (
        <Field
          label="Instrucciones"
          tip="Sector, tamaño, zona, señales de que encajan, qué fuentes usar o evitar y qué datos recoger. Lo común a todos los agentes (qué vendes, a quién) lo toma de Conocimiento → Oferta y cliente."
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
              Si usas un directorio de empresas o un CRM con MCP, conéctalo en Configuración → Conexiones y
              añádelo después en la ficha del agente.
            </p>
          )}
        </>
      ),
    },
    {
      id: "when",
      title: "Cuándo trabaja",
      summary:
        "Trabaja solo, a esta hora del proyecto, mientras esté activo. También puedes lanzarlo a mano.",
      content: (
        <>
          <Field label="Días" group>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([n, label]) => (
                <Chip key={n} name="days" value={n} defaultChecked={schedule.days.includes(n)}>
                  {label}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Hora">
              <Input name="time" type="time" required defaultValue={schedule.time} />
            </Field>
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
        const days = values.getAll("days").map(Number);
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
                {days.length ? (
                  `${days.map((d) => DAY_NAMES[d]).join(", ")} a las ${values.get("time")}`
                ) : (
                  <Badge tone="danger">Elige al menos un día</Badge>
                )}
              </ReviewRow>
              <ReviewRow label="Por ejecución">{`${values.get("prospectsPerRun")} prospectos nuevos`}</ReviewRow>
            </dl>
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
