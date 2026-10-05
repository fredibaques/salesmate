import { CalendarDays, Mail, Phone, Plug, Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Avatar, Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { describeScopes, getIntegration } from "@/lib/integrations";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { listOrgConnections, listOrgIdentities } from "@/server/services/projects";
import { testConnection } from "./actions";

export const metadata = { title: "Conexiones" };

const IDENTITY = {
  email: { label: "Buzón", icon: Mail },
  calendar: { label: "Calendario", icon: CalendarDays },
  phone: { label: "Teléfono", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: Phone },
} as const;

const STATUS = {
  active: { label: "Conectada", tone: "success" },
  error: { label: "Con errores", tone: "danger" },
  revoked: { label: "Revocada", tone: "danger" },
} as const;

const ERRORS: Record<string, string> = {
  google_not_configured:
    "Google no está configurado en el servidor (faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).",
  access_denied: "Has cancelado el permiso en Google.",
};

export default async function ConnectionsPage({ searchParams }: PageProps<"/app/connections">) {
  const tenant = await requireTenant();
  const db = getDb();
  const query = await searchParams;
  const [connections, identities] = await Promise.all([
    listOrgConnections(db, tenant),
    listOrgIdentities(db, tenant),
  ]);
  const appUrl = env().APP_URL;

  return (
    <>
      <PageHeader
        title="Conexiones"
        description="Las herramientas de tu organización que pueden usar los agentes. Después, en cada proyecto eliges cuáles usa y qué puede hacer con ellas."
        actions={
          connections.length > 0 ? (
            <LinkButton href="/app/connections/new" variant="primary">
              <Plus className="size-4" />
              Añadir conexión
            </LinkButton>
          ) : null
        }
      />

      {query.connected ? (
        <p className="mb-6 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          Conectado: {String(query.connected)}
        </p>
      ) : null}
      {query.error ? (
        <p className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          No se ha podido conectar: {ERRORS[String(query.error)] ?? String(query.error)}
        </p>
      ) : null}

      {connections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Plug />}
            title="Todavía no has conectado ninguna herramienta"
            description="Conecta tu CRM, tu correo y tu calendario para que los agentes puedan consultar tu información y actuar por ti, siempre con tu aprobación."
            action={
              <LinkButton href="/app/connections/new" variant="primary">
                <Plus className="size-4" />
                Conectar una herramienta
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {connections.map((c) => {
            const integration = getIntegration(c.provider);
            const own = identities.filter((i) => i.connectionId === c.id);
            const scopes = describeScopes(c.readScopes, c.writeScopes);
            return (
              <Card key={c.id}>
                <div className="flex items-start gap-3">
                  <Avatar label={integration?.name ?? c.provider} color={integration?.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{c.label}</span>
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                    </div>
                    <p className="truncate text-sm text-muted">
                      {integration?.name ?? c.provider} · {c.accountRef}
                    </p>
                  </div>
                </div>

                {scopes.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">Permisos</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {scopes.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {own.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">
                      Buzones y calendarios
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {own.map((i) => {
                        const { label, icon: Icon } = IDENTITY[i.kind];
                        return (
                          <li key={i.id} className="flex items-center gap-2">
                            <Icon className="size-4 text-muted" />
                            <span className="truncate">{i.address}</span>
                            <span className="text-xs text-muted">{label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {c.provider === "twenty" ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">Webhook</p>
                    <code className="mt-1 block text-xs break-all text-muted">{`${appUrl}/api/webhooks/twenty/${c.id}`}</code>
                  </div>
                ) : null}

                {c.lastError ? <p className="mt-3 text-xs text-danger">{c.lastError}</p> : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <span className="text-xs text-muted">Conectada el {formatDateTime(c.createdAt)}</span>
                  <ActionForm
                    action={testConnection.bind(null, c.id)}
                    submitLabel="Probar conexión"
                    submitVariant="secondary"
                    className="flex flex-wrap items-center gap-3"
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
