import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, Input, Select } from "@/components/ui";
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

export default async function PlaybooksPage({ params }: PageProps<"/app/projects/[projectId]/playbooks">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const playbooks = await listPlaybooks(getDb(), tenant, projectId);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card
        title="Playbooks"
        description="Cómo vende este proyecto: modelo de venta, siguiente paso, cualificación, objeciones y reglas. Los agentes siguen el playbook activo que les corresponde."
      >
        {playbooks.length === 0 ? (
          <EmptyState>Crea el primero a partir de una plantilla.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {playbooks.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <Link
                  href={`/app/projects/${projectId}/playbooks/${p.id}`}
                  className="font-medium hover:text-accent"
                >
                  {p.name}
                </Link>
                <span className="flex flex-wrap gap-2">
                  <Badge>{SALES_MOTION_LABELS[p.salesMotion]}</Badge>
                  {p.agentTypes.map((a) => (
                    <Badge key={a} tone="accent">
                      {AGENT_LABELS[a] ?? a}
                    </Badge>
                  ))}
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                  <span className="text-xs text-muted">
                    v{p.currentVersion} · {formatDateTime(p.updatedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Nuevo playbook" description="Empieza con la plantilla de tu modelo de venta y ajústala.">
        <ActionForm action={newPlaybook.bind(null, projectId)} submitLabel="Crear" className="space-y-3">
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
            <div className="flex flex-wrap gap-3 text-sm">
              {(["inbound", "outbound", "account_manager"] as const).map((a) => (
                <label key={a} className="flex items-center gap-1">
                  <input type="checkbox" name="agentTypes" value={a} defaultChecked={a === "inbound"} />{" "}
                  {AGENT_LABELS[a]}
                </label>
              ))}
            </div>
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
