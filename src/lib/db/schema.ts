import { pgTable, text, boolean, integer, bigint, doublePrecision, timestamp, jsonb, unique } from "drizzle-orm/pg-core";

export const onboardingSteps = pgTable("onboarding_steps", {
  id: text("id").primaryKey().$type<"tailscale" | "infisical" | "cliproxy">(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").default(1).notNull(),
  status: text("status").$type<"configured" | "verified" | "failed">().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  fingerprint: text("fingerprint"),
  verificationId: text("verification_id"),
  skipped: boolean("skipped").default(false).notNull(),
});

export const oauthTransactions = pgTable("oauth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  verifier: text("verifier").notNull(),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
});

export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  googleSub: text("google_sub").unique(),
  name: text("name"),
  authProvider: text("auth_provider").notNull().default("local"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Secret References (Infisical metadata only; zero secret values in the DB)
 */
export const secretRefs = pgTable("secret_refs", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  infisicalProject: text("infisical_project").notNull().default("fleet"),
  vaultUrl: text("vault_url"),
  environment: text("environment").notNull().default("prod"),
  path: text("path").notNull(),
  keys: jsonb("keys").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("verified"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Identities (People or Root Entity records with persistent IDs)
 */
export const identities = pgTable("identities", {
  id: text("id").primaryKey(), // Persistent ID e.g. "ident-uuid" (never an email or phone)
  displayName: text("display_name").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Identity Contacts (Multiple verified/primary emails and phone numbers per identity)
 */
export const identityContacts = pgTable("identity_contacts", {
  id: text("id").primaryKey(),
  identityId: text("identity_id")
    .notNull()
    .references(() => identities.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "email" | "phone"
  value: text("value").notNull(), // e.g. "operator@fleethub.dev" or "+15550100198"
  isPrimary: boolean("is_primary").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  label: text("label"), // "Personal", "Work", "Alerts / SMS"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Provider Accounts (grouped by identity, retaining provider account ID, login email, role, and authoritative protection)
 */
export const providerAccounts = pgTable("provider_accounts", {
  id: text("id").primaryKey(), // Unique provider-account ID e.g. "acc-operator-main"
  identityId: text("identity_id").references(() => identities.id),
  kind: text("kind").notNull(), // "oracle" | "cloudflare" | "upstash" | "github" | "freellmapi" | "google" | "nvidia"
  label: text("label").notNull(),
  ownerEmail: text("owner_email").notNull(), // Preserved for backwards-compatibility & backfill audit
  loginEmail: text("login_email"), // Provider-specific login email
  role: text("role").notNull().default("member"), // "production_brain" | "dns_control" | "worker_ephemeral" | "admin" | "member"
  isProtected: boolean("is_protected").notNull().default(false), // Authoritative protection flag stored in DB
  secretRefId: text("secret_ref_id").references(() => secretRefs.id),
  health: text("health").notNull().default("ok"),
  healthDetail: text("health_detail"),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  notes: text("notes"),
  enabled: boolean("enabled").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }), // Set when the owner stops tracking the account; history is kept
  plan: text("plan").notNull().default("unknown"), // "free" | "paid" | "unknown"
  planSource: text("plan_source").notNull().default("manual"), // "detected" | "manual"
  contactId: text("contact_id").references(() => identityContacts.id, { onDelete: "set null" }), // the owning email under the person
  scopeId: text("scope_id"), // Non-secret provider scope (OCI tenancy, Cloudflare account id) used to spot duplicates
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Unified Resources Table (Compute nodes, storage buckets, DB instances, LLM gateways)
 */
export const resources = pgTable("resources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // "compute" | "storage" | "database" | "serverless" | "llm"
  provider: text("provider").notNull(),
  accountId: text("account_id").references(() => providerAccounts.id),
  nativeId: text("native_id"),
  region: text("region"),
  sourceUrl: text("source_url"),
  inventorySource: text("inventory_source").notNull().default("manual"),
  scanGeneration: integer("scan_generation"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  providerState: text("provider_state"),
  accountEmail: text("account_email").notNull(),
  state: text("state").notNull().default("online"), // "online" | "idle" | "busy" | "offline" | "ephemeral"
  isProtected: boolean("is_protected").notNull().default(false),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accountCollections = pgTable("account_collections", {
  accountId: text("account_id").primaryKey().references(() => providerAccounts.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("queued"),
  scopeHash: text("scope_hash"),
  credentialHash: text("credential_hash"),
  generation: integer("generation").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  errorCode: text("error_code"),
});

export const inventoryWorker = pgTable("inventory_worker", {
  id: integer("id").primaryKey(),
  processId: text("process_id").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

/**
 * Quota Meters (defined from catalog, tracking limits and reset windows)
 */
export const quotaMeters = pgTable("quota_meters", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => providerAccounts.id),
  key: text("key").notNull(), // e.g. "oci.a1.ocpu_hours"
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  limitValue: doublePrecision("limit_value").notNull(),
  warnPct: integer("warn_pct").notNull().default(80),
  critPct: integer("crit_pct").notNull().default(95),
  source: text("source").notNull().default("api"), // "api" | "derived" | "manual" | "none"
  window: jsonb("window").notNull(), // ResetWindow object
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Quota Telemetry Samples (historical observations)
 */
export const quotaSamples = pgTable("quota_samples", {
  id: text("id").primaryKey(),
  meterId: text("meter_id").notNull().references(() => quotaMeters.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  value: doublePrecision("value").notNull(),
  method: text("method").notNull().default("api"),
});

/**
 * Network Gateways (Egress proxies & Tailscale exit nodes)
 */
export const networkGateways = pgTable("network_gateways", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // "tailscale_exit_node"
  tailscaleIp: text("tailscale_ip").notNull(),
  port: integer("port").notNull().default(8888),
  state: text("state").notNull().default("online"),
  latencyMs: integer("latency_ms").default(12),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Audit Log (auditing every action executed via FleetHub)
 */
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}),
});

export const externalObservations = pgTable("external_observations", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  reporterId: text("reporter_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  source: text("source").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  facts: jsonb("facts").notNull(),
}, table => [unique().on(table.reporterId, table.idempotencyKey)]);
