import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { auditLog, orgAi } from "../db/schema";
import { withSystem, type TenantContext } from "../db/tenant";
import { LlmNotConfiguredError, type LlmClient } from "./client";
import { LlmProviderError } from "./errors";
import { connectOrgAi, disconnectOrgAi, getOrgAi, orgLlm, requireOrgLlm, type LlmFactory } from "./org-ai";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let other: TenantContext;

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz-1234";
const ok = async () => {};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const a = await seedOrg(db, "IA");
  const b = await seedOrg(db, "Otra");
  tenant = { orgId: a.orgId, actorType: "user", actorId: a.userId };
  other = { orgId: b.orgId, actorType: "user", actorId: b.userId };
});

afterAll(async () => close());

describe("organization AI account", () => {
  it("keeps AI off until the organization connects a key", async () => {
    expect(await getOrgAi(db, tenant)).toBeNull();
    expect(await orgLlm(db, tenant)).toBeNull();
    await expect(requireOrgLlm(db, tenant)).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });

  it("checks the key, stores it encrypted and builds the client with it", async () => {
    const checked: string[] = [];
    const ai = await connectOrgAi(
      db,
      tenant,
      { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: ` ${KEY} ` },
      async (provider, apiKey, model) => {
        checked.push(`${provider}:${apiKey}:${model}`);
      },
    );
    expect(checked).toEqual([`anthropic:${KEY}:claude-sonnet-5-5`]);
    expect(ai).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      keyHint: "1234",
      status: "active",
    });

    const [row] = await withSystem(db, (tx) => tx.select().from(orgAi).where(eq(orgAi.orgId, tenant.orgId)));
    expect(row.keyEncrypted).not.toContain(KEY);

    let built: Parameters<LlmFactory>[0] | undefined;
    const llm = await orgLlm(db, tenant, (options) => {
      built = options;
      return scriptedLlm([]).llm;
    });
    expect(llm).not.toBeNull();
    expect(built).toEqual({ provider: "anthropic", apiKey: KEY, model: "claude-sonnet-5-5" });

    // Other organizations neither see it nor use it.
    expect(await getOrgAi(db, other)).toBeNull();
    expect(await orgLlm(db, other)).toBeNull();

    const events = await withSystem(db, (tx) =>
      tx
        .select({ event: auditLog.event, data: auditLog.data })
        .from(auditLog)
        .where(eq(auditLog.orgId, tenant.orgId)),
    );
    expect(events.at(-1)).toMatchObject({
      event: "ai.connected",
      data: { provider: "anthropic", keyHint: "1234" },
    });
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it("rejects keys the provider refuses and keeps the saved one", async () => {
    await expect(
      connectOrgAi(
        db,
        tenant,
        { provider: "openai", model: "gpt-6.1-sol", apiKey: "sk-proj-zzzzzzzzzzzzzzzzzzzzzzzz" },
        async () => {
          throw { status: 401, message: "Incorrect API key provided" };
        },
      ),
    ).rejects.toMatchObject({ kind: "auth" });
    expect((await getOrgAi(db, tenant))?.provider).toBe("anthropic");

    // Changing provider needs that provider's key.
    await expect(connectOrgAi(db, tenant, { provider: "kimi", model: "kimi-k3" }, ok)).rejects.toThrow(
      "Pega la clave",
    );
    // Same provider: the model changes and the key stays.
    const ai = await connectOrgAi(db, tenant, { provider: "anthropic", model: "claude-opus-5-5" }, ok);
    expect(ai).toMatchObject({ model: "claude-opus-5-5", keyHint: "1234" });
  });

  it("marks the account when the provider rejects it and clears it on the next success", async () => {
    let fail = true;
    const flaky: LlmFactory = () =>
      ({
        provider: "anthropic",
        model: "claude-opus-5-5",
        async create(request) {
          if (fail) throw { status: 400, message: "Your credit balance is too low to access the API" };
          return scriptedLlm([{ blocks: [{ type: "text", text: "ok" }] }]).llm.create(request);
        },
      }) satisfies LlmClient;
    const request = { max_tokens: 10, messages: [{ role: "user" as const, content: "hola" }] };

    const llm = (await orgLlm(db, tenant, flaky))!;
    const error = await llm.create(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error).toMatchObject({ kind: "credit" });
    expect(await getOrgAi(db, tenant)).toMatchObject({ status: "error", errorKind: "credit" });

    fail = false;
    const again = (await orgLlm(db, tenant, flaky))!;
    await again.create(request);
    expect(await getOrgAi(db, tenant)).toMatchObject({ status: "active", errorKind: null, lastError: null });
  });

  it("disconnects", async () => {
    await disconnectOrgAi(db, tenant);
    expect(await getOrgAi(db, tenant)).toBeNull();
    expect(await orgLlm(db, tenant)).toBeNull();
  });
});
