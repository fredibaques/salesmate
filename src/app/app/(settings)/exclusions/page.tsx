import { Plus, ShieldBan, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { SUPPRESSION_TYPE_LABELS, SuppressionFields } from "@/components/suppression-fields";
import { Badge, Button, Card, EmptyState, Toolbar } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listGlobalSuppressions } from "@/server/services/projects";
import { addGlobalSuppression, deleteGlobalSuppression } from "./actions";

export const metadata = { title: "Exclusiones" };

function AddExclusion({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  return (
    <ModalButton
      label="Añadir exclusión"
      icon={<Plus className="size-4" />}
      title="Añadir exclusión"
      variant={variant}
    >
      <ActionForm action={addGlobalSuppression} submitLabel="Añadir" className="space-y-4">
        <SuppressionFields />
      </ActionForm>
    </ModalButton>
  );
}

export default async function ExclusionsPage() {
  const tenant = await requireTenant();
  const suppressions = await listGlobalSuppressions(getDb(), tenant);

  return (
    <>
      <Toolbar>{suppressions.length > 0 ? <AddExclusion /> : null}</Toolbar>
      <Card>
        {suppressions.length === 0 ? (
          <EmptyState
            icon={<ShieldBan />}
            title="No hay exclusiones globales"
            description="Añade aquí a quien no debe recibir nada de ninguno de tus proyectos. El sistema bloquea cualquier acción dirigida a ellos."
            action={<AddExclusion />}
          />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {suppressions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge>{SUPPRESSION_TYPE_LABELS[s.type]}</Badge>
                  <span className="font-medium">{s.value}</span>
                  {s.reason ? <span className="text-muted">· {s.reason}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-xs text-muted sm:inline">{formatDateTime(s.createdAt)}</span>
                  <form action={deleteGlobalSuppression.bind(null, s.id)}>
                    <Button variant="dangerGhost" size="sm" iconOnly aria-label={`Quitar ${s.value}`}>
                      <Trash2 className="size-4" />
                      Quitar
                    </Button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
