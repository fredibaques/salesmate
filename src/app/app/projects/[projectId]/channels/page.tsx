import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { connectionCapabilities } from "@/server/connectors/service";
import { getDb } from "@/server/db/client";
import { getProjectChannels } from "@/server/services/projects";
import { saveConnectionLink, saveIdentities } from "../actions";

const KIND_LABEL = {
  email: "Buzón",
  calendar: "Calendario",
  phone: "Teléfono",
  whatsapp: "WhatsApp",
} as const;

export default async function ChannelsPage({ params }: PageProps<"/app/projects/[projectId]/channels">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const { identities, connections } = await getProjectChannels(getDb(), tenant, projectId);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title="Identidades"
        description="Buzones y calendarios desde los que este proyecto puede actuar. El sistema rechaza cualquier acción con una identidad no asignada."
      >
        {identities.length === 0 ? (
          <EmptyState>
            No hay identidades.{" "}
            <Link href="/app/connections" className="text-accent">
              Conecta una cuenta
            </Link>
            .
          </EmptyState>
        ) : (
          <ActionForm action={saveIdentities.bind(null, projectId)} submitLabel="Guardar identidades">
            <ul className="divide-y divide-border text-sm">
              {identities.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <input type="hidden" name="all" value={i.id} />
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="identity" value={i.id} defaultChecked={i.assigned} />
                    <Badge>{KIND_LABEL[i.kind]}</Badge>
                    <span>{i.address}</span>
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" name="default" value={i.id} defaultChecked={i.isDefault} />
                    por defecto
                  </label>
                </li>
              ))}
            </ul>
          </ActionForm>
        )}
      </Card>

      <Card
        title="Herramientas"
        description="Qué puede hacer este proyecto con cada conexión. Sin ninguna capacidad marcada, la conexión no se usa aquí."
      >
        {connections.length === 0 ? (
          <EmptyState>
            No hay conexiones.{" "}
            <Link href="/app/connections" className="text-accent">
              Añade una
            </Link>
            .
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {connections.map((c) => {
              let available: string[] = [];
              try {
                available = connectionCapabilities(c);
              } catch {
                available = [];
              }
              return (
                <div key={c.id} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">{c.label}</span>
                    <Badge tone={c.status === "active" ? "success" : "danger"}>{c.status}</Badge>
                  </div>
                  <ActionForm
                    action={saveConnectionLink.bind(null, projectId, c.id)}
                    submitLabel="Guardar"
                    submitVariant="secondary"
                  >
                    <div className="flex flex-wrap gap-3 text-sm">
                      {available.map((cap) => (
                        <label key={cap} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            name="capability"
                            value={cap}
                            defaultChecked={c.linkedCapabilities?.includes(cap) ?? false}
                          />
                          <code className="text-xs">{cap}</code>
                        </label>
                      ))}
                    </div>
                  </ActionForm>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
