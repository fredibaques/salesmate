import { FlaskConical, MessagesSquare, RefreshCw, Webhook } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Table,
  Td,
  Textarea,
} from "@/components/ui";
import { CONVERSATION_STATUS, formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { isLlmConfigured } from "@/server/llm/client";
import { getProject } from "@/server/services/projects";
import { listConversations, listRecentEvents } from "@/server/services/sales";
import { processNow, rotateKey, simulateLead } from "./actions";

const EVENT_STATUS: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  processing: "warning",
  processed: "success",
  ignored: "neutral",
  error: "danger",
};

function SimulateLeadButton({
  projectId,
  variant = "secondary",
}: {
  projectId: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <ModalButton
      label="Simular un lead"
      icon={<FlaskConical className="size-4" />}
      title="Probar con un lead simulado"
      description="Entra como si viniera del formulario de la web y lo atiende el agente inbound con el playbook activo. Las acciones que proponga pasan por la bandeja."
      variant={variant}
      size="lg"
    >
      <ActionForm
        action={simulateLead.bind(null, projectId)}
        submitLabel="Enviar lead de prueba"
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <Input name="nombre" defaultValue="Laura Pérez" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue="laura@example.com" required />
          </Field>
          <Field label="Teléfono">
            <Input name="telefono" />
          </Field>
          <Field label="Empresa">
            <Input name="empresa" />
          </Field>
        </div>
        <Field label="Mensaje">
          <Textarea
            name="mensaje"
            required
            defaultValue="Hola, me gustaría saber cómo trabajáis y qué precio tendría."
          />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

export default async function ConversationsPage({
  params,
}: PageProps<"/app/projects/[projectId]/conversations">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [project, rows, events] = await Promise.all([
    getProject(db, tenant, projectId),
    listConversations(db, tenant, projectId),
    listRecentEvents(db, tenant, projectId),
  ]);
  const endpoint = `${env().APP_URL}/api/inbound/form/${projectId}`;
  const llm = isLlmConfigured();

  return (
    <div className="space-y-6">
      {!llm ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Los agentes están desactivados: falta ANTHROPIC_API_KEY. Los mensajes se guardan y se procesarán
          cuando la configures.
        </p>
      ) : null}

      <Card
        title="Conversaciones"
        description="Cada contacto entrante, lo que ha dicho, cómo lo ha valorado el agente y qué ha propuesto."
        actions={rows.length > 0 ? <SimulateLeadButton projectId={projectId} /> : null}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare />}
            title="Todavía no hay conversaciones"
            description="Llegarán cuando conectes el formulario de tu web o un buzón. Mientras, prueba cómo respondería el agente con un lead simulado."
            action={
              <>
                <SimulateLeadButton projectId={projectId} variant="primary" />
                <LinkButton href={`/app/projects/${projectId}/channels`}>Conectar un buzón</LinkButton>
              </>
            }
          />
        ) : (
          <Table head={["Contacto", "Canal", "Estado", "Valoración", "Resumen", "Último mensaje"]}>
            {rows.map(({ conversation: c, contact }) => (
              <tr key={c.id} className="group relative transition-colors hover:bg-background">
                <Td>
                  <Link
                    href={`/app/projects/${projectId}/conversations/${c.id}`}
                    className="font-medium group-hover:text-accent after:absolute after:inset-0"
                  >
                    {[contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
                      contact?.email ||
                      "—"}
                  </Link>
                  <div className="text-xs text-muted">{contact?.companyName ?? contact?.email}</div>
                </Td>
                <Td>
                  <Badge>{c.channel}</Badge>
                </Td>
                <Td>
                  <Badge tone={CONVERSATION_STATUS[c.status].tone}>
                    {CONVERSATION_STATUS[c.status].label}
                  </Badge>
                </Td>
                <Td className="text-xs">
                  {c.classification ?? "—"}
                  {contact?.fitScore != null ? (
                    <div className="text-muted">encaje {contact.fitScore}</div>
                  ) : null}
                </Td>
                <Td className="max-w-md text-xs text-muted">{c.summary ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(c.lastMessageAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Formulario de la web"
          description="Envía los formularios de tu web a esta dirección (POST, JSON o formulario normal). El agente responde en segundos."
        >
          {project?.inboundFormKey ? (
            <div className="space-y-2 text-sm">
              <div>
                Dirección: <code className="break-all text-xs">{endpoint}</code>
              </div>
              <div>
                Clave: <code className="break-all text-xs">{project.inboundFormKey}</code>
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
          <p className="mt-3 text-xs text-muted">
            Los emails llegan solos si conectas un buzón de Google con permiso de lectura y lo asignas a este
            proyecto en «Canales».
          </p>
        </Card>

        <Card title="Entradas recientes">
          {events.length === 0 ? (
            <EmptyState
              compact
              icon={<RefreshCw />}
              title="Sin entradas todavía"
              description="Cada formulario o email que reciba el proyecto aparece aquí, con su estado de procesado."
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {e.source} · <span className="text-xs text-muted">{formatDateTime(e.receivedAt)}</span>
                    {e.error ? <div className="text-xs text-danger">{e.error}</div> : null}
                  </span>
                  <Badge tone={EVENT_STATUS[e.status]}>{e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          {llm ? (
            <div className="mt-3">
              <ActionForm
                action={processNow.bind(null, projectId)}
                submitLabel="Procesar pendientes ahora"
                submitVariant="secondary"
              />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
