"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { createTwentyConnection, openConnection } from "@/server/connectors/service";
import { getDb } from "@/server/db/client";
import { bool, runForm, str } from "@/server/form";
import { addSuppression, removeSuppression } from "@/server/services/projects";

export async function addTwenty(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const conn = await createTwentyConnection({ db: getDb() }, tenant, {
      label: str(form, "label") ?? "Twenty",
      baseUrl: str(form, "baseUrl") ?? "",
      apiKey: str(form, "apiKey") ?? "",
      webhookSecret: str(form, "webhookSecret"),
      allowWrite: bool(form, "allowWrite"),
    });
    const objects = (conn.metadata.objects as string[] | undefined) ?? [];
    return `Conectado. Objetos disponibles: ${objects.join(", ")}.`;
  });
  revalidatePath("/app/connections");
  return result;
}

export async function testConnection(connectionId: string, _: FormState): Promise<FormState> {
  return runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
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
    return "Conexión cargada (sin prueba de lectura disponible para sus permisos).";
  });
}

export async function addGlobalSuppression(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const type = (str(form, "type") ?? "email") as "email" | "domain" | "phone";
    const values = (str(form, "values") ?? "").split(/[\s,;]+/).filter(Boolean);
    if (values.length === 0) throw new Error("Escribe al menos un valor.");
    for (const value of values) {
      await addSuppression(getDb(), tenant, { projectId: null, type, value, reason: str(form, "reason") });
    }
    return `${values.length} exclusión(es) añadida(s).`;
  });
  revalidatePath("/app/connections");
  return result;
}

export async function deleteGlobalSuppression(id: string) {
  const tenant = await requireRole(["owner", "admin"]);
  await removeSuppression(getDb(), tenant, id);
  revalidatePath("/app/connections");
}
