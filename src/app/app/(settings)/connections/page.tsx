import { CalendarDays, Mail, Phone, Plug } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Avatar, Badge, CardGrid, EmptyState, EntityCard, Notice, Toolbar } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { describeScopes, getIntegration } from "@/lib/integrations";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { listOrgConnections, listOrgIdentities } from "@/server/services/projects";
import { mcpToolsOf } from "@/server/connectors/mcp";
import { testConnection } from "./actions";
import { AddConnectionButton } from "./add-connection";

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
  const setup = {
    googleReady: Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET),
    appUrl,
    // ?add=1 opens the modal, ?add=<tool> straight on that tool.
    initial: typeof query.add === "string" ? query.add : null,
  };

  return (
    <>
      <Toolbar>{connections.length > 0 ? <AddConnectionButton {...setup} /> : null}</Toolbar>

      {query.connected || query.error ? (
        <div className="mb-6">
          {query.connected ? (
            <Notice tone="success">Conectado: {String(query.connected)}</Notice>
          ) : (
            <Notice tone="danger">
              No se ha podido conectar: {ERRORS[String(query.error)] ?? String(query.error)}
            </Notice>
          )}
        </div>
      ) : null}

      {connections.length === 0 ? (
        <EmptyState
          icon={<Plug />}
          title="Todavía no has conectado ninguna herramienta"
          description="Conecta tu CRM, tu correo y tu calendario para que los agentes puedan consultar tu información y actuar por ti, siempre con tu aprobación."
          action={<AddConnectionButton label="Conectar una herramienta" {...setup} />}
        />
      ) : (
        <CardGrid className="xl:grid-cols-2">
          {connections.map((c) => {
            const integration = getIntegration(c.provider);
            const own = identities.filter((i) => i.connectionId === c.id);
            const scopes = describeScopes(c.readScopes, c.writeScopes);
            return (
              <EntityCard
                key={c.id}
                media={<Avatar label={integration?.name ?? c.provider} color={integration?.color} />}
                title={c.label}
                meta={`${integration?.name ?? c.provider} · ${c.accountRef}`}
                badge={<Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}
                footer={
                  <>
                    <span className="text-xs text-muted">Conectada el {formatDateTime(c.createdAt)}</span>
                    <ActionForm
                      action={testConnection.bind(null, c.id)}
                      submitLabel="Probar conexión"
                      submitVariant="secondary"
                      className="flex flex-wrap items-center gap-3"
                    />
                  </>
                }
              >
                {scopes.length > 0 ? (
                  <div>
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

                {c.provider === "mcp" ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">
                      Herramientas ({mcpToolsOf(c).length})
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {mcpToolsOf(c).map((t) => (
                        <li key={t.name} className="flex flex-wrap items-center gap-2">
                          <code className="text-xs">{t.name}</code>
                          {t.readOnly ? (
                            <Badge>Solo lectura</Badge>
                          ) : (
                            <Badge tone="warning">Modifica datos</Badge>
                          )}
                        </li>
                      ))}
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
              </EntityCard>
            );
          })}
        </CardGrid>
      )}
    </>
  );
}
