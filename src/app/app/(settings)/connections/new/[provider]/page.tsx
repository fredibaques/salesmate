import { Check } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Avatar, Button, Card, Choice, Field, Input, PageHeader } from "@/components/ui";
import { getIntegration } from "@/lib/integrations";
import { requireTenant } from "@/server/auth/session";
import { env } from "@/server/env";
import { addMcp, addTwenty } from "../../actions";

export async function generateMetadata({ params }: PageProps<"/app/connections/new/[provider]">) {
  const { provider } = await params;
  return { title: `Conectar ${getIntegration(provider)?.name ?? "herramienta"}` };
}

const GOOGLE_PERMISSIONS = [
  {
    value: "",
    title: "Solo disponibilidad",
    description: "Ver cuándo estás ocupado. No crea reuniones ni toca el correo.",
  },
  {
    value: "calendar_write",
    title: "Agenda reuniones",
    description: "Lo anterior y crear reuniones con invitación.",
  },
  {
    value: "calendar_write,gmail_write",
    title: "Agenda y escribe emails",
    description: "Lo anterior y preparar borradores y enviar emails desde este buzón.",
  },
  {
    value: "calendar_write,gmail_write,gmail_read",
    title: "Completo (recomendado para el agente inbound)",
    description: "Lo anterior y leer los emails que llegan para responder leads.",
    recommended: true,
  },
] as const;

export default async function ConnectProviderPage({ params }: PageProps<"/app/connections/new/[provider]">) {
  await requireTenant();
  const { provider } = await params;
  const integration = getIntegration(provider);
  if (!integration || integration.status !== "available") notFound();
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = env();

  return (
    <>
      <PageHeader
        level="section"
        back={{ href: "/app/connections/new", label: "Todas las herramientas" }}
        media={<Avatar label={integration.name} color={integration.color} className="size-11 text-lg" />}
        title={`Conectar ${integration.name}`}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_2fr]">
        <Card title="Qué podrán hacer los agentes">
          <ul className="space-y-2 text-sm">
            {integration.abilities?.map((a) => (
              <li key={a} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
                {a}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Conectar una herramienta no da acceso a ningún proyecto por sí solo: en cada proyecto eliges qué
            puede usar, y todo lo que salga hacia fuera pasa por tu aprobación según las reglas del proyecto.
          </p>
        </Card>

        {provider === "google" ? (
          GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? (
            <Card
              title="Permisos"
              tip="Te llevaremos a Google para que elijas la cuenta y aceptes. Conecta una vez cada cuenta que uses: su calendario cuenta para tu disponibilidad aunque lo compartan varios proyectos."
            >
              <form action="/api/connections/google/start" method="get" className="space-y-3">
                <input type="hidden" name="sets" value="calendar_read" />
                {GOOGLE_PERMISSIONS.map((p) => (
                  <Choice
                    key={p.value}
                    card
                    type="radio"
                    name="sets"
                    value={p.value}
                    defaultChecked={"recommended" in p}
                    label={p.title}
                    description={p.description}
                  />
                ))}
                <div className="pt-2">
                  <Button>Continuar con Google</Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card title="Falta configurar Google">
              <p className="text-sm text-muted">
                Para conectar cuentas de Google hay que añadir <code>GOOGLE_CLIENT_ID</code> y{" "}
                <code>GOOGLE_CLIENT_SECRET</code> en las variables de entorno del servidor, con esta dirección
                de vuelta autorizada en Google Cloud:
              </p>
              <code className="mt-3 block rounded-lg bg-background p-3 text-xs break-all">
                {`${APP_URL}/api/connections/google/callback`}
              </code>
            </Card>
          )
        ) : null}

        {provider === "mcp" ? (
          <Card
            title="Datos del servidor"
            tip="La dirección del servidor MCP (transporte HTTP) y, si lo pide, su token de acceso. Comprobaremos que responde y leeremos qué herramientas ofrece."
          >
            <ActionForm action={addMcp} submitLabel="Conectar servidor" className="space-y-4">
              <Field label="Nombre" hint="Para reconocerlo en los agentes, p. ej. «Directorio de empresas».">
                <Input name="label" placeholder="Mi herramienta" required />
              </Field>
              <Field label="URL del servidor MCP" hint="Suele acabar en /mcp.">
                <Input name="url" type="url" placeholder="https://…/mcp" required />
              </Field>
              <Field
                label="Token"
                optional
                hint="Se envía como «Authorization: Bearer …». Se guarda cifrado."
              >
                <Input name="token" type="password" autoComplete="off" />
              </Field>
            </ActionForm>
          </Card>
        ) : null}

        {provider === "twenty" ? (
          <Card
            title="Datos de acceso"
            tip="Funciona con Twenty en la nube (https://api.twenty.com) o en tu propio servidor. Crea la clave en Twenty → Settings → APIs & Webhooks."
          >
            <ActionForm action={addTwenty} submitLabel="Conectar Twenty" className="space-y-4">
              <Field label="Nombre" hint="Para reconocerla, p. ej. «CRM de Protectio».">
                <Input name="label" placeholder="CRM de mi empresa" required />
              </Field>
              <Field label="URL base">
                <Input name="baseUrl" type="url" defaultValue="https://api.twenty.com" required />
              </Field>
              <Field label="API key">
                <Input name="apiKey" type="password" required autoComplete="off" />
              </Field>
              <Field
                label="Secreto del webhook"
                optional
                tip="Para recibir avisos del CRM, p. ej. nuevas oportunidades. Lo creas en Twenty al dar de alta el webhook."
              >
                <Input name="webhookSecret" type="password" autoComplete="off" />
              </Field>
              <Choice
                name="allowWrite"
                label="Permitir escritura"
                description="Crear contactos, tareas y notas en el CRM."
              />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
