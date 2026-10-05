import { FlaskConical, MessagesSquare, RefreshCw } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Table,
  Td,
  Textarea,
  Notice,
  PageHeader,
} from "@/components/ui";
import { CONVERSATION_STATUS, formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { isLlmConfigured } from "@/server/llm/client";
import { getAgent } from "@/server/services/agents";
import { listConversations, listRecentEvents } from "@/server/services/sales";
import { processNow, simulateLead } from "./actions";

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
      description="Entra como si viniera del formulario de la web y lo atiende el agente inbound con su proceso, aunque todavía no esté activado. Lo que proponga espera tu aprobación en Copilot → Por aprobar."
      variant={variant}
      width="lg"
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
  const [inbound, rows, events] = await Promise.all([
    getAgent(db, tenant, projectId, "inbound"),
    listConversations(db, tenant, projectId),
    listRecentEvents(db, tenant, projectId),
  ]);
  const llm = isLlmConfigured();
  const agentsUrl = `/app/projects/${projectId}/agents`;

  return (
    <>
      <PageHeader
        level="section"
        title="Conversaciones"
        description="Cada contacto entrante, lo que ha dicho, cómo lo ha valorado el agente y qué ha propuesto."
        actions={rows.length > 0 && inbound ? <SimulateLeadButton projectId={projectId} /> : null}
      />
      <div className="space-y-6">
        {inbound && !inbound.config.enabled ? (
          <Notice
            tone="warning"
            action={
              <LinkButton href={`${agentsUrl}/inbound`} variant="secondary">
                Ir al agente
              </LinkButton>
            }
          >
            El agente inbound está en pausa: los contactos que lleguen se guardan y los atenderá cuando lo
            actives.
          </Notice>
        ) : null}
        {!llm ? (
          <Notice tone="warning">
            Los agentes están desactivados: falta ANTHROPIC_API_KEY. Los mensajes se guardan y se procesarán
            cuando la configures.
          </Notice>
        ) : null}

        <Card>
          {rows.length === 0 ? (
            inbound ? (
              <EmptyState
                icon={<MessagesSquare />}
                title="Todavía no hay conversaciones"
                description="Llegarán cuando conectes el formulario de tu web o un buzón en los canales del agente inbound. Mientras, prueba cómo respondería con un lead simulado."
                action={
                  <>
                    <SimulateLeadButton projectId={projectId} variant="primary" />
                    <LinkButton href={`${agentsUrl}/inbound/channels`}>Configurar canales</LinkButton>
                  </>
                }
              />
            ) : (
              <EmptyState
                icon={<MessagesSquare />}
                title="Todavía no hay conversaciones"
                description="Las conversaciones las abren los agentes. Añade el agente inbound para atender a quien te contacta por tu web o por email."
                action={
                  <LinkButton href={agentsUrl} variant="primary">
                    Añadir un agente
                  </LinkButton>
                }
              />
            )
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

        <div>
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
    </>
  );
}
