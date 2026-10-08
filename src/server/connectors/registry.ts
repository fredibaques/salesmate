import { env } from "../env";
import { dataProvider } from "./data";
import { googleProvider } from "./google";
import { slackProvider } from "./slack";
import { whatsappProvider } from "./whatsapp";
import { twentyProvider } from "./twenty";
import type { ConnectorProvider } from "./types";

export const PROVIDER_IDS = ["twenty", "google", "apollo", "lusha", "slack", "whatsapp"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function getProvider(id: string): ConnectorProvider<unknown> {
  switch (id) {
    case "twenty":
      return twentyProvider as ConnectorProvider<unknown>;
    case "slack":
      return slackProvider as ConnectorProvider<unknown>;
    case "whatsapp":
      return whatsappProvider as ConnectorProvider<unknown>;
    case "apollo":
    case "lusha":
      return dataProvider(id) as ConnectorProvider<unknown>;
    case "google": {
      const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        throw new Error("Google is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
      }
      return googleProvider({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
      }) as ConnectorProvider<unknown>;
    }
    default:
      throw new Error(`Unknown connector provider: ${id}`);
  }
}
