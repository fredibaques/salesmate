import { FileInput, Video } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, Card, EmptyState, Field, Input, Table, Td, Toolbar } from "@/components/ui";
import { formatDateTime, TRANSCRIPT_STATUS } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listMeetings } from "@/server/meetings/service";
import { importMeetAction } from "./actions";

export const metadata = { title: "Reuniones" };

function ImportMeetButton({ projectId, variant }: { projectId: string; variant?: "primary" | "secondary" }) {
  return (
    <ModalButton
      label="Traer de Google Meet"
      icon={<FileInput className="size-4" />}
      title="Traer la transcripción de una llamada"
      variant={variant ?? "secondary"}
    >
      <ActionForm action={importMeetAction.bind(null, projectId)} submitLabel="Traer" className="space-y-4">
        <Field
          label="Enlace de la llamada"
          hint="De los últimos 30 días, ya terminada y con la transcripción activada."
          tip="Se lee con las cuentas de Google conectadas con permiso de Meet: normalmente, la de quien organizó la llamada."
        >
          <Input name="url" required placeholder="https://meet.google.com/abc-defg-hij" />
        </Field>
        <Field label="Título" optional hint="Si lo dejas vacío, se usa el código de la llamada.">
          <Input name="title" />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

export default async function MeetingsPage({ params }: PageProps<"/app/projects/[projectId]/meetings">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const rows = await listMeetings(getDb(), tenant, { projectId });
  const canEdit = tenant.role !== "member";

  return (
    <>
      <Toolbar>{rows.length > 0 && canEdit ? <ImportMeetButton projectId={projectId} /> : null}</Toolbar>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Video />}
            title="Todavía no hay reuniones"
            description="Las que agenden los agentes aparecerán aquí; si son por Google Meet, con su transcripción, un resumen y los siguientes pasos al terminar."
            action={canEdit ? <ImportMeetButton projectId={projectId} variant="primary" /> : null}
          />
        ) : (
          <Table head={["Reunión", "Fecha", "Con", "Transcripción"]}>
            {rows.map((m) => {
              const status = TRANSCRIPT_STATUS[m.transcriptStatus];
              return (
                <tr key={m.id} className="group relative transition-colors hover:bg-background">
                  <Td>
                    <Link
                      href={`/app/projects/${projectId}/meetings/${m.id}`}
                      className="font-medium group-hover:text-accent after:absolute after:inset-0"
                    >
                      {m.title}
                    </Link>
                    {m.summary ? (
                      <div className="line-clamp-1 max-w-md text-xs text-muted">{m.summary}</div>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.startAt)}</Td>
                  <Td className="text-xs text-muted">
                    {m.attendees.map((a) => a.name ?? a.email).join(", ") || "—"}
                  </Td>
                  <Td>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
