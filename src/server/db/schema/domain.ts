import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

/**
 * Tenant isolation
 * ----------------
 * Every domain table carries `org_id`. Request code runs inside
 * `withTenant()` (db/tenant.ts), which opens a transaction, sets
 * `app.org_id` and switches to the `salesmate_app` role. The policies below
 * make rows of other organizations invisible and unwritable for that role.
 * The role itself is created by the first migration (drizzle/0000_*).
 */
export const appRole = pgRole("salesmate_app").existing();

const sameOrg = sql`org_id = current_setting('app.org_id', true)`;

const tenantPolicy = (table: string) =>
  pgPolicy(`${table}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sameOrg,
    withCheck: sameOrg,
  });

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const orgId = () =>
  text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    website: text("website"),
    languages: text("languages")
      .array()
      .notNull()
      .default(sql`'{es}'::text[]`),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    status: text("status", { enum: ["active", "paused", "archived"] })
      .notNull()
      .default("active"),
    /** Kill switch: when true no agent action of this project may execute. */
    agentsPaused: boolean("agents_paused").notNull().default(false),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
    /** Secret used by the project's web forms to post leads (POST /api/inbound/form/:projectId). */
    inboundFormKey: text("inbound_form_key"),
    /** What the project sells and to whom, shared by every agent (see playbooks/spec.ts). */
    salesProfile: jsonb("sales_profile").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_org_idx").on(t.orgId), tenantPolicy("projects")],
);

export type ProjectSettings = {
  /** Days during which a contact touched by another project needs approval. */
  crossProjectCooldownDays?: number;
  /** Local-time window for outbound actions, e.g. ["08:00", "20:00"]. */
  sendWindow?: [string, string];
  /** ISO weekdays (1 = Monday … 7 = Sunday) when outbound actions may run. */
  sendDays?: number[];
};

// ---------------------------------------------------------------------------
// Connections & identities
// ---------------------------------------------------------------------------

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    provider: text("provider").notNull(),
    transport: text("transport", {
      enum: ["api", "mcp", "webhook", "browser", "file"],
    })
      .notNull()
      .default("api"),
    label: text("label").notNull(),
    /** Human-readable account reference: mailbox address, CRM base URL… */
    accountRef: text("account_ref").notNull(),
    credentialsEncrypted: text("credentials_encrypted"),
    readScopes: text("read_scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    writeScopes: text("write_scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: ["active", "error", "revoked"] })
      .notNull()
      .default("active"),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("connections_org_provider_account_uq").on(t.orgId, t.provider, t.accountRef),
    tenantPolicy("connections"),
  ],
);

/**
 * A channel endpoint owned by the organization: a mailbox, a calendar, a
 * phone number. Projects are allowed to act through the identities assigned
 * to them (project_identities). `ownerUserId` is the person behind it, used
 * to compute one person's availability across all their calendars.
 */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    kind: text("kind", { enum: ["email", "calendar", "phone", "whatsapp"] }).notNull(),
    provider: text("provider").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    ownerUserId: text("owner_user_id"),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique("identities_org_kind_address_uq").on(t.orgId, t.kind, t.address),
    tenantPolicy("identities"),
  ],
);

export const projectIdentities = pgTable(
  "project_identities",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    orgId: orgId(),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.identityId] }), tenantPolicy("project_identities")],
);

export const projectConnections = pgTable(
  "project_connections",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    orgId: orgId(),
    /** Capabilities of the connection this project may use (subset). */
    capabilities: text("capabilities")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    objectMappings: jsonb("object_mappings").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.connectionId] }), tenantPolicy("project_connections")],
);

// ---------------------------------------------------------------------------
// Meeting types (only used by playbooks whose next step needs a calendar)
// ---------------------------------------------------------------------------

export type WeeklyHours = Partial<
  Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", [string, string][]>
>;

export const meetingTypes = pgTable(
  "meeting_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["demo", "discovery", "closing_call", "callback", "custom"],
    }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(10),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(240),
    horizonDays: integer("horizon_days").notNull().default(14),
    slotStepMinutes: integer("slot_step_minutes").notNull().default(30),
    weeklyHours: jsonb("weekly_hours").$type<WeeklyHours>().notNull(),
    /** Overrides the project timezone for the weekly hours. */
    timezone: text("timezone"),
    hostUserId: text("host_user_id"),
    /** Calendar where bookings are created. */
    calendarIdentityId: uuid("calendar_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    location: text("location"),
    inviteTemplate: text("invite_template"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("meeting_types_project_idx").on(t.projectId), tenantPolicy("meeting_types")],
);

// ---------------------------------------------------------------------------
// Rules: compliance, autonomy, suppressions
// ---------------------------------------------------------------------------

export const complianceRules = pgTable(
  "compliance_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["human_only", "mandatory_notice", "channel_restriction", "retention"],
    }).notNull(),
    description: text("description").notNull(),
    /**
     * human_only:          { actionTypes: string[] }
     * mandatory_notice:    { actionTypes: string[], text: string }
     * channel_restriction: { actionTypes: string[], customerTypes: ("b2b"|"b2c")[] }
     * retention:           { days: number }
     */
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [tenantPolicy("compliance_rules")],
);

export const AGENT_TYPES = ["outbound", "inbound", "account_manager", "intelligence", "copilot"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentChannels = {
  /** Identity (email) the agent writes from. */
  mailboxId?: string | null;
  /** Read the mailbox for incoming leads (inbound). */
  readMailbox?: boolean;
  /** Identity (calendar) where meetings are booked. */
  calendarId?: string | null;
  /** CRM connection used to look up and record contacts. */
  crmConnectionId?: string | null;
};

export type AutonomyConfig = {
  /** 0 suggest · 1 draft (approval) · 2 autonomous within limits · 3 autonomous */
  default: number;
  actions?: Record<string, number>;
};
export type LimitsConfig = {
  /** Max executed actions per type per day for the project. */
  daily?: Record<string, number>;
};

export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentType: text("agent_type", { enum: AGENT_TYPES }).notNull(),
    /** When the user added this agent to the project; null = not part of the project. */
    addedAt: timestamp("added_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(false),
    autonomy: jsonb("autonomy").$type<AutonomyConfig>().notNull().default({ default: 1 }),
    limits: jsonb("limits").$type<LimitsConfig>().notNull().default({}),
    /** Mailbox, calendar and CRM this agent works with. */
    channels: jsonb("channels").$type<AgentChannels>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("agent_configs_project_agent_uq").on(t.projectId, t.agentType),
    tenantPolicy("agent_configs"),
  ],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    /** null = applies to every project of the organization. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["email", "domain", "phone"] }).notNull(),
    value: text("value").notNull(),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("suppressions_uq").on(t.orgId, t.projectId, t.type, t.value).nullsNotDistinct(),
    tenantPolicy("suppressions"),
  ],
);

// ---------------------------------------------------------------------------
// Knowledge (the "see" layer)
// ---------------------------------------------------------------------------

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["document", "table", "live", "examples"] }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    syncMode: text("sync_mode", { enum: ["snapshot", "scheduled", "live", "push"] })
      .notNull()
      .default("snapshot"),
    schedule: text("schedule"),
    exposedObjects: jsonb("exposed_objects").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["pending", "ready", "error"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("knowledge_sources_project_idx").on(t.projectId), tenantPolicy("knowledge_sources")],
);

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    uri: text("uri"),
    mimeType: text("mime_type"),
    checksum: text("checksum").notNull(),
    charCount: integer("char_count").notNull().default(0),
    /** Full extracted text, shown when the original file can't be previewed. */
    content: text("content"),
    createdAt: createdAt(),
  },
  (t) => [tenantPolicy("kb_documents")],
);

/** The original uploaded file, kept so people can open what they uploaded. */
export const kbFiles = pgTable(
  "kb_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    sourceId: uuid("source_id")
      .notNull()
      .unique()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [tenantPolicy("kb_files")],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    /** Lower-cased, accent-free copy of `content` (computed by the app) used for search. */
    searchText: text("search_text").notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', search_text)`),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("kb_chunks_tsv_idx").using("gin", t.tsv),
    index("kb_chunks_document_idx").on(t.documentId, t.position),
    tenantPolicy("kb_chunks"),
  ],
);

