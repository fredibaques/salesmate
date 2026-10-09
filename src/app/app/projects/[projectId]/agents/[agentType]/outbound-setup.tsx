import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { ScheduleFields } from "@/components/schedule-fields";
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
import { AI_PROVIDER_INFO } from "@/lib/ai-providers";
import { goalProgress, monthSpendUsd } from "@/server/agents/automation";
import { DEFAULT_HANDOFF_MIN_FIT, DEFAULT_HANDOFF_PER_RUN } from "@/server/agents/first-contact";
import { DEFAULT_CELLS_PER_RUN } from "@/server/agents/prospector";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { getOrgAi } from "@/server/llm/org-ai";
import { listBases } from "@/server/prospects/bases";
import { getAgent, listChannelOptions, listSlackConnections } from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { listTeam } from "@/server/services/team";
import { rotateHook, saveAgentSetup } from "../actions";
import { ScheduleStatus } from "./schedule-status";

const MODES = [
  { value: "find", label: "Buscar nuevos" },
  { value: "complete", label: "Completar vacíos" },
  { value: "both", label: "Las dos cosas" },
];

const PREFER = [
  { value: "", label: "Sin preferencia" },
  { value: "data", label: "Datos conectados primero" },
  { value: "web", label: "Web primero" },
];

/**
 * The prospecting agent's setup on one screen, grouped by what each field
 * is about: its goal, how it runs, its model (and where it may look and how
 * much it may spend), whom it tells and the next step after it finds rows.
 * Saved with one button.
 */
