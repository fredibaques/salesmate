import { BookMarked, ChevronRight, Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, Card, EmptyState, Field, Input, RowLink, Select } from "@/components/ui";
import { AGENT_LABELS, formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { SALES_MOTIONS } from "@/server/db/schema";
import { listPlaybooks } from "@/server/playbooks/service";
import { SALES_MOTION_LABELS } from "@/server/playbooks/spec";
import { newPlaybook } from "./actions";

const STATUS = {
  draft: { label: "Borrador", tone: "neutral" },
  active: { label: "Activo", tone: "success" },
  archived: { label: "Archivado", tone: "neutral" },
} as const;

function NewPlaybookButton({ projectId }: { projectId: string }) {
  return (
    <ModalButton
      label="Nuevo playbook"
      icon={<Plus className="size-4" />}
      title="Nuevo playbook"
      description="Empieza con la plantilla de tu modelo de venta. Después podrás ajustarla a mano o pedir a la IA un borrador a partir del conocimiento del proyecto."
    >
      <ActionForm
        action={newPlaybook.bind(null, projectId)}
        submitLabel="Crear playbook"
        className="space-y-4"
      >
        <Field label="Nombre">
          <Input name="name" required placeholder="p. ej. Leads de la web" />
        </Field>
        <Field label="Modelo de venta">
          <Select name="salesMotion" defaultValue="b2b_consultative">
            {SALES_MOTIONS.map((m) => (
              <option key={m} value={m}>
                {SALES_MOTION_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Agentes que lo usan">
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            {(["inbound", "outbound", "account_manager"] as const).map((a) => (
              <label key={a} className="flex items-center gap-1.5">
                <input type="checkbox" name="agentTypes" value={a} defaultChecked={a === "inbound"} />
                {AGENT_LABELS[a]}
              </label>
            ))}
          </div>
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

export default async function PlaybooksPage({ params }: PageProps<"/app/projects/[projectId]/playbooks">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const playbooks = await listPlaybooks(getDb(), tenant, projectId);

  return (
    <Card
      title="Playbooks"
      description="Cómo vende este proyecto: modelo de venta, siguiente paso, cualificación, objeciones y reglas. Los agentes siguen el playbook activo que les corresponde."
      actions={playbooks.length > 0 ? <NewPlaybookButton projectId={projectId} /> : null}
    >
      {playbooks.length === 0 ? (
        <EmptyState
          icon={<BookMarked />}
          title="Este proyecto todavía no tiene playbook"
          description="El playbook es lo que convierte tu forma de vender en instrucciones para los agentes. Sin uno activo, el agente inbound no responde a los leads."
          action={<NewPlaybookButton projectId={projectId} />}
        />
      ) : (
        <ul className="divide-y divide-border">
          {playbooks.map((p) => (
            <li key={p.id}>
              <RowLink href={`/app/projects/${projectId}/playbooks/${p.id}`} className="group text-sm">
                <span className="min-w-0">
                  <span className="block font-medium group-hover:text-accent">{p.name}</span>
                  <span className="text-xs text-muted">
                    v{p.currentVersion} · {formatDateTime(p.updatedAt)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge>{SALES_MOTION_LABELS[p.salesMotion]}</Badge>
                  {p.agentTypes.map((a) => (
                    <Badge key={a} tone="accent">
                      {AGENT_LABELS[a] ?? a}
                    </Badge>
                  ))}
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                  <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </span>
              </RowLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
