import { and, eq, gte, sql } from "drizzle-orm";
import { AI_PROVIDER_INFO, isAiProvider, type AiProvider } from "@/lib/ai-providers";
import { audit } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import type { Db } from "../db/client";
import { agentRuns, orgAi } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { LlmNotConfiguredError, type LlmClient } from "./client";
import { classifyLlmError, LlmProviderError, type LlmErrorKind } from "./errors";
import { createLlm, verifyApiKey } from "./providers";

/**
 * Each organization brings its own AI account: one provider, one key, one
 * model. Every model call made for the organization resolves its client here;
 * without a key, AI features stay off. Calls that fail because of the account
 * (bad key, no balance, model not available) mark the connection so the
 * screens can say what to fix, and the next success clears it.
 */

export type OrgAi = {
  provider: AiProvider;
  model: string;
  keyHint: string;
  status: "active" | "error";
  errorKind: "auth" | "credit" | "model" | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  updatedAt: Date;
};

export type LlmFactory = (options: { provider: AiProvider; apiKey: string; model: string }) => LlmClient;
export type KeyVerifier = (provider: AiProvider, apiKey: string, model: string) => Promise<void>;

const ACCOUNT_ERRORS: LlmErrorKind[] = ["auth", "credit", "model"];

export async function getOrgAi(db: Db, tenant: Pick<TenantContext, "orgId">): Promise<OrgAi | null> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select().from(orgAi).where(eq(orgAi.orgId, tenant.orgId)),
  );
  if (!row) return null;
  return {
    provider: row.provider,
    model: row.model,
    keyHint: row.keyHint,
    status: row.status,
    errorKind: row.errorKind,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    updatedAt: row.updatedAt,
  };
}

/** The organization's model client, or null when it has not connected one. */
export async function orgLlm(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  factory: LlmFactory = createLlm,
): Promise<LlmClient | null> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select().from(orgAi).where(eq(orgAi.orgId, tenant.orgId)),
  );
  if (!row) return null;
  let apiKey: string;
  try {
    apiKey = decryptJson<{ apiKey: string }>(row.keyEncrypted).apiKey;
  } catch {
    // The server's encryption key changed: the stored key can't be read back.
    await markOrgAi(
      db,
      tenant.orgId,
      new LlmProviderError("auth", row.provider, "No se puede leer la clave guardada: vuelve a pegarla."),
    );
    return null;
  }
  return tracked(factory({ provider: row.provider, apiKey, model: row.model }), db, tenant.orgId, row.status);
}

/** Like orgLlm, for paths that need AI: throws a message that says where to connect it. */
export async function requireOrgLlm(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  factory?: LlmFactory,
): Promise<LlmClient> {
  const llm = await orgLlm(db, tenant, factory);
  if (!llm) throw new LlmNotConfiguredError();
  return llm;
}

function tracked(client: LlmClient, db: Db, orgId: string, status: "active" | "error"): LlmClient {
  let healthy = status === "active";
  return {
    provider: client.provider,
    model: client.model,
    async create(request) {
      let response;
      try {
        response = await client.create(request);
      } catch (err) {
        const error = classifyLlmError(client.provider, err, request.model ?? client.model);
        if (ACCOUNT_ERRORS.includes(error.kind)) {
          healthy = false;
          await markOrgAi(db, orgId, error);
        }
        throw error;
      }
      if (!healthy) {
        healthy = true;
        await markOrgAi(db, orgId, null);
      }
      return response;
    },
  };
}

async function markOrgAi(db: Db, orgId: string, error: LlmProviderError | null): Promise<void> {
  try {
    await withTenant(db, { orgId }, (tx) =>
      tx
        .update(orgAi)
        .set(
          error
            ? {
                status: "error",
                errorKind: error.kind as "auth" | "credit" | "model",
                lastError: error.message,
                lastErrorAt: new Date(),
              }
            : { status: "active", errorKind: null, lastError: null },
        )
        .where(eq(orgAi.orgId, orgId)),
    );
  } catch {
    // Recording the state must never hide the provider's own error.
  }
}

export type ConnectAiInput = { provider: string; model: string; apiKey?: string };

/**
 * Connects or updates the organization's AI account. A new key is checked
 * with the provider (for free) before it is saved; leaving the key empty
 * keeps the saved one, which is only allowed with the same provider.
 */
export async function connectOrgAi(
  db: Db,
  tenant: TenantContext,
  input: ConnectAiInput,
  verify: KeyVerifier = verifyApiKey,
): Promise<OrgAi> {
  if (!isAiProvider(input.provider)) throw new Error("Elige un proveedor de IA.");
  const provider = input.provider;
  const info = AI_PROVIDER_INFO[provider];
  if (!info.models.some((m) => m.id === input.model))
    throw new Error("Elige uno de los modelos de la lista.");
  const typed = input.apiKey?.trim() ?? "";
  if (typed && (/\s/.test(typed) || typed.length < 20)) {
    throw new Error("La clave no parece válida: cópiala entera, sin espacios.");
  }

  const [current] = await withTenant(db, tenant, (tx) =>
    tx.select().from(orgAi).where(eq(orgAi.orgId, tenant.orgId)),
  );
  let apiKey = typed;
  if (!apiKey) {
    if (!current) throw new Error("Pega la clave de API de tu cuenta.");
    if (current.provider !== provider) throw new Error(`Pega la clave de tu cuenta de ${info.label}.`);
    apiKey = decryptJson<{ apiKey: string }>(current.keyEncrypted).apiKey;
  }

  try {
    await verify(provider, apiKey, input.model);
  } catch (err) {
    throw classifyLlmError(provider, err, input.model);
  }

  const values = {
    provider,
    model: input.model,
    keyEncrypted: encryptJson({ apiKey }),
    keyHint: apiKey.slice(-4),
    status: "active" as const,
    errorKind: null,
    lastError: null,
    lastErrorAt: null,
  };
  await withTenant(db, tenant, async (tx) => {
    await tx
      .insert(orgAi)
      .values({ orgId: tenant.orgId, createdBy: tenant.actorId, ...values })
      .onConflictDoUpdate({ target: orgAi.orgId, set: values });
    await audit(tx, tenant, {
      event: current ? "ai.updated" : "ai.connected",
      entityType: "org_ai",
      entityId: tenant.orgId,
      data: { provider, model: input.model, keyHint: values.keyHint, newKey: Boolean(typed) },
    });
  });
  return (await getOrgAi(db, tenant))!;
}

export async function disconnectOrgAi(db: Db, tenant: TenantContext): Promise<void> {
  await withTenant(db, tenant, async (tx) => {
    const removed = await tx.delete(orgAi).where(eq(orgAi.orgId, tenant.orgId)).returning();
    if (removed.length) {
      await audit(tx, tenant, {
        event: "ai.disconnected",
        entityType: "org_ai",
        entityId: tenant.orgId,
        data: { provider: removed[0].provider },
      });
    }
  });
}

/** Runs and estimated cost since the start of the month (UTC), for the settings screen. */
export async function aiUsageThisMonth(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  now = new Date(),
): Promise<{ runs: number; costUsd: number }> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        runs: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.orgId, tenant.orgId), gte(agentRuns.startedAt, since))),
  );
  return { runs: row?.runs ?? 0, costUsd: row?.costUsd ?? 0 };
}
