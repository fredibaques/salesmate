import { and, eq } from "drizzle-orm";
import { audit } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import type { Db } from "../db/client";
import { connections, identities, projectConnections, projectIdentities } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { dataProvider, type DataProviderId } from "./data";
import type { GoogleCredentials } from "./google";
import { googleProvider, grantedScopeSets } from "./google";
import { getProvider } from "./registry";
import { createTwentyClient, twentyCredentials } from "./twenty";
import type { Capability, ConnectorClient } from "./types";
import { slackCredentials } from "./slack";

export type ConnectionRow = typeof connections.$inferSelect;

export type ConnectorDeps = {
  db: Db;
  fetch?: typeof fetch;
  /** Overrides provider lookup (tests). */
  providers?: (id: string) => ReturnType<typeof getProvider>;
};

/**
 * Capabilities a stored connection grants, from its read/write scopes. Only
 * the scope mapping is needed, so Google works without its OAuth client.
 */
export function connectionCapabilities(
  conn: Pick<ConnectionRow, "provider" | "readScopes" | "writeScopes">,
  deps?: Pick<ConnectorDeps, "providers">,
): Capability[] {
  const provider = deps?.providers
    ? deps.providers(conn.provider)
    : conn.provider === "google"
      ? googleProvider({ clientId: "", clientSecret: "" })
      : getProvider(conn.provider);
  return provider.capabilitiesFor({ read: conn.readScopes, write: conn.writeScopes });
}

/** Instantiates the connector of a stored connection, persisting refreshed credentials. */
export async function openConnection(
  deps: ConnectorDeps,
  tenant: Pick<TenantContext, "orgId">,
  connectionId: string,
): Promise<{ connection: ConnectionRow; client: ConnectorClient }> {
  const connection = await withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    return row;
  });
  if (!connection) throw new Error("Conexión no encontrada.");
  if (connection.status !== "active") throw new Error("La conexión no está activa.");
  if (!connection.credentialsEncrypted) throw new Error("La conexión no tiene credenciales.");

  const provider = (deps.providers ?? getProvider)(connection.provider);
  const credentials = provider.credentialsSchema.parse(decryptJson(connection.credentialsEncrypted));
  const client = provider.create(credentials, {
    fetch: deps.fetch ?? fetch,
    onCredentialsUpdated: async (updated) => {
      await withTenant(deps.db, tenant, (tx) =>
        tx
          .update(connections)
          .set({ credentialsEncrypted: encryptJson(updated) })
          .where(eq(connections.id, connectionId)),
      );
    },
  });
  return { connection, client };
}

export async function markConnectionError(
  deps: Pick<ConnectorDeps, "db">,
  tenant: Pick<TenantContext, "orgId">,
  connectionId: string,
  error: string,
) {
  await withTenant(deps.db, tenant, (tx) =>
    tx.update(connections).set({ status: "error", lastError: error }).where(eq(connections.id, connectionId)),
  );
}

// ---------------------------------------------------------------------------
// Twenty
// ---------------------------------------------------------------------------

