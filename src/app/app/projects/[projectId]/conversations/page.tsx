import { FlaskConical, Inbox, MessagesSquare, RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, EmptyState, Field, Input, LinkButton, Notice, Textarea, Toolbar } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AiNotice, currentAi } from "../../../ai-notice";
import { getAgent } from "@/server/services/agents";
import { listConversations, listRecentEvents } from "@/server/services/sales";
import { InboxView, type InboxQuery } from "../../../conversations/inbox-view";
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

/** What the project's inbound agent received, and whether it was processed. */
async function RecentEntries({ projectId }: { projectId: string }) {
  const tenant = await requireTenant();
  const [events, llm] = await Promise.all([listRecentEvents(getDb(), tenant, projectId), currentAi()]);
  return (
    <ModalButton
      label="Entradas"
      icon={<Inbox className="size-4" />}
      title="Entradas recientes"
      variant="ghost"
    >
      {events.length === 0 ? (
        <EmptyState
          compact
          icon={<RefreshCw />}
          title="Sin entradas todavía"
          description="Cada formulario, email o WhatsApp que reciba el proyecto aparece aquí, con su estado de procesado."
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
        <div className="mt-4">
          <ActionForm
            action={processNow.bind(null, projectId)}
            submitLabel="Procesar pendientes ahora"
            submitVariant="secondary"
            stayOpen
          />
        </div>
      ) : null}
    </ModalButton>
  );
}

/** The project's people and their conversations: the inbox, for this project only. */
export default async function ConversationsPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/conversations">) {
  const { projectId } = await params;
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"),
  ) as InboxQuery;
  const tenant = await requireTenant();
  const db = getDb();
  const [inbound, rows] = await Promise.all([
    getAgent(db, tenant, projectId, "inbound"),
    listConversations(db, tenant, projectId),
  ]);
  const agentsUrl = `/app/projects/${projectId}/agents`;

  return (
    <>
      <Toolbar>
        {inbound ? <RecentEntries projectId={projectId} /> : null}
        {rows.length > 0 && inbound ? <SimulateLeadButton projectId={projectId} /> : null}
      </Toolbar>
      <div className="space-y-4">
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
        {inbound ? (
          <AiNotice feature="El agente inbound (los mensajes se guardan y se atenderán después)" />
        ) : null}

        {rows.length === 0 ? (
          inbound ? (
            <EmptyState
              icon={<MessagesSquare />}
              title="Todavía no hay conversaciones"
              description="Llegarán cuando conectes el formulario de tu web, un buzón o WhatsApp en los canales del agente inbound. Mientras, prueba cómo respondería con un lead simulado."
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
              description="Las conversaciones las abren los agentes. Añade el agente inbound para atender a quien te contacta por tu web, por email o por WhatsApp."
              action={
                <LinkButton href={agentsUrl} variant="primary">
                  Añadir un agente
                </LinkButton>
              }
            />
          )
        ) : (
          <InboxView
            tenant={tenant}
            projectId={projectId}
            query={query}
            basePath={`/app/projects/${projectId}/conversations`}
            heightClass="h-[calc(100dvh-19rem)] min-h-[26rem] md:h-[calc(100dvh-18rem)]"
          />
        )}
      </div>
    </>
  );
}
