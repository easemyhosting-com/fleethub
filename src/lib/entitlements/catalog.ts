export type Verification = "verified" | "reported" | "unverified";
export type Period = "day" | "month" | "pool" | "none";

export interface CatalogEntry {
  id: string;
  provider: string;
  product: string;
  metric: string;
  label: string;
  limit: number;
  unit: string;
  period: Period;
  resetsRule?: string;
  verification: Verification;
  /** ISO date the figure was last checked against the source. Absent for unverified figures. */
  verifiedAt?: string;
  sourceUrl?: string;
  note?: string;
}

/** Bump when entries change; rows the owner has edited are never overwritten by a newer catalog. */
export const catalogVersion = 1;

const cf = "https://developers.cloudflare.com";
const checked = "2026-10-28";

/**
 * Free-tier limits change often. Each figure records how sure we are: verified (read from the provider's own page),
 * reported (stated by the owner, not yet checked) or unverified (third-party summary or memory). Unverified figures are
 * shown but must not be used to claim capacity is available.
 */
export const catalog: readonly CatalogEntry[] = [
  { id: "cloudflare.workers_ai.neurons", provider: "cloudflare", product: "workers_ai", metric: "neurons", label: "Workers AI neurons", limit: 10000, unit: "neurons", period: "day", resetsRule: "00:00 UTC daily", verification: "verified", verifiedAt: checked, sourceUrl: `${cf}/workers-ai/platform/pricing/`, note: "Shared across all models; requests fail on the free plan after the allocation." },
  { id: "cloudflare.workers.requests", provider: "cloudflare", product: "workers", metric: "requests", label: "Workers requests", limit: 100000, unit: "requests", period: "day", resetsRule: "00:00 UTC daily", verification: "unverified", sourceUrl: `${cf}/workers/platform/pricing/`, note: "From a third-party summary; also 10 ms CPU per request." },
  { id: "cloudflare.kv.reads", provider: "cloudflare", product: "kv", metric: "reads", label: "KV reads", limit: 100000, unit: "reads", period: "day", verification: "unverified", sourceUrl: `${cf}/kv/platform/pricing/` },
  { id: "cloudflare.kv.writes", provider: "cloudflare", product: "kv", metric: "writes", label: "KV writes", limit: 1000, unit: "writes", period: "day", verification: "unverified", sourceUrl: `${cf}/kv/platform/pricing/` },
  { id: "cloudflare.kv.storage_gb", provider: "cloudflare", product: "kv", metric: "storage", label: "KV storage", limit: 1, unit: "GB", period: "none", verification: "unverified", sourceUrl: `${cf}/kv/platform/pricing/` },
  { id: "cloudflare.r2.storage_gb", provider: "cloudflare", product: "r2", metric: "storage", label: "R2 storage", limit: 10, unit: "GB", period: "none", verification: "unverified", sourceUrl: `${cf}/r2/pricing/`, note: "No egress fees." },
  { id: "cloudflare.d1.rows_read", provider: "cloudflare", product: "d1", metric: "rows_read", label: "D1 rows read", limit: 5000000, unit: "rows", period: "day", verification: "unverified", sourceUrl: `${cf}/d1/platform/pricing/`, note: "From memory; check before relying on it." },
  { id: "cloudflare.d1.rows_written", provider: "cloudflare", product: "d1", metric: "rows_written", label: "D1 rows written", limit: 100000, unit: "rows", period: "day", verification: "unverified", sourceUrl: `${cf}/d1/platform/pricing/`, note: "From memory; check before relying on it." },
  { id: "cloudflare.d1.storage_gb", provider: "cloudflare", product: "d1", metric: "storage", label: "D1 storage", limit: 5, unit: "GB", period: "none", verification: "unverified", sourceUrl: `${cf}/d1/platform/pricing/`, note: "From memory; check before relying on it." },
  { id: "oci.a1.ocpu", provider: "oci", product: "a1_flex", metric: "ocpu", label: "Ampere A1 OCPU per tenancy", limit: 2, unit: "OCPU", period: "pool", verification: "reported", note: "Reported by the owner on 2026-10-28 after Oracle reduced the allowance in mid-2026; check Oracle's Always Free page." },
  { id: "oci.a1.memory_gb", provider: "oci", product: "a1_flex", metric: "memory", label: "Ampere A1 memory per tenancy", limit: 12, unit: "GB", period: "pool", verification: "reported", note: "Reported by the owner on 2026-10-28; check Oracle's Always Free page." },
  { id: "upstash.box.cpu_hours", provider: "upstash", product: "box", metric: "cpu_hours", label: "Upstash Box active CPU hours per account", limit: 5, unit: "hours", period: "month", verification: "verified", verifiedAt: checked, sourceUrl: "https://upstash.com/pricing/box", note: "Active CPU time only; a box idle for an hour pauses itself. Up to 10 concurrent boxes, 2 CPU / 4 GB / 10 GB each." },
  { id: "upstash.box.concurrent", provider: "upstash", product: "box", metric: "concurrent", label: "Upstash Box concurrent boxes per account", limit: 10, unit: "boxes", period: "none", verification: "verified", verifiedAt: checked, sourceUrl: "https://upstash.com/pricing/box" },
];