export async function createTwentyConnection(
  deps: ConnectorDeps,
  tenant: TenantContext,
  input: { label: string; baseUrl: string; apiKey: string; webhookSecret?: string; allowWrite: boolean },
): Promise<ConnectionRow> {
  const creds = twentyCredentials.parse(input);
  // Validate the key before storing it.
  const objects = await createTwentyClient(creds, { fetch: deps.fetch ?? fetch })["crm.describe"]();

  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({
        orgId: tenant.orgId,
        provider: "twenty",
        transport: "api",
        label: input.label,
        accountRef: creds.baseUrl,
        credentialsEncrypted: encryptJson(creds),
        readScopes: ["crm"],
        writeScopes: input.allowWrite ? ["crm"] : [],
        metadata: { objects: objects.map((o) => o.name) },
        createdBy: tenant.actorId,
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider, connections.accountRef],
        set: {
          label: input.label,
          credentialsEncrypted: encryptJson(creds),
          writeScopes: input.allowWrite ? ["crm"] : [],
          status: "active",
          lastError: null,
          metadata: { objects: objects.map((o) => o.name) },
        },
      })
      .returning();
    await audit(tx, tenant, {
      event: "connection.saved",
      entityType: "connection",
      entityId: row.id,
      data: { provider: "twenty", accountRef: row.accountRef, write: input.allowWrite },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// B2B data (Apollo, Lusha)
// ---------------------------------------------------------------------------

/** Connects a data provider with its API key, after checking the key works. */
export async function createDataConnection(
  deps: ConnectorDeps,
  tenant: TenantContext,
  input: { provider: DataProviderId; label: string; apiKey: string },
): Promise<ConnectionRow> {
  const provider = dataProvider(input.provider);
  const creds = provider.credentialsSchema.parse({ apiKey: input.apiKey });
  const client = provider.create(creds, { fetch: deps.fetch ?? fetch });
  const check = await client["data.check"]!();
  // One connection per key; the end of the key tells them apart without revealing it.
  const accountRef = `clave …${creds.apiKey.slice(-4)}`;

  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({
        orgId: tenant.orgId,
        provider: input.provider,
        transport: "api",
        label: input.label,
        accountRef,
        credentialsEncrypted: encryptJson(creds),
        readScopes: ["data"],
        writeScopes: [],
        metadata: { check: check.detail },
        createdBy: tenant.actorId,
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider, connections.accountRef],
        set: {
          label: input.label,
          credentialsEncrypted: encryptJson(creds),
          status: "active",
          lastError: null,
          metadata: { check: check.detail },
        },
      })
      .returning();
    await audit(tx, tenant, {
      event: "connection.saved",
      entityType: "connection",
      entityId: row.id,
      data: { provider: input.provider, accountRef },
    });
    return row;
  });
}

