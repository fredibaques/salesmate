import { z } from "zod";
import { expectOk, type ConnectorProvider } from "./types";

/**
 * Slack through an incoming webhook: the team creates one for a channel
 * (Slack → Apps → Incoming Webhooks) and the agents post their notices
 * there. It can only write to that channel; it reads nothing.
 */

export const slackCredentials = z.object({
  webhookUrl: z
    .string()
    .trim()
    .url("Pega la URL completa del webhook.")
    .refine(
      (u) => /^https:\/\/hooks\.slack\.com\/services\//.test(u),
      "Debe ser una URL de webhook de Slack (https://hooks.slack.com/services/…).",
    ),
});
export type SlackCredentials = z.infer<typeof slackCredentials>;

export const slackProvider: ConnectorProvider<SlackCredentials> = {
  id: "slack",
  name: "Slack",
  transport: "api",
  credentialsSchema: slackCredentials,
  capabilitiesFor: (scopes) => (scopes.write.includes("notify") ? ["notify.slack"] : []),
  create: (creds, ctx) => ({
    "notify.slack": async ({ text }) => {
      const res = await ctx.fetch(creds.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await expectOk(res, "Slack");
      return { ok: true };
    },
  }),
};
