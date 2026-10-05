import { CalendarDays, Mail, Phone, Plug, Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Avatar, Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { CAPABILITY_LABELS, getIntegration } from "@/lib/integrations";
import { requireTenant } from "@/server/auth/session";
import { connectionCapabilities } from "@/server/connectors/service";
import { getDb } from "@/server/db/client";
import { getProjectChannels } from "@/server/services/projects";
import { saveConnectionLink, saveIdentities } from "../actions";

const KIND = {
  email: { label: "Buzón", icon: Mail },
  calendar: { label: "Calendario", icon: CalendarDays },
  phone: { label: "Teléfono", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: Phone },
} as const;

function ConnectCta({ label }: { label: string }) {
  return (
    <LinkButton href="/app/connections/new" variant="primary">
      <Plus className="size-4" />
      {label}
    </LinkButton>
  );
}

export default async function ChannelsPage({ params }: PageProps<"/app/projects/[projectId]/channels">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const { identities, connections } = await getProjectChannels(getDb(), tenant, projectId);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title="Buzones y calendarios"
        description="Desde qué direcciones puede escribir y en qué calendarios puede agendar este proyecto. El sistema rechaza cualquier acción desde una dirección no marcada aquí."
      >
        {identities.length === 0 ? (
          <EmptyState
            compact
            icon={<Mail />}
            title="No hay buzones ni calendarios"
            description="Aparecen al conectar una cuenta de correo y calendario, como Google Workspace."
            action={<ConnectCta label="Conectar una cuenta" />}
          />
        ) : (
          <ActionForm action={saveIdentities.bind(null, projectId)} submitLabel="Guardar">
            <ul className="space-y-2 text-sm">
              {identities.map((i) => {
                const { label, icon: Icon } = KIND[i.kind];
                return (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-background"
                  >
                    <input type="hidden" name="all" value={i.id} />
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input type="checkbox" name="identity" value={i.id} defaultChecked={i.assigned} />
                      <Icon className="size-4 shrink-0 text-muted" />
                      <span className="truncate">{i.address}</span>
                      <span className="text-xs text-muted">{label}</span>
                    </label>
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                      <input type="checkbox" name="default" value={i.id} defaultChecked={i.isDefault} />
                      Por defecto
                    </label>
                  </li>
                );
              })}
            </ul>
          </ActionForm>
        )}
      </Card>

      <Card
        title="Herramientas"
        description="Qué puede hacer este proyecto con cada herramienta conectada. Si no marcas nada, la herramienta no se usa aquí."
      >
        {connections.length === 0 ? (
          <EmptyState
            compact
            icon={<Plug />}
            title="No hay herramientas conectadas"
            description="Conecta tu CRM, tu correo o tu calendario y elige aquí qué puede usar este proyecto."
            action={<ConnectCta label="Conectar una herramienta" />}
          />
        ) : (
          <div className="space-y-3">
            {connections.map((c) => {
              let available: string[] = [];
              try {
                available = connectionCapabilities(c);
              } catch {
                available = [];
              }
              const integration = getIntegration(c.provider);
              return (
                <div key={c.id} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center gap-3 text-sm">
                    <Avatar
                      label={integration?.name ?? c.provider}
                      color={integration?.color}
                      className="size-8"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.label}</span>
                      <span className="block truncate text-xs text-muted">{c.accountRef}</span>
                    </span>
                    {c.status !== "active" ? <Badge tone="danger">Con errores</Badge> : null}
                  </div>
                  <ActionForm
                    action={saveConnectionLink.bind(null, projectId, c.id)}
                    submitLabel="Guardar"
                    submitVariant="secondary"
                  >
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      {available.map((cap) => (
                        <label key={cap} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="capability"
                            value={cap}
                            defaultChecked={c.linkedCapabilities?.includes(cap) ?? false}
                          />
                          {CAPABILITY_LABELS[cap] ?? cap}
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
