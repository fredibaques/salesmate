import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, Field, FormSection, Input, Select, Textarea } from "@/components/ui";
import { AI_PROVIDER_INFO } from "@/lib/ai-providers";
import { DEFAULT_HANDOFF_MIN_FIT, DEFAULT_HANDOFF_PER_RUN } from "@/server/agents/first-contact";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { env } from "@/server/env";
import { getOrgAi } from "@/server/llm/org-ai";
import { projectProcess } from "@/server/playbooks/service";
import { listBases } from "@/server/prospects/bases";
import { getAgent, listChannelOptions } from "@/server/services/agents";
import { saveOutreachSetup } from "../actions";
import { ProcessField } from "./process-field";
import { TriggerFields } from "./trigger-fields";

/**
 * The outbound agent's setup on one screen: the table it works with and how
 * it writes, whom it writes to, when, its model and the mailbox it writes
 * from. Saved with one button.
 */
export async function OutreachSetup({ projectId, agentId }: { projectId: string; agentId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, options, bases, ai, process] = await Promise.all([
    getAgent(db, tenant, projectId, agentId),
    listChannelOptions(db, tenant),
    listBases(db, tenant, projectId, { standalone: true }),
    getOrgAi(db, tenant),
    withTenant(db, tenant, (tx) => projectProcess(tx, projectId)),
  ]);
  if (!agent) notFound();
  const config = agent.config;
  const s = config.settings;
  const models = ai ? AI_PROVIDER_INFO[ai.provider].models : [];
  const orgModel = models.find((m) => m.id === ai?.model);
  const hookUrl = config.hookToken ? `${env().APP_URL}/api/hooks/agents/${config.hookToken}` : null;
  const mailboxes = options.mailboxes.filter((m) => m.canSend || m.id === config.channels.mailboxId);

  return (
    <div className="max-w-3xl space-y-6">
      <Card
        title="Configuración"
        tip="Escribe a las filas de su tabla que encajan siguiendo el proceso de venta del proyecto. Cada email pasa por el gateway: espera tu aprobación en «Por aprobar» salvo que subas su autonomía, y respeta el horario de envío y las exclusiones del proyecto."
      >
        <ActionForm
          key={JSON.stringify([
            config.instructions,
            s,
            config.schedule,
            config.prospectBaseId,
            config.channels,
          ])}
          action={saveOutreachSetup.bind(null, projectId, agentId)}
          submitLabel="Guardar"
          className="space-y-8"
        >
          <FormSection title="Objetivo" tip="Con qué tabla trabaja y cómo escribe.">
            <ProcessField projectId={projectId} process={process} />
            <Field
              label="Trabaja con la tabla"
              tip="Escribe a sus filas. Suele ser la que rellena un agente de prospección."
              hint={
                <Link href={`/app/projects/${projectId}#tablas`} className="text-accent hover:underline">
                  Ver las tablas del proyecto
                </Link>
              }
            >
              <Select name="baseId" defaultValue={config.prospectBaseId ?? ""} className="max-w-sm">
                <option value="">— Elige una tabla —</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.projectId ? "" : " (sin proyecto)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Cómo escribe el primer email"
              hint="Tono, qué mencionar, qué evitar, cómo firmar… Qué vendes y a quién ya lo sabe por Ventas."
            >
              <Textarea name="instructions" defaultValue={config.instructions ?? ""} className="min-h-40" />
            </Field>
          </FormSection>

          <FormSection
            title="A quién escribe"
            tip="Filas con email, con al menos este encaje y sin primer email todavía: a cada una, una sola vez."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Encaje mínimo" tip="0 para escribir también a las filas sin encaje calculado.">
                <Input
                  name="minFit"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={s.handoff?.minFit ?? DEFAULT_HANDOFF_MIN_FIT}
                  className="w-32"
                />
              </Field>
              <Field label="Emails por ejecución">
                <Input
                  name="perRun"
                  type="number"
                  min={1}
                  max={25}
                  defaultValue={s.handoff?.perRun ?? DEFAULT_HANDOFF_PER_RUN}
                  className="w-32"
                />
              </Field>
            </div>
          </FormSection>

          <TriggerFields
            projectId={projectId}
            config={config}
            run="En cada ejecución prepara el primer email de las filas que encajan y aún no tienen uno."
            hookUrl={s.triggers?.webhook ? hookUrl : null}
            events={[
              {
                name: "triggerNewRows",
                label: "Se añade una fila a su tabla",
                description:
                  "Cuando un agente de prospección o una persona añade filas, escribe a las que encajan.",
                checked: Boolean(s.triggers?.newRows),
              },
              {
                name: "triggerWebhook",
                label: "Llega un aviso de otra herramienta",
                description: "Tu CRM, Zapier o Make le avisan con un POST para que haga una ejecución.",
                checked: Boolean(s.triggers?.webhook),
              },
            ]}
          />

          {models.length ? (
            <FormSection title="Configuración del modelo" tip="Qué IA escribe los emails.">
              <Field label="Modelo de IA" tip="Del mismo proveedor que la organización.">
                <Select
                  name="model"
                  defaultValue={models.some((m) => m.id === s.model) ? s.model : ""}
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

          <FormSection title="Comunicación" tip="Desde dónde escribe. Las respuestas llegan a ese buzón.">
            <Field
              label="Buzón desde el que escribe"
              hint={
                mailboxes.length === 0 ? (
                  <>
                    No hay buzones que puedan enviar.{" "}
                    <Link href="/app/connections?add=google" className="text-accent hover:underline">
                      Conecta uno
                    </Link>
                    .
                  </>
                ) : undefined
              }
            >
              <Select name="mailboxId" defaultValue={config.channels.mailboxId ?? ""} className="max-w-sm">
                <option value="">— Elige un buzón —</option>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </Select>
            </Field>
          </FormSection>
        </ActionForm>
      </Card>
    </div>
  );
}
