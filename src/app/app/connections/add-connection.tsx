"use client";

import { ArrowLeft, Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { IntegrationLogo } from "@/components/integration-logo";
import { ModalButton } from "@/components/modal";
import { Badge, Button, Choice, cx, Field, Input, Notice } from "@/components/ui";
import {
  getIntegration,
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  type Integration,
  type IntegrationCategory,
} from "@/lib/integrations";
import { addDataSource, addMcp, addSlack, addTwenty, addWhatsapp, addWorkspace } from "./actions";

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

type Setup = { googleReady: boolean; appUrl: string };

/** Google tools that are a permission of the Google Workspace connection. */
const GOOGLE_EXTRAS: Record<string, { sets: string; note: string }> = {
  google_meet: {
    sets: "calendar_read,calendar_write,meet_read",
    note: "Google Meet va con tu cuenta de Google: te pediremos permiso para crear reuniones en tu calendario y leer las transcripciones de tus llamadas. Las que agende el agente sin un lugar llevarán su enlace de Meet.",
  },
  google_docs: {
    sets: "calendar_read,docs_read",
    note: "Te pediremos permiso para leer tus documentos de Google Docs. Solo se leen los que importes al conocimiento de un proyecto.",
  },
  google_sheets: {
    sets: "calendar_read,sheets",
    note: "Te pediremos permiso para leer y crear hojas de cálculo: para importar una hoja al conocimiento y para exportar tablas a una hoja nueva.",
  },
};

/** The tools that can be connected, by category, as tiles. */
function ToolGrid({ onPick }: { onPick: (id: string) => void }) {
  const categories = Object.keys(INTEGRATION_CATEGORIES) as IntegrationCategory[];
  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <section key={category}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
            {INTEGRATION_CATEGORIES[category]}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {INTEGRATIONS.filter((i) => i.category === category).map((i) => {
              const available = i.status === "available";
              return (
                <button
                  key={i.id}
                  type="button"
                  disabled={!available}
                  onClick={() => onPick(i.id)}
                  className={cx(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                    available
                      ? "border-border bg-surface hover:border-border-strong hover:bg-background"
                      : "cursor-not-allowed border-dashed border-border opacity-60",
                  )}
                >
                  <IntegrationLogo id={i.id} name={i.name} color={i.color} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {i.name}
                      {available ? null : <Badge>Próximamente</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{i.tagline}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** What the agents can do with the tool, and the form that connects it. */
function ToolSetup({ integration, setup }: { integration: Integration; setup: Setup }) {
  const provider = integration.id;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <IntegrationLogo id={integration.id} name={integration.name} color={integration.color} />
        <div className="min-w-0">
          <p className="font-semibold">{integration.name}</p>
          <p className="text-xs text-muted">{integration.tagline}</p>
        </div>
      </div>
      {integration.abilities?.length ? (
        <ul className="space-y-1.5 text-sm">
          {integration.abilities.map((a) => (
            <li key={a} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="border-t border-border pt-5">
        {GOOGLE_EXTRAS[provider] ? (
          setup.googleReady ? (
            <form action="/api/connections/google/start" method="get" className="space-y-4">
              <input type="hidden" name="sets" value={GOOGLE_EXTRAS[provider].sets} />
              <Notice>{GOOGLE_EXTRAS[provider].note}</Notice>
              <div className="flex justify-end">
                <Button>Continuar con Google</Button>
              </div>
            </form>
          ) : (
            <Notice tone="warning">
              Primero hay que configurar Google en el servidor (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).
            </Notice>
          )
        ) : null}

        {provider === "airtable" || provider === "trello" || provider === "monday" ? (
          <ActionForm
            action={addWorkspace.bind(null, provider)}
            submitLabel={`Conectar ${integration.name}`}
            className="space-y-4"
          >
            <Field label="Nombre" hint="Para reconocerla en los agentes y al exportar.">
              <Input name="label" defaultValue={integration.name} required />
            </Field>
            {provider === "trello" ? (
              <Field
                label="API key"
                tip="En trello.com/power-ups/admin crea un Power-Up (o usa uno tuyo) y copia su API key."
              >
                <Input name="key" required autoComplete="off" />
              </Field>
            ) : null}
            <Field
              label={
                provider === "airtable"
                  ? "Token personal"
                  : provider === "trello"
                    ? "Token"
                    : "Token de la API"
              }
              hint="Comprobaremos que funciona antes de guardarlo. Se guarda cifrado."
              tip={
                provider === "airtable"
                  ? "airtable.com/create/tokens: permisos data.records:write, schema.bases:read y schema.bases:write, y acceso a las bases donde exportar."
                  : provider === "trello"
                    ? "Junto a la API key, pulsa «Token» para autorizarla con tu cuenta de Trello."
                    : "En monday.com: tu avatar → Developers → My access tokens."
              }
            >
              <Input name="token" type="password" required autoComplete="off" />
            </Field>
          </ActionForm>
        ) : null}

        {provider === "google" ? (
          setup.googleReady ? (
            <form action="/api/connections/google/start" method="get" className="space-y-3">
              <input type="hidden" name="sets" value="calendar_read" />
              <Field
                label="Permisos"
                group
                tip="Te llevaremos a Google para que elijas la cuenta y aceptes. Conecta una vez cada cuenta que uses."
              >
                <div className="space-y-2">
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
                </div>
              </Field>
              <div className="flex justify-end pt-2">
                <Button>Continuar con Google</Button>
              </div>
            </form>
          ) : (
            <Notice tone="warning">
              Para conectar cuentas de Google hay que añadir <code>GOOGLE_CLIENT_ID</code> y{" "}
              <code>GOOGLE_CLIENT_SECRET</code> en el servidor, con esta dirección de vuelta autorizada:{" "}
              <code className="break-all">{`${setup.appUrl}/api/connections/google/callback`}</code>
            </Notice>
          )
        ) : null}

        {provider === "mcp" ? (
          <ActionForm action={addMcp} submitLabel="Conectar servidor" className="space-y-4">
            <Field label="Nombre" hint="Para reconocerlo en los agentes, p. ej. «Directorio de empresas».">
              <Input name="label" placeholder="Mi herramienta" required />
            </Field>
            <Field
              label="URL del servidor MCP"
              hint="Suele acabar en /mcp."
              tip="La dirección del servidor MCP (transporte HTTP). Comprobaremos que responde y leeremos qué herramientas ofrece."
            >
              <Input name="url" type="url" placeholder="https://…/mcp" required />
            </Field>
            <Field label="Token" optional hint="Se envía como «Authorization: Bearer …». Se guarda cifrado.">
              <Input name="token" type="password" autoComplete="off" />
            </Field>
          </ActionForm>
        ) : null}

        {provider === "apollo" || provider === "lusha" || provider === "hunter" ? (
          <ActionForm
            action={addDataSource.bind(null, provider)}
            submitLabel={`Conectar ${integration.name}`}
            className="space-y-4"
          >
            <Field label="Nombre" hint="Para reconocerla en los agentes.">
              <Input name="label" defaultValue={integration.name} required />
            </Field>
            <Field
              label="API key"
              hint="Comprobaremos que funciona antes de guardarla. Se guarda cifrada."
              tip={
                provider === "hunter"
                  ? "La encuentras en Hunter → API (hunter.io/api-keys)."
                  : provider === "apollo"
                    ? "Créala en Apollo → Settings → Integrations → API → API Keys. Si quieres que busque personas, dale acceso a todas las funciones o créala como master key."
                    : "La encuentras en Lusha → API (dashboard.lusha.com). El acceso a la API depende de tu plan de Lusha."
              }
            >
              <Input name="apiKey" type="password" required autoComplete="off" />
            </Field>
          </ActionForm>
        ) : null}

        {provider === "whatsapp" ? (
          <ActionForm action={addWhatsapp} submitLabel="Conectar WhatsApp" className="space-y-4">
            <Field label="Nombre" hint="Para reconocerlo, p. ej. «WhatsApp ventas».">
              <Input name="label" defaultValue="WhatsApp" required />
            </Field>
            <Field
              label="Identificador del número de teléfono"
              tip="En Meta for Developers → tu app → WhatsApp → Configuración de la API: «Phone number ID» (solo cifras)."
            >
              <Input name="phoneNumberId" inputMode="numeric" required autoComplete="off" />
            </Field>
            <Field
              label="Token de acceso permanente"
              hint="Se guarda cifrado."
              tip="Créalo con un usuario del sistema en Meta Business Suite → Configuración del negocio → Usuarios del sistema, con permisos whatsapp_business_messaging y whatsapp_business_management."
            >
              <Input name="accessToken" type="password" required autoComplete="off" />
            </Field>
            <Field
              label="Secreto de la app"
              hint="Para comprobar que los mensajes vienen de Meta. Se guarda cifrado."
              tip="Meta for Developers → tu app → Configuración de la app → Básica → «App secret»."
            >
              <Input name="appSecret" type="password" required autoComplete="off" />
            </Field>
            <Field
              label="Identificador de la cuenta de WhatsApp Business"
              optional
              hint="Para escribir con tus plantillas cuando han pasado 24 horas."
              tip="En Meta for Developers → tu app → WhatsApp → Configuración de la API: «WhatsApp Business Account ID» (solo cifras)."
            >
              <Input name="businessAccountId" inputMode="numeric" autoComplete="off" />
            </Field>
          </ActionForm>
        ) : null}

        {provider === "slack" ? (
          <ActionForm action={addSlack} submitLabel="Conectar Slack" className="space-y-4">
            <Field label="Nombre" hint="Para reconocerlo en los agentes, p. ej. «#ventas».">
              <Input name="label" placeholder="#ventas" required />
            </Field>
            <Field
              label="URL del webhook"
              hint="Se guarda cifrada."
              tip="En Slack: Apps → Incoming Webhooks → Add to Slack, elige el canal y copia la URL (https://hooks.slack.com/services/…)."
            >
              <Input
                name="webhookUrl"
                type="url"
                required
                autoComplete="off"
                placeholder="https://hooks.slack.com/services/…"
              />
            </Field>
          </ActionForm>
        ) : null}

        {provider === "twenty" ? (
          <ActionForm action={addTwenty} submitLabel="Conectar Twenty" className="space-y-4">
            <Field label="Nombre" hint="Para reconocerla, p. ej. «CRM de Protectio».">
              <Input name="label" placeholder="CRM de mi empresa" required />
            </Field>
            <Field
              label="URL base"
              tip="Twenty en la nube (https://api.twenty.com) o tu propio servidor. Crea la clave en Twenty → Settings → APIs & Webhooks."
            >
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
        ) : null}
      </div>
    </div>
  );
}

/**
 * «Añadir conexión»: a modal with every tool that can be connected; picking
 * one shows what the agents can do with it and its form, in the same modal.
 * `initial` opens it on arrival (a link with ?add=1 or ?add=<tool>).
 */
export function AddConnectionButton({
  label = "Añadir conexión",
  initial,
  ...setup
}: Setup & { label?: string; initial?: string | null }) {
  const router = useRouter();
  const start = initial && getIntegration(initial)?.status === "available" ? initial : null;
  const [picked, setPicked] = useState<string | null>(start);
  const integration = picked ? getIntegration(picked) : undefined;
  return (
    <ModalButton
      label={label}
      icon={<Plus className="size-4" />}
      title={integration ? `Conectar ${integration.name}` : "Añadir conexión"}
      width="lg"
      defaultOpen={Boolean(initial)}
      onClose={() => {
        setPicked(null);
        // Opened from a link: drop ?add so a reload doesn't open it again.
        if (initial) router.replace("/app/connections", { scroll: false });
      }}
    >
      {integration ? (
        <div className="space-y-5">
          <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setPicked(null)}>
            <ArrowLeft className="size-4" />
            Todas las herramientas
          </Button>
          <ToolSetup integration={integration} setup={setup} />
        </div>
      ) : (
        <ToolGrid onPick={setPicked} />
      )}
    </ModalButton>
  );
}
