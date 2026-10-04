import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { listGlobalSuppressions, listOrgConnections, listOrgIdentities } from "@/server/services/projects";
import { addGlobalSuppression, addTwenty, deleteGlobalSuppression, testConnection } from "./actions";

export const metadata = { title: "Conexiones" };

export default async function ConnectionsPage({ searchParams }: PageProps<"/app/connections">) {
  const tenant = await requireTenant();
  const db = getDb();
  const query = await searchParams;
  const [connections, identities, suppressions] = await Promise.all([
    listOrgConnections(db, tenant),
    listOrgIdentities(db, tenant),
    listGlobalSuppressions(db, tenant),
  ]);
  const googleEnabled = Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
  const appUrl = env().APP_URL;

  return (
    <>
      <PageHeader
        title="Conexiones"
        description="Herramientas de la organización. Después, en cada proyecto decides qué conexiones e identidades puede usar y con qué capacidades."
      />
      {query.connected ? (
        <p className="mb-4 text-sm text-success">Cuenta conectada: {String(query.connected)}</p>
      ) : null}
      {query.error ? <p className="mb-4 text-sm text-danger">Error: {String(query.error)}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Conexiones activas">
          {connections.length === 0 ? (
            <EmptyState>Todavía no hay conexiones.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {connections.map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.label}</span>
                    <Badge tone={c.status === "active" ? "success" : "danger"}>{c.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {c.provider} · lectura: {c.readScopes.join(", ") || "—"} · escritura:{" "}
                    {c.writeScopes.join(", ") || "—"} · {formatDateTime(c.createdAt)}
                  </div>
                  {c.lastError ? <div className="mt-1 text-xs text-danger">{c.lastError}</div> : null}
                  {c.provider === "twenty" ? (
                    <div className="mt-1 text-xs text-muted">
                      Webhook: <code>{`${appUrl}/api/webhooks/twenty/${c.id}`}</code>
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <ActionForm
                      action={testConnection.bind(null, c.id)}
                      submitLabel="Probar"
                      submitVariant="secondary"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card
            title="Google (Gmail y Calendar)"
            description="Conecta cada cuenta de Google que uses: su calendario cuenta para tu disponibilidad global aunque lo compartan varios proyectos."
          >
            {googleEnabled ? (
              <form action="/api/connections/google/start" method="get" className="space-y-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="_cal_read" defaultChecked disabled /> Ver disponibilidad del
                  calendario
                </label>
                <GoogleSets />
                <Button>Conectar cuenta de Google</Button>
              </form>
            ) : (
              <p className="text-sm text-muted">
                Configura <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> para conectar
                cuentas de Google.
              </p>
            )}
          </Card>

          <Card
            title="Twenty CRM"
            description="Cloud (https://api.twenty.com) o tu propia instancia. Crea la clave en Settings → APIs & Webhooks."
          >
            <ActionForm action={addTwenty} submitLabel="Conectar" className="space-y-3">
              <Field label="Nombre">
                <Input name="label" placeholder="CRM de mi empresa" required />
              </Field>
              <Field label="URL base">
                <Input name="baseUrl" type="url" defaultValue="https://api.twenty.com" required />
              </Field>
              <Field label="API key">
                <Input name="apiKey" type="password" required autoComplete="off" />
              </Field>
              <Field
                label="Secreto del webhook (opcional)"
                hint="Para recibir eventos del CRM (p. ej. nuevas oportunidades)."
              >
                <Input name="webhookSecret" type="password" autoComplete="off" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowWrite" /> Permitir escritura (crear contactos, tareas y
                notas)
              </label>
            </ActionForm>
          </Card>
        </div>

        <Card title="Identidades" description="Buzones y calendarios disponibles para asignar a proyectos.">
          {identities.length === 0 ? (
            <EmptyState>Se crean al conectar cuentas.</EmptyState>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {identities.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span>{i.address}</span>
                  <Badge>{i.kind}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Exclusiones globales"
          description="Nadie de la organización contactará con estos destinatarios desde ningún proyecto."
        >
          {suppressions.length > 0 ? (
            <ul className="mb-4 divide-y divide-border text-sm">
              {suppressions.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <span>
                    <Badge>{s.type}</Badge> {s.value}{" "}
                    {s.reason ? <span className="text-muted">· {s.reason}</span> : null}
                  </span>
                  <form action={deleteGlobalSuppression.bind(null, s.id)}>
                    <Button variant="ghost" className="text-danger">
                      Quitar
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={addGlobalSuppression} submitLabel="Añadir" className="space-y-3">
            <Field label="Tipo">
              <Select name="type" defaultValue="email">
                <option value="email">Email</option>
                <option value="domain">Dominio</option>
                <option value="phone">Teléfono</option>
              </Select>
            </Field>
            <Field label="Valores">
              <Input name="values" required />
            </Field>
            <Field label="Motivo">
              <Input name="reason" />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function GoogleSets() {
  return (
    <>
      <input type="hidden" name="sets" value="calendar_read" />
      <p className="text-xs text-muted">Permisos adicionales:</p>
      <Select name="sets" defaultValue="calendar_write,gmail_write">
        <option value="">Solo disponibilidad</option>
        <option value="calendar_write">+ Crear reuniones</option>
        <option value="calendar_write,gmail_write">+ Crear reuniones y enviar/borradores de email</option>
        <option value="calendar_write,gmail_write,gmail_read">
          + Lo anterior y leer el correo (para el agente inbound)
        </option>
      </Select>
    </>
  );
}
