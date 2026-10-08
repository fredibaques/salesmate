"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { createMcpConnection, refreshMcpTools } from "@/server/connectors/mcp";
import { DATA_PROVIDERS } from "@/server/connectors/data";
import { ConnectorError } from "@/server/connectors/types";
import {
  createDataConnection,
  createSlackConnection,
  createWhatsappConnection,
  createTwentyConnection,
  openConnection,
} from "@/server/connectors/service";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { connections } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { bool, runForm, str } from "@/server/form";

export async function addTwenty(_: FormState, form: FormData): Promise<FormState> {
  const label = str(form, "label") ?? "Twenty";
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await createTwentyConnection({ db: getDb() }, tenant, {
      label,
      baseUrl: str(form, "baseUrl") ?? "",
      apiKey: str(form, "apiKey") ?? "",
      webhookSecret: str(form, "webhookSecret"),
      allowWrite: bool(form, "allowWrite"),
    });
  });
  revalidatePath("/app/connections");
  return result?.ok ? { ok: true, message: `Conectado: ${label}` } : result;
}

export async function addMcp(_: FormState, form: FormData): Promise<FormState> {
  const label = str(form, "label") ?? "Servidor MCP";
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    try {
      await createMcpConnection({ db: getDb() }, tenant, {
        label,
        url: str(form, "url") ?? "",
        token: str(form, "token"),
      });
    } catch (err) {
      console.error(err);
      throw new Error(
        "No hemos podido conectar con el servidor. Revisa la URL (debe ser la dirección MCP por HTTP, normalmente acabada en /mcp) y el token.",
      );
    }
  });
  revalidatePath("/app/connections");
  return result?.ok ? { ok: true, message: `Conectado: ${label}` } : result;
}

/** Connects Apollo or Lusha with an API key (checked before saving). */
export async function addDataSource(provider: string, _: FormState, form: FormData): Promise<FormState> {
  const id = DATA_PROVIDERS.find((p) => p === provider);
  const name = id === "apollo" ? "Apollo" : "Lusha";
  const label = str(form, "label") ?? name;
  const result = await runForm(async () => {
    if (!id) throw new Error("Herramienta desconocida.");
    const tenant = await requireRole(["owner", "admin"]);
    try {
      await createDataConnection({ db: getDb() }, tenant, {
        provider: id,
        label,
        apiKey: str(form, "apiKey") ?? "",
      });
    } catch (err) {
      if (err instanceof ConnectorError && (err.status === 401 || err.status === 403)) {
        throw new Error(
          `${name} no acepta esta API key. Cópiala de nuevo y comprueba que tu plan incluye acceso a la API.`,
        );
      }
      throw err;
    }
  });
  revalidatePath("/app/connections");
  return result?.ok ? { ok: true, message: `Conectado: ${label}` } : result;
}

/** Connects a WhatsApp Business number (Meta's Cloud API). */
export async function addWhatsapp(_: FormState, form: FormData): Promise<FormState> {
  const label = str(form, "label") ?? "WhatsApp";
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    try {
      await createWhatsappConnection({ db: getDb() }, tenant, {
        label,
        accessToken: str(form, "accessToken") ?? "",
        phoneNumberId: str(form, "phoneNumberId") ?? "",
        appSecret: str(form, "appSecret") ?? "",
      });
    } catch (err) {
      if (err instanceof ConnectorError && (err.status === 401 || err.status === 403 || err.status === 400)) {
        throw new Error(`Meta no acepta estos datos: ${err.message.replace(/^WhatsApp: /, "")}`);
      }
      throw err;
    }
  });
  revalidatePath("/app/connections");
  return result?.ok
    ? { ok: true, message: `Conectado: ${label}. Configura el webhook en Meta con los datos de su tarjeta.` }
    : result;
}

/** Connects a Slack channel by its incoming webhook, for the agents' notices. */
export async function addSlack(_: FormState, form: FormData): Promise<FormState> {
  const label = str(form, "label") ?? "Slack";
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    await createSlackConnection({ db: getDb() }, tenant, {
      label,
      webhookUrl: str(form, "webhookUrl") ?? "",
    });
  });
  revalidatePath("/app/connections");
  return result?.ok ? { ok: true, message: `Conectado: ${label}` } : result;
}

export async function testConnection(connectionId: string, _: FormState): Promise<FormState> {
  return runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const [conn] = await withTenant(getDb(), tenant, (tx) =>
      tx.select({ provider: connections.provider }).from(connections).where(eq(connections.id, connectionId)),
    );
    if (conn?.provider === "mcp") {
      const tools = await refreshMcpTools({ db: getDb() }, tenant, connectionId);
      revalidatePath("/app/connections");
      return `OK · ${tools.length} herramientas disponibles.`;
    }
    const { connection, client } = await openConnection({ db: getDb() }, tenant, connectionId);
    if (client["crm.describe"]) {
      const objects = await client["crm.describe"]();
      return `OK · ${objects.length} objetos (${
        objects
          .filter((o) => o.custom)
          .map((o) => o.labelPlural)
          .join(", ") || "sin objetos propios"
      }).`;
    }
    if (client["calendar.free_busy"]) {
      const now = new Date();
      const { busy, errors } = await client["calendar.free_busy"]({
        calendarIds: [connection.accountRef],
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      });
      if (errors.length) throw new Error(errors.join("; "));
      return `OK · ${busy.length} bloques ocupados en los próximos 7 días.`;
    }
    if (client["data.check"]) return `OK · ${(await client["data.check"]()).detail}.`;
    // Posting is an effect: it only happens through the gateway, with a real notice.
    if (client["whatsapp.send"])
      return "Conexión cargada. Se comprobará al recibir o enviar el primer mensaje.";
    if (client["notify.slack"]) return "Guardada. Se comprobará con el primer aviso de un agente.";
    return "Conexión cargada (sin prueba de lectura disponible para sus permisos).";
  });
}
