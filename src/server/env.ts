import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** postgres://… for a real server, or pglite:<dir> / pglite:memory for embedded Postgres. */
  DATABASE_URL: z.string().optional(),
  APP_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /** 32 random bytes, base64. Encrypts connection credentials at rest. */
  ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Shared secret for scheduler calls (Authorization: Bearer …). */
  CRON_SECRET: z.string().optional(),
});

export type Env = Omit<z.infer<typeof schema>, "DATABASE_URL" | "APP_URL"> & {
  /** Empty when no database is configured (serverless hosts have no writable disk for PGlite). */
  DATABASE_URL: string;
  APP_URL: string;
};

/** Serverless hosts (Vercel) have a read-only filesystem: no embedded database there. */
export const isServerless = () => Boolean(process.env.VERCEL);

function defaultAppUrl(): string {
  const host =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

/**
 * Origins allowed to call the auth API: APP_URL plus the URLs Vercel serves this
 * deployment under (per-deployment, branch and production), which differ from APP_URL.
 */
export function trustedOrigins(): string[] {
  const hosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter((h): h is string => Boolean(h));
  return [...new Set([env().APP_URL, ...hosts.map((h) => `https://${h}`)])];
}

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const raw = schema.parse({
      ...process.env,
      // Treat empty strings from dashboards as "not set".
      ...Object.fromEntries(
        Object.entries(process.env)
          .filter(([, v]) => v === "")
          .map(([k]) => [k, undefined]),
      ),
    });
    cached = {
      ...raw,
      DATABASE_URL: raw.DATABASE_URL ?? (isServerless() ? "" : "pglite:./.data/pglite"),
      APP_URL: (raw.APP_URL ?? defaultAppUrl()).replace(/\/+$/, ""),
    };
  }
  return cached;
}

/** Human-readable list of missing or invalid settings that stop the app from working. */
export function configProblems(): string[] {
  let e: Env;
  try {
    e = env();
  } catch (err) {
    return [`Variables de entorno no válidas: ${err instanceof Error ? err.message : String(err)}`];
  }
  const problems: string[] = [];
  if (!e.DATABASE_URL) problems.push("DATABASE_URL: falta la dirección de la base de datos (Neon).");
  else if (isServerless() && e.DATABASE_URL.startsWith("pglite:"))
    problems.push("DATABASE_URL: en Vercel no se puede usar la base de datos local; usa la de Neon.");
  if (process.env.NODE_ENV === "production") {
    if (!e.BETTER_AUTH_SECRET) problems.push("BETTER_AUTH_SECRET: falta (32+ caracteres aleatorios).");
    if (!e.ENCRYPTION_KEY) problems.push("ENCRYPTION_KEY: falta (32 bytes aleatorios en base64).");
    else if (Buffer.from(e.ENCRYPTION_KEY, "base64").length !== 32)
      problems.push("ENCRYPTION_KEY: debe ser exactamente 32 bytes codificados en base64.");
  }
  return problems;
}