export type TableColumn = {
  key: string;
  label: string;
  type: "text" | "number" | "integer" | "boolean" | "date";
};

export const knowledgeTables = pgTable(
  "knowledge_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Notes printed above the table in the sheet (e.g. «precios sin IVA»). */
    description: text("description"),
    columns: jsonb("columns").$type<TableColumn[]>().notNull(),
    rowCount: integer("row_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [tenantPolicy("knowledge_tables")],
);

export const knowledgeRows = pgTable(
  "knowledge_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => knowledgeTables.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    data: jsonb("data").$type<Record<string, string | number | boolean | null>>().notNull(),
  },
  (t) => [index("knowledge_rows_table_idx").on(t.tableId, t.rowIndex), tenantPolicy("knowledge_rows")],
);

// ---------------------------------------------------------------------------
// Execution (the "do" layer): actions, approvals, audit
// ---------------------------------------------------------------------------

export const ACTION_STATUSES = [
  "pending_approval",
  "approved",
  "deferred",
  "executing",
  "succeeded",
  "failed",
  "rejected",
  "blocked",
  "cancelled",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export type Citation = {
  sourceId: string;
  /** chunk id, row id or external record reference */
  ref: string;
  excerpt?: string;
};

export type ActionContext = {
  customerType?: "b2b" | "b2c";
  /** Free reference to the contact/deal this action is about (CRM id, email…). */
  subjectRef?: string;
};

export type PolicyOutcome = {
  policy: string;
  outcome: "allow" | "require_approval" | "defer" | "block";
  reason?: string;
  until?: string;
};

export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    agentType: text("agent_type", { enum: AGENT_TYPES }),
    actorType: text("actor_type", { enum: ["agent", "user", "system", "mcp_client"] }).notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Facts about the action that policies need but connectors do not (e.g. customer type). */
    context: jsonb("context").$type<ActionContext>().notNull().default({}),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    reason: text("reason"),
    /** Normalized recipients (email:x, domain:y, phone:z) for suppression and cooldown checks. */
    targetKeys: text("target_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: ACTION_STATUSES }).notNull(),
    autonomyLevel: integer("autonomy_level").notNull(),
    policyResults: jsonb("policy_results").$type<PolicyOutcome[]>().notNull().default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("actions_idempotency_uq").on(t.orgId, t.idempotencyKey),
    index("actions_org_status_idx").on(t.orgId, t.status),
    index("actions_targets_idx").using("gin", t.targetKeys),
    tenantPolicy("actions"),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
    edited: boolean("edited").notNull().default(false),
    editedPayload: jsonb("edited_payload").$type<Record<string, unknown>>(),
    reason: text("reason"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("approvals_action_idx").on(t.actionId), tenantPolicy("approvals")],
);

/** Append-only. The app role may insert and read, never update or delete. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: orgId(),
    projectId: uuid("project_id"),
    actorType: text("actor_type", { enum: ["agent", "user", "system", "mcp_client"] }).notNull(),
    actorId: text("actor_id"),
    event: text("event").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt),
    pgPolicy("audit_log_tenant_read", { for: "select", to: appRole, using: sameOrg }),
    pgPolicy("audit_log_tenant_append", { for: "insert", to: appRole, withCheck: sameOrg }),
  ],
);

/** Raw events received from webhooks, waiting for an agent to process them. */
export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    /** Set when the source already knows the project (forms, project mailboxes). */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    /** Id in the source system (Gmail message id, CRM record id…) used to avoid duplicates. */
    externalId: text("external_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["pending", "processing", "processed", "ignored", "error"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("inbound_events_org_status_idx").on(t.orgId, t.status),
    unique("inbound_events_external_uq").on(t.orgId, t.source, t.externalId),
    tenantPolicy("inbound_events"),
  ],
);