export async function OutboundSetup({ projectId }: { projectId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, project, options, slacks, team, bases, ai] = await Promise.all([
    getAgent(db, tenant, projectId, "outbound"),
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
    monthSpendUsd(db, tenant, { projectId, timezone: project.timezone }),
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
        tip="Lo que comparten todos los agentes (qué vendes, a quién, tono) ya lo saben por Ajustes → Oferta y cliente. Todo lo que hace por fuera pasa por el gateway: los avisos al equipo salen solos y los emails a prospectos esperan tu aprobación."
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
          action={saveAgentSetup.bind(null, projectId, "outbound")}
          submitLabel="Guardar"
          className="space-y-8"
        >
          <FormSection title="Objetivo" tip="Qué busca, dónde lo guarda y cuántas filas quieres conseguir.">
            {bases.length ? (
              <Field
                label="Trabaja sobre"
                tip="La tabla donde guarda lo que encuentra: una del proyecto o una sin proyecto. Recoge los datos de sus columnas."
                hint={
                  <Link
                    href={`/app/projects/${projectId}/prospects/new`}
                    className="text-accent hover:underline"
                  >
                    Crear otra tabla
                  </Link>
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
              tip="Completar rellena las celdas vacías de filas que ya están en la tabla, empezando por las de mejor encaje. No toca lo que ha escrito una persona."
            >
              <Segmented name="mode" options={MODES} defaultValue={s.mode ?? "find"} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Filas que quieres conseguir"
                optional
                tip="Al llegar, deja de buscar filas nuevas. Si solo busca filas nuevas, se pone en pausa; si también completa, sigue completando."
              >
                <Input name="goalRows" type="number" min={1} defaultValue={s.goal?.rows} className="w-40" />
              </Field>
              <Field label="Con encaje mínimo" optional hint="De 0 a 100. Vacío: cualquier encaje.">
                <Input
                  name="goalMinFit"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={s.goal?.minFit}
                  className="w-40"
                />
              </Field>
            </div>
            {goal ? (
              <p className="text-sm text-muted">
                Ahora: {goal.rows} de {goal.target}
                {goal.met ? " · objetivo cumplido" : ""}
              </p>
            ) : null}
          </FormSection>

          <FormSection title="Ejecución" tip="Cuándo trabaja y cuánto hace cada vez.">
            <ScheduleFields schedule={config.schedule} />
            <ScheduleStatus projectId={projectId} config={config} />
            <Field
              label="Además, trabaja"
              group
              tip="Lo que llega mientras está trabajando espera a que termine."
            >
              <div className="space-y-2">
                <Choice
                  card
                  name="triggerNewRows"
                  defaultChecked={Boolean(s.triggers?.newRows)}
                  label="Cuando alguien añade una fila a su tabla"
                  description={base ? `Completa esa fila (en «${base.name}»).` : "Completa esa fila."}
                />
                <Choice
                  card
                  name="triggerWebhook"
                  defaultChecked={Boolean(s.triggers?.webhook)}
                  label="Cuando recibe un aviso de otra herramienta"
                  description="Tu CRM, Zapier o Make envían un POST a su dirección y trabaja con lo que le cuentan."
                />
              </div>
            </Field>
            {hookUrl && s.triggers?.webhook ? (
              <div className="space-y-2 rounded-lg bg-background p-3">
                <p className="text-xs font-medium text-muted">Dirección del webhook (secreta)</p>
                <code className="block text-xs break-all">{hookUrl}</code>
                <CopyButton text={hookUrl} label="Copiar dirección" />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Filas nuevas por ejecución"
                tip="Cuántas empresas o personas nuevas busca cada vez."
              >
                <Input
                  name="prospectsPerRun"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={s.prospectsPerRun ?? 10}
                  className="w-32"
                />
              </Field>
              <Field
                label="Celdas a completar por ejecución"
                tip="Tope de datos que busca para filas que ya existen. Junto con las filas nuevas, controla lo que cuesta cada ejecución."
              >
                <Input
                  name="cellsPerRun"
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={s.cellsPerRun ?? DEFAULT_CELLS_PER_RUN}
                  className="w-32"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Configuración del modelo"
            tip="Qué IA usa, dónde puede buscar y cuánto puede gastar."
          >
            {models.length ? (
              <Field
                label="Modelo de IA"
                tip="Uno más económico para tareas repetitivas (completar datos), el más capaz para investigar. Del mismo proveedor que la organización."
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
            <Field
              label="Por dónde empieza"
              group
              tip="Entre la web y los datos conectados (Apollo, Lusha, Hunter)."
            >
              <Segmented name="sourcesPrefer" options={PREFER} defaultValue={s.sources?.prefer ?? ""} />
            </Field>
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
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Gasto por ejecución ($)"
                optional
                tip="Al llegar, guarda lo que tiene y termina. Vacío: sin límite."
              >
                <Input
                  name="maxCostPerRunUsd"
                  inputMode="decimal"
                  defaultValue={s.budget?.maxCostPerRunUsd}
                  placeholder="p. ej. 1"
                />
              </Field>
              <Field
                label="Gasto al mes ($)"
                optional
                hint={`Este mes: ${spent.toFixed(2)} $`}
                tip="Con el límite alcanzado no vuelve a trabajar hasta el mes siguiente."
              >
                <Input
                  name="maxCostPerMonthUsd"
                  inputMode="decimal"
                  defaultValue={s.budget?.maxCostPerMonthUsd}
                  placeholder="p. ej. 30"
                />
              </Field>
              <Field label="Búsquedas web por ejecución" optional>
                <Input
                  name="maxSearchesPerRun"
                  type="number"
                  min={1}
                  defaultValue={s.budget?.maxSearchesPerRun}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Comunicación" tip="Desde dónde escribe y a quién avisa.">
            <Field label="Buzón" tip="Desde el que escribe los primeros emails y envía los avisos por email.">
              {mailboxes.length ? (
                <Select name="mailboxId" defaultValue={config.channels.mailboxId ?? ""} className="max-w-sm">
                  <option value="">Ninguno</option>
                  {mailboxes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.address}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted">
                  No hay buzones que puedan enviar.{" "}
                  <Link href="/app/connections?add=google" className="text-accent hover:underline">
                    Conecta uno
                  </Link>
                  .
                </p>
              )}
            </Field>
            <Field
              label="Avisos al equipo"
              group
              tip="Un resumen al terminar y una alerta si falla, no encuentra nada o llega a un límite."
            >
              <div className="flex flex-wrap gap-4">
                <Choice
                  name="notifyOnFinish"
                  defaultChecked={Boolean(s.notify?.onFinish)}
                  label="Al terminar"
                />
                <Choice
                  name="notifyOnProblem"
                  defaultChecked={Boolean(s.notify?.onProblem)}
                  label="Si hay un problema"
                />
              </div>
            </Field>
            <Field label="Por Slack">
              {slacks.length ? (
                <Select
                  name="slackConnectionId"
                  defaultValue={s.notify?.slackConnectionId ?? ""}
                  className="max-w-sm"
                >
                  <option value="">Sin Slack</option>
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
            <Field label="Por email" group hint="Solo personas de la organización, desde el buzón de arriba.">
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
            </Field>
          </FormSection>

          <FormSection
            title="Siguiente paso: primer contacto"
            tip="Después de cada ejecución, escribe un primer email para las filas con email que encajan y lo propone desde su buzón. Nada sale sin tu aprobación, y se respetan el horario de envío y las exclusiones del proyecto."
          >
            <Choice
              card
              name="handoffEnabled"
              defaultChecked={Boolean(s.handoff?.enabled)}
              label="Preparar el primer email de las filas que encajan"
              description="Un email por fila, una sola vez. Aparece en Conversaciones para aprobarlo."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Encaje mínimo">
                <Input
                  name="handoffMinFit"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={s.handoff?.minFit ?? DEFAULT_HANDOFF_MIN_FIT}
                  className="w-32"
                />
              </Field>
              <Field label="Emails por ejecución">
                <Input
                  name="handoffPerRun"
                  type="number"
                  min={1}
                  max={25}
                  defaultValue={s.handoff?.perRun ?? DEFAULT_HANDOFF_PER_RUN}
                  className="w-32"
                />
              </Field>
            </div>
            <Field label="Cómo escribirlo" optional>
              <Textarea
                name="handoffInstructions"
                defaultValue={s.handoff?.instructions ?? ""}
                placeholder="Tono, qué mencionar, qué evitar, cómo firmar…"
                className="min-h-24"
              />
            </Field>
          </FormSection>
        </ActionForm>
      </Card>

      {hookUrl && s.triggers?.webhook ? (
        <Card title="Webhook">
          <Notice
            action={
              <ActionForm
                action={rotateHook.bind(null, projectId, "outbound")}
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
