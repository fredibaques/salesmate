import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import {
  Card,
  Choice,
  Field,
  FormSection,
  Input,
  Notice,
  Segmented,
  Select,
  Textarea,
} from "@/components/ui";
import { MonthlyBudgetField } from "./budget-field";
import { AI_PROVIDER_INFO } from "@/lib/ai-providers";
import { goalProgress, monthSpendUsd } from "@/server/agents/automation";
import { DEFAULT_FIND_PER_RUN, MAX_FIND_PER_RUN } from "@/server/agents/prospector";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { getOrgAi } from "@/server/llm/org-ai";
import { listBases } from "@/server/prospects/bases";
import { getAgent, listChannelOptions, listSlackConnections } from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { listTeam } from "@/server/services/team";
import { rotateHook, saveAgentSetup } from "../actions";
import { TriggerFields } from "./trigger-fields";

const MODES = [
  { value: "find", label: "Buscar nuevos" },
  { value: "complete", label: "Completar vacíos" },
  { value: "both", label: "Las dos cosas" },
];

/**
 * The prospecting agent's setup on one screen, grouped by what each field
 * is about: its goal and table, when it works, its model and where it may
 * look, what it may spend in a month and how it lets the team know.
 * Saved with one button.
 */
export async function ProspectingSetup({ projectId, agentId }: { projectId: string; agentId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, project, options, slacks, team, bases, ai] = await Promise.all([
    getAgent(db, tenant, projectId, agentId),
    getProject(db, tenant, projectId),
    listChannelOptions(db, tenant),
    listSlackConnections(db, tenant),
    listTeam(db, tenant.orgId),
    listBases(db, tenant, projectId, { standalone: true }),
    getOrgAi(db, tenant),
  ]);
  if (!agent || !project) notFound();
  const config = agent.config;
  const s = config.settings;
  const base = bases.find((b) => b.id === config.prospectBaseId) ?? bases[0];
  const [spent, goal] = await Promise.all([
    monthSpendUsd(db, tenant, { agentId, timezone: project.timezone }),
    s.goal && base ? goalProgress(db, tenant, base.id, s.goal) : null,
  ]);
  const models = ai ? AI_PROVIDER_INFO[ai.provider].models : [];
  const orgModel = models.find((m) => m.id === ai?.model);
  const hookUrl = config.hookToken ? `${env().APP_URL}/api/hooks/agents/${config.hookToken}` : null;
  const mailboxes = options.mailboxes.filter((m) => m.canSend || m.id === config.channels.mailboxId);
  const notifyEmails = new Set((s.notify?.emails ?? []).map((e) => e.toLowerCase()));

  return (
    <div className="max-w-3xl space-y-6">
      <Card
        title="Configuración"
        tip="Lo que comparten todos los agentes ya lo saben: qué vendes y cómo hablar (Ajustes → Tu negocio) y el objetivo del proyecto (Ventas → Objetivo y público). Todo lo que hace por fuera pasa por el gateway: los avisos al equipo salen solos. Para escribir a las filas que encuentra, añade un agente outbound que trabaje con su tabla."
      >
        <ActionForm
          key={JSON.stringify([
            config.instructions,
            config.schedule,
            s,
            config.prospectBaseId,
            config.hookToken,
            config.channels.mailboxId,
          ])}
          action={saveAgentSetup.bind(null, projectId, agentId)}
          submitLabel="Guardar"
          className="space-y-8"
        >
          <FormSection title="Objetivo" tip="Qué busca, dónde lo guarda y cuántas filas quieres conseguir.">
            {bases.length ? (
              <Field
                label="Tabla en la que trabaja"
                tip="Las tablas son las listas de empresas o personas que ves en «Tablas». El agente guarda en esta lo que encuentra y rellena sus columnas."
                hint={
                  <span className="flex flex-wrap gap-3">
                    {base ? (
                      <Link href={`/app/tables/${base.id}`} className="text-accent hover:underline">
                        Ver la tabla
                      </Link>
                    ) : null}
                    <Link
                      href={`/app/projects/${projectId}/prospects/new`}
                      className="text-accent hover:underline"
                    >
                      Crear otra tabla
                    </Link>
                  </span>
                }
              >
                <Select
                  name="baseId"
                  defaultValue={config.prospectBaseId ?? bases[0].id}
                  className="max-w-sm"
                >
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.projectId ? "" : " (sin proyecto)"}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field
              label="Qué tiene que hacer y cómo"
              hint="Qué empresas buscar y cómo: sector, tamaño, zona, señales de que encajan, qué fuentes usar o evitar y qué datos recoger."
            >
              <Textarea name="instructions" defaultValue={config.instructions ?? ""} className="min-h-48" />
            </Field>
            <Field
              label="En cada ejecución"
              group
              tip="Completar rellena las celdas vacías de filas que ya están en la tabla. No toca lo que ha escrito una persona."
            >
              <Segmented name="mode" options={MODES} defaultValue={s.mode ?? "find"} />
            </Field>
            <Field
              label="Filas nuevas por ejecución"
              tip="Las que busca cada vez que trabaja solo (programado o por avisos). Al pulsar «Ejecutar ahora» te pregunta cuántas, con este número de partida. Si una ejecución no llega, sigue en la siguiente hasta conseguirlas."
            >
              <Input
                name="findPerRun"
                type="number"
                min={1}
                max={MAX_FIND_PER_RUN}
                defaultValue={s.findPerRun ?? DEFAULT_FIND_PER_RUN}
                className="w-40"
              />
            </Field>
            <Field
              label="Filas que quieres conseguir"
              optional
              tip="Al llegar, deja de buscar filas nuevas. Si solo busca filas nuevas, se pone en pausa; si también completa, sigue completando."
            >
              <Input name="goalRows" type="number" min={1} defaultValue={s.goal?.rows} className="w-40" />
            </Field>
            {goal ? (
              <p className="text-sm text-muted">
                Ahora: {goal.rows} de {goal.target}
                {goal.met ? " · objetivo cumplido" : ""}
              </p>
            ) : null}
          </FormSection>

          <TriggerFields
            projectId={projectId}
            config={config}
            run="En cada ejecución busca filas nuevas, completa las que tienen huecos o las dos cosas."
            hookUrl={s.triggers?.webhook ? hookUrl : null}
            events={[
              {
                name: "triggerNewRows",
                label: base ? `Entra una fila nueva en «${base.name}»` : "Entra una fila nueva en su tabla",
                description:
                  "Porque alguien la escribe, llega de un formulario o la añade otro agente: el agente completa sus datos al momento.",
                checked: Boolean(s.triggers?.newRows),
              },
              {
                name: "triggerWebhook",
                label: "Otra herramienta se lo pide",
                description:
                  "Para equipos que usan Zapier, Make o su CRM: llaman a una dirección secreta del agente y este trabaja con lo que le cuentan. Si no lo necesitas, déjalo sin marcar.",
                checked: Boolean(s.triggers?.webhook),
              },
            ]}
          />

          <FormSection title="Modelo y fuentes" tip="Qué IA usa y en qué sitios puede buscar.">
            {models.length ? (
              <Field
                label="Modelo de IA"
                tip="El que piensa y busca. Completar datos de filas lo hace siempre el modelo económico de tu proveedor, que es mucho más barato."
              >
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
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Solo en estos sitios"
                optional
                tip="Dominios, uno por línea o separados por comas. Con esta lista, no busca ni lee fuera de ellos."
              >
                <Textarea
                  name="sourcesAllow"
                  defaultValue={(s.sources?.allow ?? []).join("\n")}
                  placeholder={"anfac.com\nconcesionarios.es"}
                  className="min-h-24"
                />
              </Field>
              <Field label="Nunca en estos" optional>
                <Textarea
                  name="sourcesBlock"
                  defaultValue={(s.sources?.block ?? []).join("\n")}
                  placeholder="competidor.com"
                  className="min-h-24"
                />
              </Field>
            </div>
          </FormSection>

          <MonthlyBudgetField value={s.budget?.maxCostPerMonthUsd} spent={spent} />

          <FormSection
            title="Avisos al equipo"
            tip="El agente puede avisaros de lo que hace. Elige cuándo y por dónde; si no marcas nada, no avisa."
          >
            <Field label="Cuándo avisa" group>
              <div className="grid gap-2 sm:grid-cols-2">
                <Choice
                  card
                  name="notifyOnFinish"
                  defaultChecked={Boolean(s.notify?.onFinish)}
                  label="Al terminar cada ejecución"
                  description="Un resumen de lo que ha encontrado y completado."
                />
                <Choice
                  card
                  name="notifyOnProblem"
                  defaultChecked={Boolean(s.notify?.onProblem)}
                  label="Si algo va mal"
                  description="Si falla, no encuentra nada o llega al gasto máximo del mes."
                />
              </div>
            </Field>
            <Field label="Por Slack" tip="Publica el aviso en ese canal.">
              {slacks.length ? (
                <Select
                  name="slackConnectionId"
                  defaultValue={s.notify?.slackConnectionId ?? ""}
                  className="max-w-sm"
                >
                  <option value="">No avisar por Slack</option>
                  {slacks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted">
                  <Link href="/app/connections?add=slack" className="text-accent hover:underline">
                    Conecta un canal de Slack
                  </Link>{" "}
                  para recibir los avisos allí.
                </p>
              )}
            </Field>
            <Field label="Por email" group tip="A las personas del equipo que marques.">
              {mailboxes.length ? (
                <div className="space-y-4 rounded-lg border border-border p-4">
                  <div className="space-y-2">
                    {team.members.map((m) => (
                      <Choice
                        key={m.id}
                        name="notifyEmails"
                        value={m.email}
                        defaultChecked={notifyEmails.has(m.email.toLowerCase())}
                        label={`${m.name} · ${m.email}`}
                      />
                    ))}
                  </div>
                  <Field
                    label="Se envían desde"
                    tip="El buzón de Gmail conectado desde el que salen estos emails de aviso. Solo se usa para eso."
                  >
                    <Select
                      name="mailboxId"
                      defaultValue={config.channels.mailboxId ?? ""}
                      className="max-w-sm"
                    >
                      <option value="">— Elige un buzón —</option>
                      {mailboxes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.address}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Para avisar por email hace falta un buzón desde el que enviarlos.{" "}
                  <Link href="/app/connections?add=gmail" className="text-accent hover:underline">
                    Conecta Gmail
                  </Link>
                  .
                </p>
              )}
            </Field>
          </FormSection>
        </ActionForm>
      </Card>

      {hookUrl && s.triggers?.webhook ? (
        <Card title="Webhook">
          <Notice
            action={
              <ActionForm
                action={rotateHook.bind(null, projectId, agentId)}
                submitLabel="Crear otra dirección"
                submitVariant="secondary"
                confirm="La dirección actual dejará de funcionar. ¿Seguir?"
                cancel={false}
              />
            }
          >
            Si la dirección se ha compartido con quien no debía, crea otra.
          </Notice>
        </Card>
      ) : null}
    </div>
  );
}