// ---------------------------------------------------------------------------
// Sales process: playbooks, contacts, conversations, agent runs
// ---------------------------------------------------------------------------

export const SALES_MOTIONS = [
  "b2b_consultative",
  "b2b_transactional",
  "b2c_assisted",
  "b2c_self_serve",
  "custom",
] as const;
export type SalesMotion = (typeof SALES_MOTIONS)[number];

export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The agent whose sales process this is (one process per agent). */
    agentConfigId: uuid("agent_config_id")
      .unique()
      .references(() => agentConfigs.id, { onDelete: "cascade" }),
    salesMotion: text("sales_motion", { enum: SALES_MOTIONS }).notNull(),
    /** Agents that follow this playbook. */
    agentTypes: text("agent_types")
      .array()
      .notNull()
      .default(sql`'{inbound}'::text[]`),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("playbooks_project_idx").on(t.projectId), tenantPolicy("playbooks")],
);

export const playbookVersions = pgTable(
  "playbook_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** See server/playbooks/spec.ts */
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [unique("playbook_versions_uq").on(t.playbookId, t.version), tenantPolicy("playbook_versions")],
);

export const CONTACT_STATUSES = [
  "new",
  "contacted",
  "engaged",
  "qualified",
  "disqualified",
  "customer",
  "lost",
] as const;

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    customerType: text("customer_type", { enum: ["b2b", "b2c"] }),
    email: text("email"),
    phone: text("phone"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    crmExternalId: text("crm_external_id"),
    status: text("status", { enum: CONTACT_STATUSES }).notNull().default("new"),
    fitScore: integer("fit_score"),
    legalBasis: text("legal_basis", { enum: ["legitimate_interest", "consent", "contract", "other"] }),
    consentRef: text("consent_ref"),
    dataOrigin: text("data_origin"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("contacts_project_email_uq").on(t.projectId, t.email),
    index("contacts_project_status_idx").on(t.projectId, t.status),
    tenantPolicy("contacts"),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    playbookId: uuid("playbook_id").references(() => playbooks.id, { onDelete: "set null" }),
    channel: text("channel", { enum: ["email", "form", "whatsapp", "phone", "chat", "crm"] }).notNull(),
    externalThreadId: text("external_thread_id"),
    status: text("status", {
      enum: ["open", "waiting_customer", "waiting_us", "handed_off", "closed"],
    })
      .notNull()
      .default("open"),
    classification: text("classification"),
    summary: text("summary"),
    nextStep: text("next_step"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversations_project_status_idx").on(t.projectId, t.status),
    unique("conversations_thread_uq").on(t.projectId, t.channel, t.externalThreadId),
    tenantPolicy("conversations"),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["inbound", "outbound", "internal"] }).notNull(),
    channel: text("channel").notNull(),
    externalId: text("external_id"),
    fromAddress: text("from_address"),
    toAddresses: text("to_addresses")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text("subject"),
    body: text("body").notNull(),
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.sentAt),
    unique("messages_external_uq").on(t.conversationId, t.externalId),
    tenantPolicy("messages"),
  ],
);

