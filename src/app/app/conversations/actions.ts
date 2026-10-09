"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireTenant } from "@/server/auth/session";
import { addNote, changePerson, replyToPerson, type PersonChange } from "@/server/conversations/inbox";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { gatewayDeps } from "@/server/gateway/runtime";

/** The inbox shows in its section and in each project's tab: refresh everything under /app. */
const refresh = () => revalidatePath("/app", "layout");

/** A person's reply from the inbox, by email or WhatsApp (through the gateway). */
export async function replyAction(key: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireTenant();
    const channel = str(form, "channel") === "whatsapp" ? "whatsapp" : "email";
    return replyToPerson(gatewayDeps(), tenant, key, {
      channel,
      subject: str(form, "subject"),
      body: String(form.get("body") ?? ""),
    });
  });
  refresh();
  return result;
}

/** A note for the team on the thread. */
export async function noteAction(key: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireTenant();
    await addNote(
      getDb(),
      tenant,
      key,
      tenant.user.name || tenant.user.email,
      String(form.get("body") ?? ""),
    );
    return "Nota guardada.";
  });
  refresh();
  return result;
}

const CHANGE_MESSAGES: Record<PersonChange, string> = {
  take_over: "Ahora la llevas tú: el agente no responderá.",
  give_back: "El agente vuelve a encargarse.",
  close: "Conversación cerrada.",
  reopen: "Conversación reabierta.",
};

/** Takes a person over from the agents, gives them back, closes or reopens them. */
export async function changePersonAction(key: string, change: PersonChange): Promise<FormState> {
  const result = await runForm(async () => {
    await changePerson(getDb(), await requireTenant(), key, change);
    return CHANGE_MESSAGES[change];
  });
  refresh();
  return result;
}
