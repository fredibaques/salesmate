import { Webhook } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, EmptyState, Field, FormSection, Select, Textarea } from "@/components/ui";
import { AI_PROVIDER_INFO } from "@/lib/ai-providers";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { env } from "@/server/env";
import { getOrgAi } from "@/server/llm/org-ai";
import { projectProcess } from "@/server/playbooks/service";
import { NEXT_STEP_LABELS } from "@/server/playbooks/spec";
import { listBases } from "@/server/prospects/bases";
import { getAgent, listChannelOptions } from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { rotateKey } from "../../conversations/actions";
import { saveInboundSetup } from "../actions";
import { TriggerFields } from "./trigger-fields";

function ConnectLink({ children, add = "1" }: { children: React.ReactNode; add?: string }) {
  return (
    <Link href={`/app/connections?add=${add}`} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

/**
 * The inbound agent's setup on one screen, grouped like the prospecting
 * agent's: its goal (and the table it keeps), where it listens, its model
 * and the accounts it works with. How it sells is the project's process.
 */
export async function InboundSetup({ projectId, agentId }: { projectId: string; agentId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, project, options, bases, ai, process] = await Promise.all([
    getAgent(db, tenant, projectId, agentId),
    getProject(db, tenant, projectId),
    listChannelOptions(db, tenant),
    listBases(db, tenant, projectId, { standalone: true }),
    getOrgAi(db, tenant),
    withTenant(db, tenant, (tx) => projectProcess(tx, projectId)),
  ]);
  if (!agent || !project) notFound();
  const config = agent.config;
  const channels = config.channels;
  const models = ai ? AI_PROVIDER_INFO[ai.provider].models : [];
  const orgModel = models.find((m) => m.id === ai?.model);
  const endpoint = `${env().APP_URL}/api/inbound/form/${projectId}`;
  const hookUrl = config.hookToken ? `${env().APP_URL}/api/hooks/agents/${config.hookToken}` : null;
  const steps = process?.spec.nextSteps ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <Card
        title="Configuración"
        tip="Atiende a quien escribe siguiendo el proceso de venta del proyecto. Todo lo que envía pasa por el gateway: sus respuestas esperan tu aprobación salvo que subas su autonomía."
      >
        <ActionForm
          key={JSON.stringify([
            config.instructions,
            config.settings,
            config.schedule,
            config.prospectBaseId,
            config.hookToken,
            channels,
          ])}
          action={saveInboundSetup.bind(null, projectId, agentId)}
          submitLabel="Guardar"
          className="space-y-8"
        >
          <FormSection title="Objetivo" tip="Qué hace con cada contacto y dónde lo apunta.">
            <Field
              label="Proceso de venta"
              tip="Es del proyecto: lo comparten todos los agentes que hablan con personas."
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="min-w-0">
                  {process ? (
                    <>
                      {process.spec.objective || "Sin objetivo escrito"}
                      {steps.length ? (
                        <span className="block text-xs text-muted">
                          Termina en: {steps.map((s) => NEXT_STEP_LABELS[s].toLowerCase()).join(", o ")}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted">El proyecto todavía no tiene proceso de venta.</span>
                  )}
                </span>
                <Link
                  href={`/app/projects/${projectId}/sales/process`}
                  className="text-sm text-accent hover:underline"
                >
                  {process ? "Editar" : "Definirlo"}
                </Link>
              </div>
            </Field>
            <Field
              label="Apunta cada contacto en"
              optional
              tip="Cada persona que escribe queda como una fila de esta tabla (o se une a la suya si ya estaba, por email o teléfono), y desde la fila se abre su conversación."
              hint={
                <Link href={`/app/projects/${projectId}#tablas`} className="text-accent hover:underline">
                  Ver las tablas del proyecto
                </Link>
              }
            >
              <Select name="baseId" defaultValue={config.prospectBaseId ?? ""} className="max-w-sm">
                <option value="">— En ninguna tabla —</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.projectId ? "" : " (sin proyecto)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Qué tiene que hacer y cómo"
              hint="Lo que quieras que tenga en cuenta además del proceso de venta: matices de tu negocio, casos especiales, qué no debe decir nunca…"
            >
              <Textarea name="instructions" defaultValue={config.instructions ?? ""} className="min-h-40" />
            </Field>
          </FormSection>

          <TriggerFields
            projectId={projectId}
            config={config}
            run="En cada ejecución lee su buzón y atiende lo que tenga pendiente; cada contacto, en su propia conversación."
            hookUrl={config.settings.triggers?.webhook ? hookUrl : null}
            events={[
              {
                name: "triggerForm",
                label: "Llega un formulario de tu web",
                description: "Atiende cada envío en segundos. La dirección y la clave están debajo.",
                checked: config.settings.triggers?.form !== false,
              },
              {
                name: "readMailbox",
                label: "Llega un email al buzón",
                description:
                  "Cada email nuevo del buzón desde el que escribe es un contacto. Necesita que la cuenta tenga permiso de lectura.",
                checked: channels.readMailbox ?? false,
              },
              {
                name: "triggerWhatsapp",
                label: "Llega un WhatsApp",
                description: "Atiende los mensajes que llegan a este número y responde por WhatsApp.",
                checked: Boolean(channels.whatsappId),
                extra: options.whatsapps.length ? (
                  <Select name="whatsappId" defaultValue={channels.whatsappId ?? ""} className="max-w-sm">
                    <option value="">— Elige un número —</option>
                    {options.whatsapps.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.address}
                        {w.name ? ` · ${w.name}` : ""}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-xs text-muted">
                    No hay ningún número de WhatsApp Business conectado.{" "}
                    <ConnectLink add="whatsapp">Conecta uno</ConnectLink>.
                  </p>
                ),
              },
              {
                name: "triggerNewRows",
                label: "Se añade una fila a su tabla",
                description:
                  "Cada persona nueva de «Apunta cada contacto en» (con email o teléfono) es un contacto que atender.",
                checked: Boolean(config.settings.triggers?.newRows),
              },
              {
                name: "triggerWebhook",
                label: "Llega un aviso de otra herramienta",
                description:
                  "Tu CRM, Zapier o Make envían un POST con los datos de la persona (nombre, email, teléfono, mensaje).",
                checked: Boolean(config.settings.triggers?.webhook),
              },
            ]}
          />

          {models.length ? (
            <FormSection title="Configuración del modelo" tip="Qué IA usa para responder.">
              <Field
                label="Modelo de IA"
                tip="El más capaz para conversaciones delicadas; uno más económico si las consultas son sencillas. Del mismo proveedor que la organización."
              >
                <Select
                  name="model"
                  defaultValue={
                    models.some((m) => m.id === config.settings.model) ? config.settings.model : ""
                  }
                  className="max-w-sm"
                >
                  <option value="">El de la organización ({orgModel?.label ?? ai?.model})</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormSection>
          ) : null}

          <FormSection title="Comunicación" tip="Desde dónde responde, dónde agenda y qué CRM consulta.">
            <Field
              label="Buzón desde el que escribe"
              hint={
                options.mailboxes.length === 0 ? (
                  <>
                    No hay buzones conectados. <ConnectLink>Conecta uno</ConnectLink>.
                  </>
                ) : undefined
              }
            >
              <Select name="mailboxId" defaultValue={channels.mailboxId ?? ""} className="max-w-sm">
                <option value="">— Ninguno —</option>
                {options.mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                    {m.canSend ? "" : " (sin permiso para enviar)"}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Calendario donde agenda"
                tip="Solo hace falta si el proceso termina en una reunión o una llamada."
                hint={
                  options.calendars.length === 0 ? (
                    <>
                      No hay calendarios conectados. <ConnectLink>Conecta uno</ConnectLink>.
                    </>
                  ) : undefined
                }
              >
                <Select name="calendarId" defaultValue={channels.calendarId ?? ""}>
                  <option value="">— Ninguno —</option>
                  {options.calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.address}
                      {c.canBook ? "" : " (solo disponibilidad)"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="CRM"
                tip="Para buscar al contacto antes de responder y registrar lo que pasa."
                hint={
                  options.crms.length === 0 ? (
                    <>
                      No hay CRM conectado. <ConnectLink>Conecta uno</ConnectLink>.
                    </>
                  ) : undefined
                }
              >
                <Select name="crmConnectionId" defaultValue={channels.crmConnectionId ?? ""}>
                  <option value="">— Ninguno —</option>
                  {options.crms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.canWrite ? "" : " (solo lectura)"}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </FormSection>
        </ActionForm>
      </Card>

      <Card
        title="Formulario de tu web"
        tip="Envía aquí los formularios de tu web (POST, en JSON o formulario normal) y el agente atiende cada envío en segundos."
      >
        {project.inboundFormKey ? (
          <div className="space-y-3 text-sm">
            <Field label="Dirección">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg bg-background p-2 text-xs break-all">
                  {endpoint}
                </code>
                <CopyButton text={endpoint} label="Copiar dirección" />
              </div>
            </Field>
            <Field label="Clave">
              <code className="block rounded-lg bg-background p-2 text-xs break-all">
                {project.inboundFormKey}
              </code>
            </Field>
            <details>
              <summary className="cursor-pointer text-accent hover:underline">
                Ejemplo de formulario HTML
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-3 text-xs">{`<form action="${endpoint}" method="POST">
  <input type="hidden" name="_key" value="${project.inboundFormKey}">
  <input type="hidden" name="_redirect" value="https://tu-web.com/gracias">
  <input type="text" name="_gotcha" style="display:none">
  <input name="nombre" placeholder="Nombre">
  <input name="email" type="email" required>
  <input name="empresa" placeholder="Empresa">
  <textarea name="mensaje"></textarea>
  <label><input type="checkbox" name="acepto" required> Acepto la política de privacidad</label>
  <button>Enviar</button>
</form>`}</pre>
            </details>
            <form action={rotateKey.bind(null, projectId)}>
              <Button variant="secondary">Cambiar la clave</Button>
            </form>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<Webhook />}
            title="Formulario sin activar"
            description="Actívalo para obtener la dirección y la clave que pondrás en el formulario de tu web."
            action={
              <form action={rotateKey.bind(null, projectId)}>
                <Button>Activar el formulario</Button>
              </form>
            }
          />
        )}
      </Card>
    </div>
  );
}