export type AgentRunStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError?: boolean };

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentType: text("agent_type", { enum: AGENT_TYPES }).notNull(),
    trigger: text("trigger", { enum: ["inbound_event", "copilot", "manual", "schedule"] }).notNull(),
    triggerRef: text("trigger_ref"),
    playbookVersionId: uuid("playbook_version_id").references(() => playbookVersions.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["running", "completed", "failed", "refused"] })
      .notNull()
      .default("running"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    steps: jsonb("steps").$type<AgentRunStep[]>().notNull().default([]),
    summary: text("summary"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_project_idx").on(t.projectId, t.startedAt), tenantPolicy("agent_runs")],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const projectsRelations = relations(projects, ({ many }) => ({
  identities: many(projectIdentities),
  connections: many(projectConnections),
  meetingTypes: many(meetingTypes),
  knowledgeSources: many(knowledgeSources),
}));

export const projectIdentitiesRelations = relations(projectIdentities, ({ one }) => ({
  project: one(projects, { fields: [projectIdentities.projectId], references: [projects.id] }),
  identity: one(identities, { fields: [projectIdentities.identityId], references: [identities.id] }),
}));

export const projectConnectionsRelations = relations(projectConnections, ({ one }) => ({
  project: one(projects, { fields: [projectConnections.projectId], references: [projects.id] }),
  connection: one(connections, {
    fields: [projectConnections.connectionId],
    references: [connections.id],
  }),
}));

export const identitiesRelations = relations(identities, ({ one }) => ({
  connection: one(connections, { fields: [identities.connectionId], references: [connections.id] }),
}));

export const meetingTypesRelations = relations(meetingTypes, ({ one }) => ({
  project: one(projects, { fields: [meetingTypes.projectId], references: [projects.id] }),
}));

export const knowledgeSourcesRelations = relations(knowledgeSources, ({ one, many }) => ({
  project: one(projects, { fields: [knowledgeSources.projectId], references: [projects.id] }),
  documents: many(kbDocuments),
  tables: many(knowledgeTables),
}));

export const kbDocumentsRelations = relations(kbDocuments, ({ one }) => ({
  source: one(knowledgeSources, { fields: [kbDocuments.sourceId], references: [knowledgeSources.id] }),
}));

export const knowledgeTablesRelations = relations(knowledgeTables, ({ one }) => ({
  source: one(knowledgeSources, {
    fields: [knowledgeTables.sourceId],
    references: [knowledgeSources.id],
  }),
}));

export const actionsRelations = relations(actions, ({ one, many }) => ({
  project: one(projects, { fields: [actions.projectId], references: [projects.id] }),
  approvals: many(approvals),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  action: one(actions, { fields: [approvals.actionId], references: [actions.id] }),
}));
