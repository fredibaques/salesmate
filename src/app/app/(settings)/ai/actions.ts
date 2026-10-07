"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { connectOrgAi, disconnectOrgAi } from "@/server/llm/org-ai";

const admin = () => requireRole(["owner", "admin"]);

export async function connectAi(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const ai = await connectOrgAi(getDb(), tenant, {
      provider: str(form, "provider") ?? "",
      model: str(form, "model") ?? "",
      apiKey: str(form, "apiKey"),
    });
    return `Conectado. La IA usa ahora tu cuenta (clave ····${ai.keyHint}).`;
  });
  // Every screen that offers AI changes.
  revalidatePath("/app", "layout");
  return result;
}

export async function disconnectAi(_: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    await disconnectOrgAi(getDb(), await admin());
    return "Desconectado. La IA queda apagada hasta que conectes otra cuenta.";
  });
  revalidatePath("/app", "layout");
  return result;
}
