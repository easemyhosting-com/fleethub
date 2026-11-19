import { z } from "zod";

/** Service families used to group freebies across providers (docs/freebies/README.md). */
export const FreebieCategorySchema = z.enum([
  "compute", "storage", "database", "networking", "email", "observability", "security", "messaging", "serverless", "devtools",
]);
export type FreebieCategory = z.infer<typeof FreebieCategorySchema>;

/**
 * How the allowance is measured. `capacity` is a standing ceiling (200 GB, 2 VMs), `monthly` resets each
 * month, `rate` is per hour or per second, `count` is a number of objects, `unlimited` has no stated cap,
 * and `none` means no free allowance was found.
 */
export const FreebieLimitTypeSchema = z.enum(["capacity", "monthly", "rate", "count", "unlimited", "none"]);
export type FreebieLimitType = z.infer<typeof FreebieLimitTypeSchema>;

export const FreebieScopeSchema = z.enum(["per_tenancy", "per_account", "per_region", "per_resource"]);
export type FreebieScope = z.infer<typeof FreebieScopeSchema>;

/** `verified`: read on the provider's own documentation. `marketing`: provider marketing page only. `unverified`: secondary source or the page could not be read. */
export const FreebieVerificationSchema = z.enum(["verified", "marketing", "unverified"]);
export type FreebieVerification = z.infer<typeof FreebieVerificationSchema>;

/** Generic workload patterns an entry can serve. They describe uses, never a particular fleet. */
export const FreebieFitTagSchema = z.enum([
  "small-vm-host", "uptime-probe", "offsite-backups", "alert-email", "alert-push", "break-glass-secrets",
  "tls-certificates", "ingress-ip", "admin-access", "metrics-alarms", "log-archive", "iac-runner",
  "image-mirror", "scratch-database", "event-functions",
]);
export type FreebieFitTag = z.infer<typeof FreebieFitTagSchema>;

export const FreebieCaveatSchema = z.object({
  kind: z.enum(["reclamation", "egress", "shared_quota", "home_region", "blocked_port", "coupling", "other"]),
  text: z.string().min(1),
  /** Entry ids that draw from the same pool, for `shared_quota`. */
  sharesWith: z.array(z.string()).optional(),
}).strict();
export type FreebieCaveat = z.infer<typeof FreebieCaveatSchema>;

export const FreebieLimitSchema = z.object({
  type: FreebieLimitTypeSchema,
  /** Primary numeric value; null when the provider states no number. */
  value: z.number().nonnegative().nullable(),
  unit: z.string().min(1).nullable(),
  /** Human-readable statement of the full allowance. */
  note: z.string().min(1),
}).strict();
export type FreebieLimit = z.infer<typeof FreebieLimitSchema>;

export const FreebieEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  provider: z.string().regex(/^[a-z0-9-]+$/),
  providerName: z.string().min(1),
  service: z.string().min(1),
  category: FreebieCategorySchema,
  limit: FreebieLimitSchema,
  scope: FreebieScopeSchema,
  homeRegionOnly: z.boolean().nullable(),
  caveats: z.array(FreebieCaveatSchema),
  sourceUrl: z.string().url().startsWith("https://"),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verification: FreebieVerificationSchema,
  suggestedUses: z.array(z.string().min(1)),
  fitTags: z.array(FreebieFitTagSchema),
}).strict();
export type FreebieEntry = z.infer<typeof FreebieEntrySchema>;
