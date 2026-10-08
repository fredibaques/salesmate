import { ExternalLink, MessagesSquare, ScrollText } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, LinkButton, Meta, Notice, PageHeader } from "@/components/ui";
import { formatDateTime, TRANSCRIPT_STATUS } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getMeeting } from "@/server/meetings/service";
import { retryTranscriptAction } from "../actions";

const time = new Intl.DateTimeFormat("es-ES", { timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function MeetingPage({
  params,
}: PageProps<"/app/projects/[projectId]/meetings/[meetingId]">) {
  const { projectId, meetingId } = await params;
  const tenant = await requireTenant();
  const m = await getMeeting(getDb(), tenant, meetingId);
  if (!m || m.projectId !== projectId) notFound();
  const status = TRANSCRIPT_STATUS[m.transcriptStatus];
  const canRetry = tenant.role !== "member" && Boolean(m.meetCode) && m.transcriptStatus !== "ready";

  return (
    <>
      <PageHeader
        title={m.title}
        badge={
          <span className="flex flex-wrap items-center gap-3">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span className="text-sm text-muted">
              <Meta
                items={[
                  formatDateTime(m.startAt),
                  m.meetCode ? `meet.google.com/${m.meetCode}` : null,
                  m.attendees.map((a) => a.name ?? a.email).join(", ") || null,
                ]}
              />
            </span>
          </span>
        }
        actions={
          <>
            {canRetry ? (
              <ActionForm
                action={retryTranscriptAction.bind(null, projectId, m.id)}
                submitLabel="Buscar ahora"
                submitVariant="secondary"
                className="flex items-center gap-3"
              />
            ) : null}
            {m.conversationId ? (
              <LinkButton href={`/app/projects/${projectId}/conversations/${m.conversationId}`}>
                <MessagesSquare className="size-4" />
                Conversación
              </LinkButton>
            ) : null}
            {m.transcriptDocUrl ? (
              <LinkButton href={m.transcriptDocUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Documento de Meet
              </LinkButton>
            ) : null}
          </>
        }
      />
      {m.lastError || m.transcriptStatus === "waiting" ? (
        <div className="mb-6">
          <Notice
            tone={
              m.transcriptStatus === "error" ? "danger" : m.transcriptStatus === "ready" ? "warning" : "info"
            }
          >
            {m.lastError ??
              "Buscamos la transcripción cuando acaba la llamada, cada 10 minutos durante 48 horas."}
          </Notice>
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_2fr]">
        <Card title="Resumen">
          {m.summary ? (
            <div className="space-y-4 text-sm">
              <p className="whitespace-pre-wrap">{m.summary}</p>
              {m.nextSteps.length ? (
                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
                    Siguientes pasos
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {m.nextSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              compact
              icon={<ScrollText />}
              title="Sin resumen"
              description={
                m.transcriptStatus === "ready"
                  ? "Conecta la IA en Configuración → IA para resumir las próximas reuniones."
                  : "Se hará con la IA cuando llegue la transcripción."
              }
            />
          )}
        </Card>

        <Card title="Transcripción">
          {m.transcript?.length ? (
            <ol className="space-y-2 text-sm">
              {m.transcript.map((line, i) => (
                <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-3">
                  <span className="pt-0.5 text-xs text-muted tabular-nums">
                    {line.at ? time.format(new Date(line.at)) : ""}
                  </span>
                  <p>
                    <span className="font-medium">{line.speaker}: </span>
                    {line.text}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              compact
              icon={<ScrollText />}
              title="Todavía no hay transcripción"
              description="Solo existe si alguien activa la transcripción en Meet durante la llamada."
            />
          )}
        </Card>
      </div>
    </>
  );
}
