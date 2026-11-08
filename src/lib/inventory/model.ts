import { z } from "zod";

export const supportedInventoryProviders = ["cloudflare", "upstash", "supabase", "neon", "oracle"] as const;
export const inventoryProviderSchema = z.enum(supportedInventoryProviders);
export type InventoryProvider = z.infer<typeof inventoryProviderSchema>;
export const accountIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/);
const label = z.string().trim().min(1).max(256);
export const resourceCategorySchema = z.enum(["compute", "storage", "database", "serverless", "llm", "network"]);
export const resourceStateSchema = z.enum(["online", "offline", "idle", "busy", "ephemeral", "unknown"]);
export const resourceFactSchema = z.strictObject({
  nativeId: label,
  name: label,
  category: resourceCategorySchema,
  region: z.string().max(128).nullable(),
  state: resourceStateSchema,
  providerState: z.string().max(128).nullable(),
  sourceUrl: z.url().max(2048),
  /** Provider product the fact belongs to (for example worker, kv, d1, r2); lets a scan cover only some products. */
  product: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(),
  /** Whether the provider bills for this resource. Omitted when the listing does not say. */
  billing: z.enum(["free_tier", "billable"]).optional(),
  /** Public, non-secret facts such as compute shape and size; stored with the resource and used for placement. */
  attributes: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), z.union([z.string().max(256), z.number(), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 16).optional(),
});
export type ResourceFact = z.infer<typeof resourceFactSchema>;
export const completeInventorySchema = z.strictObject({
  scope: z.string().min(1).max(512),
  resources: z.array(resourceFactSchema).max(1000),
  /** Products listed completely in this scan. Rows of other products are kept, not retired. Omitted means every product. */
  covered: z.array(z.string().regex(/^[a-z0-9_-]{1,32}$/)).max(32).optional(),
  /** The account plan as the provider reports it. Omitted when the scan could not tell, never guessed. */
  plan: z.enum(["free", "paid"]).optional(),
});
export type CompleteInventory = z.infer<typeof completeInventorySchema>;
export const collectionErrorCodes = ["invalid_config", "credentials_unavailable", "scope_changed", "unauthorized", "rate_limited", "provider_unavailable", "invalid_response", "scan_limit", "scan_timeout", "lease_lost", "unsupported"] as const;
export type CollectionErrorCode = typeof collectionErrorCodes[number];
const messages: Record<CollectionErrorCode, string> = {
  invalid_config: "Management API credentials or account scope are incomplete. Register a new account with the documented fields.",
  credentials_unavailable: "The credential reference is unavailable or outside the configured vault scope.",
  scope_changed: "The provider scope changed. Register a separate account for the new scope.",
  unauthorized: "The provider rejected these credentials or their read permissions.",
  rate_limited: "The provider rate limited inventory requests. Collection will retry with backoff.",
  provider_unavailable: "The provider could not be reached. The previous snapshot is retained.",
  invalid_response: "The provider returned an unexpected or incomplete response. The previous snapshot is retained.",
  scan_limit: "The listing exceeded the scan budget. No partial snapshot was published.",
  scan_timeout: "The collection deadline expired. The previous snapshot is retained.",
  lease_lost: "This collection no longer holds its worker lease.",
  unsupported: "Automatic collection is unavailable for this provider. Use manual inventory.",
};
export class CollectionError extends Error {
  constructor(readonly code: CollectionErrorCode, readonly fields: readonly string[] = []) { super(messages[code]); }
}
export function collectionError(error: unknown): CollectionError {
  return error instanceof CollectionError ? error : new CollectionError("provider_unavailable");
}
export const collectionSchema = z.object({
  state: z.enum(["needs_credentials", "unsupported", "queued", "running", "ready", "error", "stale"]),
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  freshUntil: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  errorCode: z.enum(collectionErrorCodes).nullable(),
  message: z.string(),
  resourceCount: z.number().int().nonnegative(),
});
export const fleetAccountSchema = z.object({
  id: accountIdSchema, kind: z.string(), label: z.string(), identityId: z.string().nullish(), ownerEmail: z.string(), loginEmail: z.string().nullable(),
  health: z.string(), enabled: z.boolean(), isProtected: z.boolean(), collection: collectionSchema,
  credentialExpiresAt: z.string().nullable().default(null),
  archived: z.boolean().optional(),
  plan: z.enum(["free", "paid", "unknown"]).optional(),
});
export const fleetResourceSchema = z.object({
  id: z.string(), accountId: z.string().nullable(), accountEmail: z.string(), provider: z.string(),
  name: z.string(), category: z.string(), state: z.string(), isProtected: z.boolean(),
  tags: z.array(z.string()), attributes: z.record(z.string(), z.number()), lastSeenAt: z.string().nullable(),
  nativeId: z.string().nullable(), region: z.string().nullable(), sourceUrl: z.string().nullable(),
  specs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  billing: z.enum(["free_tier", "billable", "unknown"]).optional(),
  profile: z.object({ set: z.boolean(), role: z.string(), lifecycle: z.string(), backupClass: z.string(), criticality: z.string(), autoStop: z.string(), labels: z.record(z.string(), z.string()), notes: z.string().nullable() }).default({ set: false, role: "general", lifecycle: "always_on", backupClass: "none", criticality: "normal", autoStop: "off", labels: {}, notes: null }),
  inventorySource: z.enum(["manual", "provider"]), presence: z.enum(["present", "missing"]),
  freshness: z.enum(["current", "stale", "unverified"]),
});
export const fleetSnapshotSchema = z.object({
  status: z.literal("online"), timestamp: z.string(), accounts: z.array(fleetAccountSchema), resources: z.array(fleetResourceSchema),
  gateways: z.array(z.unknown()),
  worker: z.object({ status: z.enum(["online", "offline", "unknown"]), lastSeenAt: z.string().nullable() }),
});
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;
export type FleetAccount = z.infer<typeof fleetAccountSchema>;
export type FleetResource = z.infer<typeof fleetResourceSchema>;
export const manualResourceInput = z.strictObject({
  accountId: accountIdSchema, nativeId: label, name: label, category: resourceCategorySchema,
  region: z.string().trim().max(128).optional(),
});

export function retainSnapshotAfterReadFailure(snapshot: FleetSnapshot): FleetSnapshot {
  return {
    ...snapshot,
    accounts: snapshot.accounts.map(account => ({
      ...account,
      collection: {
        ...account.collection,
        state: ["ready", "queued", "running"].includes(account.collection.state) ? "stale" : account.collection.state,
        message: "Refresh failed. This is the previous account status, not a new collection result.",
      },
    })),
    resources: snapshot.resources.map(resource => ({ ...resource, freshness: resource.inventorySource === "provider" ? "stale" : "unverified" })),
    worker: { ...snapshot.worker, status: "unknown" },
  };
}
