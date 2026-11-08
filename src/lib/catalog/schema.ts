import { z } from "zod";

/**
 * 5 Reset Window shapes supported across providers (docs/17)
 */
export const ResetWindowSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), tz: z.string().default("UTC") }),
  z.object({ kind: z.literal("calendar_month"), tz: z.string().default("UTC") }),
  z.object({ kind: z.literal("billing_cycle"), anchor: z.literal("account") }),
  z.object({ kind: z.literal("rolling"), days: z.number().int().positive() }),
  z.object({ kind: z.literal("session_duration"), maxHours: z.number().positive() }),
  z.object({ kind: z.literal("none") }),
]);

export type ResetWindow = z.infer<typeof ResetWindowSchema>;

/**
 * Observability confidence levels
 */
export const ObservabilityMethodSchema = z.enum(["api", "derived", "manual", "none"]);
export type ObservabilityMethod = z.infer<typeof ObservabilityMethodSchema>;

export const MeterUnitSchema = z.enum([
  "requests",
  "commands",
  "hours",
  "gpu_hours",
  "ocpu_hours",
  "gb_month",
  "gb",
  "minutes",
  "usd",
  "ops",
  "instances",
  "count",
]);
export type MeterUnit = z.infer<typeof MeterUnitSchema>;

export const QuotaMeterDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["compute", "storage", "database", "serverless", "llm", "network"]),
  unit: MeterUnitSchema,
  limit: z.number().nonnegative(),
  scope: z.enum(["account", "project", "database", "instance", "identity"]),
  window: ResetWindowSchema,
  onExceed: z.enum(["error", "throttle", "pause", "bill", "suspend", "stop", "unknown"]),
  observe: z.object({
    method: ObservabilityMethodSchema,
    endpoint: z.string().optional(),
    tokenScope: z.string().optional(),
  }),
  sourceUrl: z.string().url(),
  verifiedAt: z.string(),
  notes: z.string().optional(),
});
export type QuotaMeterDefinition = z.infer<typeof QuotaMeterDefinitionSchema>;

export const ProviderPolicySchema = z.object({
  multiAccount: z.enum(["prohibited", "restricted", "allowed", "unspecified"]),
  singleAccountMandated: z.boolean(),
  orgAlternative: z.boolean(),
  clause: z.string().nullable().optional(),
  clauseUrl: z.string().url().nullable().optional(),
  verifiedAt: z.string(),
});
export type ProviderPolicy = z.infer<typeof ProviderPolicySchema>;

export const ProviderCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(["always_free", "monthly_credits", "trial", "freemium"]),
  description: z.string(),
  policy: ProviderPolicySchema,
  quotas: z.array(QuotaMeterDefinitionSchema),
});
export type ProviderCatalogItem = z.infer<typeof ProviderCatalogItemSchema>;
