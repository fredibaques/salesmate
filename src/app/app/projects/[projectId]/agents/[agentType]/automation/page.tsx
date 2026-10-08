import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
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
import Link from "next/link";
import { goalProgress, monthSpendUsd } from "@/server/agents/automation";
import { DEFAULT_HANDOFF_MIN_FIT, DEFAULT_HANDOFF_PER_RUN } from "@/server/agents/first-contact";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { listBases } from "@/server/prospects/bases";
import {
  getAgent,
  isProjectAgentType,
  listChannelOptions,
  listSlackConnections,
} from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { listTeam } from "@/server/services/team";
import { rotateHook, saveAutomation } from "../../actions";

export const metadata = { title: "Automatización" };

const PREFER = [
  { value: "", label: "Sin preferencia" },
  { value: "data", label: "Datos conectados primero" },
  { value: "web", label: "Web primero" },
];

/**
 * What makes the prospecting agent more autonomous: what else starts it,
 * its goal and spending caps, where it may look, whom it tells and the
 * next step (a first email, for approval).
 */
export default async function AgentAutomationPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/automation">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType) || agentType !== "outbound") notFound();
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, project, options, slacks, team] = await Promise.all([
    getAgent(db, tenant, projectId, agentType),
    getProject(db, tenant, projectId),
    listChannelOptions(db, tenant),
    listSlackConnections(db, tenant),
    listTeam(db, tenant.orgId),
  ]);
  if (!agent || !project) notFound();
  const config = agent.config;
  const s = config.settings;
  const bases = await listBases(db, tenant, projectId, { standalone: true });
  const base = bases.find((b) => b.id === config.prospectBaseId) ?? bases[0];
  const [spent, goal] = await Promise.all([
    monthSpendUsd(db, tenant, { projectId, timezone: project.timezone }),
    s.goal && base ? goalProgress(db, tenant, base.id, s.goal) : null,
  ]);
  const hookUrl = config.hookToken ? `${env().APP_URL}/api/hooks/agents/${config.hookToken}` : null;
  const mailboxes = options.mailboxes.filter((m) => m.canSend || m.id === config.channels.mailboxId);
  const notifyEmails = new Set((s.notify?.emails ?? []).map((e) => e.toLowerCase()));

  return (
    <div className="max-w-3xl space-y-6">
      <Card
        title="Automatización"
        tip="Todo lo que hace por fuera pasa por el gateway: los avisos al equipo salen solos y los emails a prospectos esperan tu aprobación en «Por aprobar»."
      >
        <ActionForm
          key={JSON.stringify([s, config.hookToken, config.channels.mailboxId])}
          action={saveAutomation.bind(null, projectId, agentType)}
          submitLabel="Guardar"
          className="space-y-6"
        >
          <FormSection
            title="Cuándo más trabaja"
            tip="Además de su horario y de «Ejecutar ahora». Lo que llega mientras está trabajando espera a que termine."
          >
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
            {hookUrl && s.triggers?.webhook ? (
              <div className="space-y-2 rounded-lg bg-background p-3">
                <p className="text-xs font-medium text-muted">Dirección del webhook (secreta)</p>
                <code className="block text-xs break-all">{hookUrl}</code>
                <CopyButton text={hookUrl} label="Copiar dirección" />
              </div>
            ) : null}
          </FormSection>

          <FormSection
            title="Objetivo"
            tip="Al llegar, deja de buscar filas nuevas. Si solo busca filas nuevas, se pone en pausa; si también completa, sigue completando."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Filas que quieres conseguir" optional>
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

          <FormSection
            title="Límites de gasto"
            tip="Cuando una ejecución llega a su límite, guarda lo que tiene y termina. Con el límite del mes alcanzado no vuelve a trabajar hasta el mes siguiente. Vacío: sin límite."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Por ejecución ($)" optional>
                <Input
                  name="maxCostPerRunUsd"
                  inputMode="decimal"
                  defaultValue={s.budget?.maxCostPerRunUsd}
                  placeholder="p. ej. 1"
                />
              </Field>
              <Field label="Al mes ($)" optional hint={`Este mes: ${spent.toFixed(2)} $`}>
                <Input
                  name="maxCostPerMonthUsd"
                  inputMode="decimal"
                  defaultValue={s.budget?.maxCostPerMonthUsd}
                  placeholder="p. ej. 30"
                />
              </Field>
              <Field label="Búsquedas web" optional hint="Por ejecución.">
                <Input
                  name="maxSearchesPerRun"
                  type="number"
                  min={1}
                  defaultValue={s.budget?.maxSearchesPerRun}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Fuentes"
            tip="Dominios, uno por línea o separados por comas. Con «Solo en estos», no busca ni lee fuera de ellos."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Solo en estos sitios" optional>
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
            <Field label="Por dónde empieza" group tip="Entre la web y los datos conectados (Apollo, Lusha).">
              <Segmented name="sourcesPrefer" options={PREFER} defaultValue={s.sources?.prefer ?? ""} />
            </Field>
          </FormSection>

          <FormSection
            title="Buzón"
            tip="Desde el que escribe los primeros emails y envía los avisos por email."
          >
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
          </FormSection>

          <FormSection
            title="Avisos al equipo"
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
            <Field label="Slack">
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
            <Field label="Email" group hint="Solo personas de la organización, desde el buzón de arriba.">
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
            tip="Después de cada ejecución, escribe un primer email para las filas con email que encajan y lo propone desde su buzón. Nada sale sin tu aprobación en «Por aprobar», y se respetan el horario de envío y las exclusiones del proyecto."
          >
            <Choice
              card
              name="handoffEnabled"
              defaultChecked={Boolean(s.handoff?.enabled)}
              label="Preparar el primer email de las filas que encajan"
              description="Un email por fila, una sola vez."
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
                action={rotateHook.bind(null, projectId, agentType)}
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
