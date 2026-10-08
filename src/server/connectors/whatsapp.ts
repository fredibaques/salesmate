import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ConnectorError, expectOk, type ConnectorContext, type ConnectorProvider } from "./types";

/**
 * WhatsApp Business through Meta's Cloud API (graph.facebook.com). The team
 * connects one business number with a permanent access token (a system
 * user's), its phone number id and the app secret. Messages arrive on our
 * webhook (signed with the app secret) and replies go out as gateway
 * actions (whatsapp.send). Free-form text is only allowed within 24 hours of
 * the contact's last message; after that Meta requires an approved template.
 */

export const GRAPH_URL = "https://graph.facebook.com/v21.0";

export const whatsappCredentials = z.object({
  accessToken: z.string().trim().min(20, "El token de acceso no parece válido."),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{6,}$/, "El identificador del número son solo cifras."),
  appSecret: z.string().trim().min(16, "El secreto de la app no parece válido."),
  /** Ours: Meta sends it back when the webhook is set up. */
  verifyToken: z.string().min(16),
});
export type WhatsappCredentials = z.infer<typeof whatsappCredentials>;

/** «+34 600 00 00 00» → «34600000000» (what the Cloud API takes). */
export function waNumber(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

function client(creds: WhatsappCredentials, ctx: ConnectorContext) {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await ctx.fetch(`${GRAPH_URL}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    try {
      return await expectOk(res, "WhatsApp");
    } catch (err) {
      const body = err instanceof ConnectorError ? (err.body as { error?: { message?: string } }) : null;
      if (err instanceof ConnectorError && body?.error?.message) {
        throw new ConnectorError(`WhatsApp: ${body.error.message}`, err.status, err.body);
      }
      throw err;
    }
  };
  return {
    /** The business number and its verified name. */
    async describe() {
      const body = (await call(`${creds.phoneNumberId}?fields=display_phone_number,verified_name`)) as {
        display_phone_number?: string;
        verified_name?: string;
      };
      return { number: body.display_phone_number ?? creds.phoneNumberId, name: body.verified_name ?? null };
    },
    async send(input: { to: string; body: string }) {
      const body = (await call(`${creds.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: waNumber(input.to),
          type: "text",
          text: { preview_url: false, body: input.body },
        }),
      })) as { messages?: { id: string }[] };
      return { messageId: body.messages?.[0]?.id ?? "" };
    },
  };
}

export function createWhatsappClient(creds: WhatsappCredentials, ctx: ConnectorContext) {
  return client(creds, ctx);
}

export const whatsappProvider: ConnectorProvider<WhatsappCredentials> = {
  id: "whatsapp",
  name: "WhatsApp Business",
  transport: "api",
  credentialsSchema: whatsappCredentials,
  capabilitiesFor: (scopes) => (scopes.write.includes("whatsapp") ? ["whatsapp.send"] : []),
  create: (creds, ctx) => {
    const c = client(creds, ctx);
    return { "whatsapp.send": (input) => c.send(input) };
  },
};

/** Meta signs each delivery: X-Hub-Signature-256 = "sha256=" + HMAC of the raw body with the app secret. */
export function verifyWhatsappSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type WhatsappMessage = {
  id: string;
  from: string;
  name: string | null;
  text: string;
  timestamp: Date;
  phoneNumberId: string;
};

/** The messages people sent in a webhook delivery (statuses and the rest are left out). */
export function parseWhatsappWebhook(body: unknown): WhatsappMessage[] {
  const out: WhatsappMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = String((value.metadata as { phone_number_id?: string })?.phone_number_id ?? "");
      const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[]) ?? [];
      for (const m of (value.messages as Record<string, unknown>[]) ?? []) {
        const from = String(m.from ?? "");
        const type = String(m.type ?? "");
        const text =
          type === "text"
            ? String((m.text as { body?: string })?.body ?? "")
            : type === "button"
              ? String((m.button as { text?: string })?.text ?? "")
              : type === "interactive"
                ? JSON.stringify(m.interactive ?? {})
                : `[${type || "mensaje"} sin texto]`;
        out.push({
          id: String(m.id ?? ""),
          from,
          name: contacts.find((c) => c.wa_id === from)?.profile?.name ?? null,
          text,
          timestamp: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()),
          phoneNumberId,
        });
      }
    }
  }
  return out;
}
