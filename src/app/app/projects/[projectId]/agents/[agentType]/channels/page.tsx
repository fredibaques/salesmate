import { Plug, Plus, Webhook } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Choice, EmptyState, Field, LinkButton, Select } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import {
  getAgent,
  isProjectAgentType,
  listChannelOptions,
  listDataSources,
  listMcpServers,
} from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { rotateKey } from "../../../conversations/actions";
import { saveChannels } from "../../actions";
import { ToolsCard } from "../tools-card";

function ConnectLink({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/app/connections?add=1" className="text-accent hover:underline">
      {children}
    </Link>
  );
}

export default async function AgentChannelsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/channels">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, options, project, servers, sources] = await Promise.all([
    getAgent(db, tenant, projectId, agentType),
    listChannelOptions(db, tenant),
    getProject(db, tenant, projectId),
    listMcpServers(db, tenant),
    listDataSources(db, tenant),
  ]);
  if (!agent || !project) notFound();
  const toolsCard = (
    <ToolsCard
      projectId={projectId}
      agentType={agentType}
      tools={agent.config.tools}
      servers={servers}
      sources={sources}
    />
  );
  // The prospecting agent doesn't write to anyone: it only needs its tools.
  if (agentType === "outbound") return <div className="max-w-3xl">{toolsCard}</div>;
  const channels = agent.config.channels;
  const nothingConnected = options.mailboxes.length + options.calendars.length + options.crms.length === 0;
  const endpoint = `${env().APP_URL}/api/inbound/form/${projectId}`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card title="Con qué trabaja">
          {nothingConnected ? (
            <EmptyState
              compact
              icon={<Plug />}
              title="Tu organización no ha conectado ninguna cuenta"
              description="Conecta primero tu correo y calendario (por ejemplo Google Workspace) o tu CRM. Solo se hace una vez y sirve para todos tus proyectos."
              action={
                <LinkButton href="/app/connections?add=1" variant="primary">
                  <Plus className="size-4" />
                  Conectar una cuenta
                </LinkButton>
              }
            />
          ) : (
            <ActionForm
              action={saveChannels.bind(null, projectId, agentType)}
              submitLabel="Guardar canales"
              className="space-y-4"
            >
              <Field
                label="Buzón desde el que escribe"
                hint={
                  options.mailboxes.length === 0 ? (
                    <>
                      No hay buzones conectados. <ConnectLink>Conecta uno</ConnectLink>.
                    </>
                  ) : (
                    "Las respuestas salen desde aquí, siempre después de tu aprobación salvo que subas su autonomía."
                  )
                }
              >
                <Select name="mailboxId" defaultValue={channels.mailboxId ?? ""}>
                  <option value="">— Ninguno —</option>
                  {options.mailboxes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.address}
                      {m.canSend ? "" : " (sin permiso para enviar)"}
                    </option>
                  ))}
                </Select>
              </Field>
              {agentType === "inbound" ? (
                <Choice
                  name="readMailbox"
                  defaultChecked={channels.readMailbox ?? false}
                  label="Atender también los emails que llegan a este buzón"
                  description="Cada email nuevo se trata como un contacto entrante. Necesita que la cuenta tenga permiso de lectura."
                />
              ) : null}
              <Field
                label="Calendario donde agenda"
                hint={
                  options.calendars.length === 0 ? (
                    <>
                      No hay calendarios conectados. <ConnectLink>Conecta uno</ConnectLink>.
                    </>
                  ) : (
                    "Solo hace falta si el proceso termina en una reunión o una llamada."
                  )
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
                hint={
                  options.crms.length === 0 ? (
                    <>
                      No hay CRM conectado. <ConnectLink>Conecta uno</ConnectLink>.
                    </>
                  ) : (
                    "Para buscar al contacto antes de responder y registrar lo que pasa."
                  )
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
            </ActionForm>
          )}
        </Card>
        {toolsCard}
      </div>

      {agentType === "inbound" ? (
        <Card
          title="Formulario de tu web"
          tip="Envía aquí los formularios de tu web (POST, en JSON o formulario normal) y el agente atiende cada envío en segundos."
        >
          {project.inboundFormKey ? (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs font-medium tracking-wide text-muted uppercase">Dirección</span>
                <code className="mt-1 block rounded-lg bg-background p-2 text-xs break-all">{endpoint}</code>
              </div>
              <div>
                <span className="text-xs font-medium tracking-wide text-muted uppercase">Clave</span>
                <code className="mt-1 block rounded-lg bg-background p-2 text-xs break-all">
                  {project.inboundFormKey}
                </code>
              </div>
              <details>
                <summary className="text-accent hover:underline">Ejemplo de formulario HTML</summary>
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
      ) : null}
    </div>
  );
}