/** Connects a Slack channel through its incoming webhook (only for notices). */
export async function createSlackConnection(
  deps: ConnectorDeps,
  tenant: TenantContext,
  input: { label: string; webhookUrl: string },
): Promise<ConnectionRow> {
  const creds = slackCredentials.parse({ webhookUrl: input.webhookUrl });
  // The end of the URL tells webhooks apart without revealing it.
  const accountRef = `webhook …${creds.webhookUrl.slice(-6)}`;
  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({
        orgId: tenant.orgId,
        provider: "slack",
        transport: "api",
        label: input.label,
        accountRef,
        credentialsEncrypted: encryptJson(creds),
        readScopes: [],
        writeScopes: ["notify"],
        createdBy: tenant.actorId,
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider, connections.accountRef],
        set: {
          label: input.label,
          credentialsEncrypted: encryptJson(creds),
          status: "active",
          lastError: null,
        },
      })
      .returning();
    await audit(tx, tenant, {
      event: "connection.saved",
      entityType: "connection",
      entityId: row.id,
      data: { provider: "slack", accountRef },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export async function saveGoogleConnection(
  deps: Pick<ConnectorDeps, "db">,
  tenant: TenantContext,
  input: { email: string; name: string | null; credentials: GoogleCredentials; ownerUserId: string },
): Promise<ConnectionRow> {
  const sets = grantedScopeSets(input.credentials.scope);
  const read = [
    ...(sets.includes("calendar_read") || sets.includes("calendar_write") ? ["calendar"] : []),
    ...(sets.includes("gmail_read") ? ["email"] : []),
  ];
  const write = [
    ...(sets.includes("calendar_write") ? ["calendar"] : []),
    ...(sets.includes("gmail_write") ? ["email"] : []),
  ];

  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({
        orgId: tenant.orgId,
        provider: "google",
        transport: "api",
        label: `Google · ${input.email}`,
        accountRef: input.email,
        credentialsEncrypted: encryptJson(input.credentials),
        readScopes: read,
        writeScopes: write,
        createdBy: tenant.actorId,
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider, connections.accountRef],
        set: {
          credentialsEncrypted: encryptJson(input.credentials),
          readScopes: read,
          writeScopes: write,
          status: "active",
          lastError: null,
        },
      })
      .returning();

    const kinds: ("email" | "calendar")[] = [];
    if (write.includes("email")) kinds.push("email");
    if (read.includes("calendar")) kinds.push("calendar");
    for (const kind of kinds) {
      await tx
        .insert(identities)
        .values({
          orgId: tenant.orgId,
          kind,
          provider: "google",
          address: input.email,
          displayName: input.name,
          ownerUserId: input.ownerUserId,
          connectionId: row.id,
        })
        .onConflictDoUpdate({
          target: [identities.orgId, identities.kind, identities.address],
          set: { connectionId: row.id, ownerUserId: input.ownerUserId, displayName: input.name },
        });
    }
    await audit(tx, tenant, {
      event: "connection.saved",
      entityType: "connection",
      entityId: row.id,
      data: { provider: "google", accountRef: input.email, read, write },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Project assignments
// ---------------------------------------------------------------------------

export async function linkConnectionToProject(
  deps: Pick<ConnectorDeps, "db" | "providers">,
  tenant: TenantContext,
  input: { projectId: string; connectionId: string; capabilities: string[] },
) {
  return withTenant(deps.db, tenant, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, input.connectionId));
    if (!conn) throw new Error("Conexión no encontrada.");
    const allowed = new Set<string>(connectionCapabilities(conn, deps));
    const capabilities = input.capabilities.filter((c) => allowed.has(c));
    await tx
      .insert(projectConnections)
      .values({ orgId: tenant.orgId, projectId: input.projectId, connectionId: conn.id, capabilities })
      .onConflictDoUpdate({
        target: [projectConnections.projectId, projectConnections.connectionId],
        set: { capabilities },
      });
    await audit(tx, tenant, {
      event: "project.connection_linked",
      projectId: input.projectId,
      entityType: "connection",
      entityId: conn.id,
      data: { capabilities },
    });
    return capabilities;
  });
}

export async function unlinkConnectionFromProject(
  deps: Pick<ConnectorDeps, "db">,
  tenant: TenantContext,
  input: { projectId: string; connectionId: string },
) {
  await withTenant(deps.db, tenant, async (tx) => {
    await tx
      .delete(projectConnections)
      .where(
        and(
          eq(projectConnections.projectId, input.projectId),
          eq(projectConnections.connectionId, input.connectionId),
        ),
      );
    await audit(tx, tenant, {
      event: "project.connection_unlinked",
      projectId: input.projectId,
      entityType: "connection",
      entityId: input.connectionId,
    });
  });
}

export async function setProjectIdentity(
  deps: Pick<ConnectorDeps, "db">,
  tenant: TenantContext,
  input: { projectId: string; identityId: string; assigned: boolean; isDefault?: boolean },
) {
  await withTenant(deps.db, tenant, async (tx) => {
    if (input.assigned) {
      await tx
        .insert(projectIdentities)
        .values({
          orgId: tenant.orgId,
          projectId: input.projectId,
          identityId: input.identityId,
          isDefault: input.isDefault ?? false,
        })
        .onConflictDoUpdate({
          target: [projectIdentities.projectId, projectIdentities.identityId],
          set: { isDefault: input.isDefault ?? false },
        });
    } else {
      await tx
        .delete(projectIdentities)
        .where(
          and(
            eq(projectIdentities.projectId, input.projectId),
            eq(projectIdentities.identityId, input.identityId),
          ),
        );
    }
    await audit(tx, tenant, {
      event: input.assigned ? "project.identity_assigned" : "project.identity_removed",
      projectId: input.projectId,
      entityType: "identity",
      entityId: input.identityId,
    });
  });
}
