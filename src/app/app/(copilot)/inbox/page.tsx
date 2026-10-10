import { FlaskConical, Inbox } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { AGENT_INFO, agentName, type ProjectAgentKey } from "@/lib/agents";
import { AGENT_LABELS, AUTONOMY_LABELS, formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActionDefinition } from "@/server/gateway/definitions";
import { listActions, listOrgIdentities, listProjects } from "@/server/services/projects";
import { approve, reject, simulateAgentProposal } from "./actions";
import { INBOX_TIP } from "../tips";

export const metadata = { title: "Por aprobar" };

type Row = Awaited<ReturnType<typeof listActions>>[number];

function PolicyNotes({ row }: { row: Row }) {
  const notes = row.action.policyResults.filter((p) => p.outcome !== "allow");
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {notes.map((p, i) => (
        <li key={i} className={p.outcome === "block" ? "text-danger" : "text-warning"}>
          {p.outcome === "block" ? "⛔" : p.outcome === "defer" ? "⏱" : "✋"} {p.reason}
        </li>
      ))}
    </ul>
  );
}

function PendingAction({ row }: { row: Row }) {
  const { action } = row;
  const def = getActionDefinition(action.type);
  const isEmail = action.type === "email.send" || action.type === "email.create_draft";
  const p = action.payload as Record<string, unknown>;
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{def?.summary(action.payload) ?? action.type}</span>
        <span className="flex flex-wrap gap-2">
          <Badge>{row.projectName}</Badge>
          {action.agentType ? (
            <Badge tone="accent">
              {action.agentType in AGENT_INFO
                ? agentName(action.agentType as ProjectAgentKey, row.agentName)
                : AGENT_LABELS[action.agentType]}
            </Badge>
          ) : null}
          <Badge>{AUTONOMY_LABELS[action.autonomyLevel]}</Badge>
        </span>
      </div>
      <div className="mt-1 text-xs text-muted">
        {formatDateTime(action.createdAt)}
        {action.reason ? ` · ${action.reason}` : ""}
      </div>
      <PolicyNotes row={row} />
      {action.citations.length > 0 ? (
        <div className="mt-2 text-xs text-muted">
          Fuentes citadas: {action.citations.map((c) => c.ref).join(", ")}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ActionForm
          action={approve.bind(null, action.id, action.type, action.payload)}
          submitLabel="Aprobar"
          className="space-y-3"
        >
          {isEmail ? (
            <>
              <Field label="Para">
                <Input name="to" defaultValue={(p.to as string[]).join(", ")} />
              </Field>
              <Field label="Asunto">
                <Input name="subject" defaultValue={String(p.subject ?? "")} />
              </Field>
              <Field label="Mensaje">
                <Textarea name="body" defaultValue={String(p.body ?? "")} className="min-h-40" />
              </Field>
            </>
          ) : (
            <Field label="Contenido (JSON)">
              <Textarea
                name="payload"
                defaultValue={JSON.stringify(action.payload, null, 2)}
                className="min-h-32 font-mono text-xs"
              />
            </Field>
          )}
          <Field label="Nota" optional>
            <Input name="reason" placeholder="Por qué lo apruebas o qué has cambiado" />
          </Field>
        </ActionForm>
        <ActionForm
          action={reject.bind(null, action.id)}
          submitLabel="Rechazar"
          submitVariant="danger"
          className="space-y-3"
        >
          <Field label="Motivo del rechazo" hint="Servirá para que el agente aprenda.">
            <Textarea name="reason" required />
          </Field>
        </ActionForm>
      </div>
    </li>
  );
}

export default async function InboxPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [pending, projects, identities] = await Promise.all([
    listActions(db, tenant, { statuses: ["pending_approval"] }),
    listProjects(db, tenant),
    listOrgIdentities(db, tenant),
  ]);
  const emailIdentity = identities.find((i) => i.kind === "email");

  return (
    <>
      <PageHeader
        title="Por aprobar"
        tip={INBOX_TIP}
        actions={
          projects.length > 0 ? (
            <ModalButton
              label="Probar el flujo de aprobación"
              icon={<FlaskConical className="size-4" />}
              title="Probar el flujo de aprobación"
              variant="secondary"
              width="lg"
            >
              <SimulateProposal projects={projects} emailIdentityId={emailIdentity?.id} />
            </ModalButton>
          ) : undefined
        }
      />

      <section>
        {pending.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox />}
              title="Nada pendiente de aprobación"
              description="Cuando un agente prepare un email, una reunión o un cambio en el CRM que necesite tu visto bueno, lo verás aquí para revisarlo, editarlo y aprobarlo o rechazarlo."
            />
          </Card>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => (
              <PendingAction key={row.action.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function SimulateProposal({
  projects,
  emailIdentityId,
}: {
  projects: { id: string; name: string }[];
  emailIdentityId?: string;
}) {
  return (
    <ActionForm action={simulateAgentProposal} submitLabel="Proponer" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Proyecto">
          <Select name="projectId" required>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Agente">
          <Select name="agentType" defaultValue="outbound">
            {Object.entries(AGENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Destinatario">
          <Select name="customerType" defaultValue="">
            <option value="">Sin indicar</option>
            <option value="b2b">Empresa (B2B)</option>
            <option value="b2c">Particular (B2C)</option>
          </Select>
        </Field>
      </div>
      <Field label="Acción">
        <Select name="type" defaultValue="email.create_draft">
          <option value="email.create_draft">Crear borrador de email</option>
          <option value="email.send">Enviar email</option>
          <option value="crm.create_task">Crear tarea en el CRM</option>
          <option value="crm.log_note">Registrar nota en el CRM</option>
          <option value="crm.upsert_contact">Crear/actualizar contacto</option>
          <option value="calendar.book">Reservar reunión</option>
        </Select>
      </Field>
      <Field
        label="Contenido (JSON)"
        tip="Para emails y reuniones, identityId es el buzón/calendario asignado al proyecto."
      >
        <Textarea
          name="payload"
          className="min-h-40 font-mono text-xs"
          defaultValue={JSON.stringify(
            {
              identityId: emailIdentityId ?? "<id del buzón>",
              to: ["cliente@example.com"],
              subject: "Seguimiento de nuestra conversación",
              body: "Hola,\n\nTe escribo para…",
            },
            null,
            2,
          )}
        />
      </Field>
    </ActionForm>
  );
}
