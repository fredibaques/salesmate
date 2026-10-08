"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { createMcpConnection, refreshMcpTools } from "@/server/connectors/mcp";
import { DATA_PROVIDERS } from "@/server/connectors/data";
import { ConnectorError } from "@/server/connectors/types";
import { createDataConnection, createTwentyConnection, openConnection } from "@/server/connectors/service";
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
  if (!result?.ok) return result;
  revalidatePath("/app/connections");
  redirect(`/app/connections?connected=${encodeURIComponent(label)}`);
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
  if (!result?.ok) return result;
  revalidatePath("/app/connections");
  redirect(`/app/connections?connected=${encodeURIComponent(label)}`);
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
  if (!result?.ok) return result;
  revalidatePath("/app/connections");
  redirect(`/app/connections?connected=${encodeURIComponent(label)}`);
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
    return "Conexión cargada (sin prueba de lectura disponible para sus permisos).";
  });
}
