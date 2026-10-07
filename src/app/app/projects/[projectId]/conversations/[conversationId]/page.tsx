import { Bot, ListChecks } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, LinkButton, Meta, PageHeader } from "@/components/ui";
import {
  ACTION_STATUS_LABELS,
  CONTACT_STATUS_LABELS,
  CONVERSATION_STATUS,
  formatDateTime,
} from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActionDefinition } from "@/server/gateway/definitions";
import { getConversation } from "@/server/services/sales";

export default async function ConversationPage({
  params,
}: PageProps<"/app/projects/[projectId]/conversations/[conversationId]">) {
  const { conversationId } = await params;
  const tenant = await requireTenant();
  const data = await getConversation(getDb(), tenant, conversationId);
  if (!data) notFound();
  const { conversation: c, contact } = data;

  return (
    <>
      <PageHeader
        title={
          [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || contact?.email || "Contacto"
        }
        badge={
          <span className="text-sm text-muted">
            <Meta items={[contact?.email, contact?.phone, contact?.companyName]} />
          </span>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title="Conversación">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={CONVERSATION_STATUS[c.status].tone}>{CONVERSATION_STATUS[c.status].label}</Badge>
              {c.classification ? <Badge tone="accent">{c.classification}</Badge> : null}
              {contact?.status ? <Badge>{CONTACT_STATUS_LABELS[contact.status]}</Badge> : null}
              {contact?.fitScore != null ? <Badge>encaje {contact.fitScore}</Badge> : null}
            </div>
            {c.summary ? <p className="mb-4 rounded-lg bg-background p-3 text-sm">{c.summary}</p> : null}
            <ul className="space-y-3">
              {data.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-lg border p-3 text-sm ${m.direction === "inbound" ? "border-border" : "border-brand-200 bg-brand-50"}`}
                >
                  <div className="mb-1 text-xs text-muted">
                    {m.direction === "inbound" ? "Contacto" : "Nosotros"} · {m.channel} ·{" "}
                    {formatDateTime(m.sentAt)}
                  </div>
                  {m.subject ? <div className="font-medium">{m.subject}</div> : null}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title="Acciones propuestas"
            actions={
              data.actions.length > 0 ? (
                <LinkButton href="/app/inbox" variant="ghost">
                  Ir a Por aprobar
                </LinkButton>
              ) : null
            }
          >
            {data.actions.length === 0 ? (
              <EmptyState
                compact
                icon={<ListChecks />}
                title="Ninguna acción propuesta"
                description="Si el agente quiere responder, agendar o anotar algo en el CRM, aparecerá aquí y en «Por aprobar»."
              />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.actions.map((a) => {
                  const s = ACTION_STATUS_LABELS[a.status];
                  return (
                    <li key={a.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>{getActionDefinition(a.type)?.summary(a.payload) ?? a.type}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      {a.reason ? <div className="text-xs text-muted">{a.reason}</div> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Qué ha hecho el agente">
            {data.runs.length === 0 ? (
              <EmptyState
                compact
                icon={<Bot />}
                title="El agente aún no ha trabajado en esta conversación"
                description="Cada vez que la procese verás aquí sus pasos, las herramientas que ha usado y el coste."
              />
            ) : (
              data.runs.map((run) => (
                <details key={run.id} className="mb-3 text-sm">
                  <summary className="-mx-2 rounded-lg px-2 py-1 transition-colors hover:bg-background">
                    {formatDateTime(run.startedAt)} · {run.status} · ${run.costUsd.toFixed(3)}
                  </summary>
                  <ol className="mt-2 space-y-1 text-xs">
                    {run.steps.map((step, i) => (
                      <li
                        key={i}
                        className={step.type === "tool_result" && step.isError ? "text-danger" : "text-muted"}
                      >
                        {step.type === "text" ? (
                          <span className="text-foreground">{step.text}</span>
                        ) : step.type === "tool_call" ? (
                          <code>
                            → {step.name}({JSON.stringify(step.input).slice(0, 160)})
                          </code>
                        ) : (
                          <code>
                            ← {step.name}: {JSON.stringify(step.output).slice(0, 160)}
                          </code>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              ))
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
