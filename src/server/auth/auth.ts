import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { env, trustedOrigins } from "../env";

/**
 * Users sign in to SalesMate itself. Organizations are the SaaS tenants;
 * every domain row is scoped to an organization (see db/tenant.ts).
 *
 * Google here is only for login. Connecting a Google account as a
 * mailbox/calendar for a project is a separate OAuth flow (connectors/google).
 */
function createAuth() {
  return betterAuth({
    appName: "SalesMate",
    baseURL: env().APP_URL,
    secret: env().BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders:
      env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env().GOOGLE_CLIENT_ID!,
              clientSecret: env().GOOGLE_CLIENT_SECRET!,
            },
          }
        : undefined,
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __salesmateAuth?: Auth };

/** Lazily created so builds and scripts do not open the database on import. */
export function getAuth(): Auth {
  globalForAuth.__salesmateAuth ??= createAuth();
  return globalForAuth.__salesmateAuth;
}
