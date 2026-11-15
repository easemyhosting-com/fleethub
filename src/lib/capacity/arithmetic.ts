/**
 * Capacity arithmetic, unit normalization, shared allowance accounting,
 * and allocation deduplication across personal and authorized family accounts.
 *
 * Rules:
 * 1. Standardizes storage, compute, and transfer units to common baselines.
 * 2. Models shared allowance pools across accounts without double counting.
 * 3. Deduplicates project allocations so multiple project links to one resource never double-subtract.
 * 4. Preserves unknown, stale, and expired telemetry status rather than guessing zero.
 * 5. Unlike storage types (e.g. ephemeral CDN cache vs durable object storage) are never summed as interchangeable.
 */

// ---------------------------------------------------------------------------
// 1. Storage unit normalization
// ---------------------------------------------------------------------------

function roundedBaseline(value: number): number | null {
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}

export type StorageBinaryUnit = "B" | "KiB" | "MiB" | "GiB" | "TiB";
export type StorageDecimalUnit = "KB" | "MB" | "GB" | "TB";
export type StorageUnit = StorageBinaryUnit | StorageDecimalUnit;

const BINARY_FACTORS: Record<StorageBinaryUnit, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
  TiB: 1024 * 1024 * 1024 * 1024,
};

const DECIMAL_FACTORS: Record<StorageDecimalUnit, number> = {
  KB: 1000,
  MB: 1000 * 1000,
  GB: 1000 * 1000 * 1000,
  TB: 1000 * 1000 * 1000 * 1000,
};

/** Parse a string or number storage value into exact bytes. Returns null if invalid or negative. */
export function parseStorageBytes(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return roundedBaseline(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/.exec(trimmed);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const unitRaw = match[2] ?? "B";
  const unitUpper = unitRaw.toUpperCase();

  if (unitUpper === "B" || unitUpper === "BYTES" || unitUpper === "BYTE") {
    return roundedBaseline(amount);
  }

  // Check binary units
  for (const [unit, factor] of Object.entries(BINARY_FACTORS)) {
    if (unit.toLowerCase() === unitRaw.toLowerCase()) {
      return roundedBaseline(amount * factor);
    }
  }

  // Check decimal units
  for (const [unit, factor] of Object.entries(DECIMAL_FACTORS)) {
    if (unit.toLowerCase() === unitRaw.toLowerCase()) {
      return roundedBaseline(amount * factor);
    }
  }

  // Fallback for single letters like K, M, G, T (interpret as binary K=KiB, G=GiB)
  const single = unitUpper;
  if (single === "K") return roundedBaseline(amount * BINARY_FACTORS.KiB);
  if (single === "M") return roundedBaseline(amount * BINARY_FACTORS.MiB);
  if (single === "G") return roundedBaseline(amount * BINARY_FACTORS.GiB);
  if (single === "T") return roundedBaseline(amount * BINARY_FACTORS.TiB);

  return null;
}

/** Convert bytes to GiB (binary Gibibytes, 2^30 bytes) with 2-decimal precision. */
export function bytesToGiB(bytes: number | null): number | null {
  if (bytes === null || bytes < 0) return null;
  return Math.round((bytes / BINARY_FACTORS.GiB) * 100) / 100;
}

/** Convert bytes to MiB (binary Mebibytes, 2^20 bytes) with 1-decimal precision. */
export function bytesToMiB(bytes: number | null): number | null {
  if (bytes === null || bytes < 0) return null;
  return Math.round((bytes / BINARY_FACTORS.MiB) * 10) / 10;
}

/** Format byte size with human-readable binary unit. */
export function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100} GiB`;
  return `${Math.round((bytes / (1024 * 1024 * 1024 * 1024)) * 100) / 100} TiB`;
}

// ---------------------------------------------------------------------------
// 2. Compute unit normalization
// ---------------------------------------------------------------------------

export type ComputeUnit = "core" | "cores" | "ocpu" | "ocpus" | "vcpu" | "vcpus" | "milli" | "m";

/** Parse compute representation into integer milliCPUs (1 core = 1000m). */
export function parseComputeMilli(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return roundedBaseline(value * 1000);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/.exec(trimmed);
  if (!match) return null;

  const num = Number(match[1]);
  if (!Number.isFinite(num) || num < 0) return null;

  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "m" || unit === "milli" || unit === "millicpu" || unit === "millicpus") {
    return roundedBaseline(num);
  }
  if (!unit || unit === "core" || unit === "cores" || unit === "ocpu" || unit === "ocpus" || unit === "vcpu" || unit === "vcpus") {
    return roundedBaseline(num * 1000);
  }
  return null;
}

/** Convert milliCPUs to decimal cores. */
export function milliToCores(milli: number | null): number | null {
  if (milli === null || milli < 0) return null;
  return Math.round((milli / 1000) * 100) / 100;
}

// ---------------------------------------------------------------------------
// 3. Telemetry Freshness & Unknown State Preservation
// ---------------------------------------------------------------------------

export type TelemetryFreshness = "fresh" | "stale" | "expired" | "unmeasured";

export interface TelemetryReading<T> {
  value: T | null;
  measuredAt: Date | string | null;
  source: string;
}

export const TELEMETRY_FRESH_MS = 60 * 60 * 1000; // 1 hour
export const TELEMETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function evaluateFreshness(
  measuredAt: Date | string | null | undefined,
  now: Date = new Date()
): TelemetryFreshness {
  if (!measuredAt) return "unmeasured";
  const date = typeof measuredAt === "string" ? new Date(measuredAt) : measuredAt;
  if (!Number.isFinite(now.getTime()) || Number.isNaN(date.getTime())) return "unmeasured";

  const ageMs = now.getTime() - date.getTime();
  if (ageMs < -5 * 60 * 1000) return "unmeasured"; // At most five minutes of clock skew
  if (ageMs > TELEMETRY_MAX_AGE_MS) return "expired";
  if (ageMs > TELEMETRY_FRESH_MS) return "stale";
  return "fresh";
}

// ---------------------------------------------------------------------------
// 4. Shared Allowance Pool & Allocation Deduplication
// ---------------------------------------------------------------------------

export type ResourceCategory = "compute" | "storage" | "object_storage" | "cdn" | "database" | "network";

export interface ResourceItem {
  resourceId: string;
  name: string;
  provider: string;
  category: ResourceCategory;
  product: string; // e.g. "r2", "bucket", "a1_flex", "volume"
  accountId: string;
  region?: string | null;
  declaredBytes?: number | null;
  declaredMilliCpu?: number | null;
  declaredMemMi?: number | null;
  observedBytes?: number | null;
  observedMilliCpu?: number | null;
  observedMemMi?: number | null;
  supportedApis?: Array<"s3_compatible" | "oci_native">;
  /** Caller must evaluate the source timestamp; a value alone never implies freshness. */
  telemetryFreshness?: TelemetryFreshness;
}

export interface ProjectResourceBinding {
  projectId: string;
  resourceId: string;
  status: "allocated" | "in_use" | "planned";
}

export interface SharedAllowancePool {
  poolId: string;
  accountId: string;
  provider: string;
  product: string;
  metric: "storage_bytes" | "compute_milli_cpu" | "compute_mem_mi" | "requests_per_month";
  totalAllowance: number; // in baseline units (e.g. bytes, milliCpu, etc.)
  unit: string;
  period: "month" | "day" | "pool" | "none";
  /** True only when the caller verified that all resources in this scope are supplied. */
  inventoryComplete?: boolean;
}

export interface DeduplicatedResourceUsage {
  resourceId: string;
  name: string;
  allocatedBaseline: number;
  observedBaseline: number | null;
  telemetryStatus: TelemetryFreshness;
  projectCount: number;
  projectIds: string[];
}

export interface PoolAccountingResult {
  poolId: string;
  accountId: string;
  provider: string;
  product: string;
  metric: string;
  totalAllowance: number;
  /** Deduplicated sum of all resource allocations in this pool. */
  totalAllocated: number;
  /** Declared budget only, not evidence of free space. Missing declarations contribute no budget. */
  remainingUnallocated: number;
  /** Fresh measured headroom, distinct from declared allocation budgets. */
  remainingObserved: number | null;
  utilizationPct: number | null;
  /** Deduplicated list of resources drawing from this pool. */
  resources: DeduplicatedResourceUsage[];
  /** Flag indicates whether any resource in the pool lacks fresh telemetry. */
  hasUnmeasuredOrStaleTelemetry: boolean;
  /** Human-readable explanation of calculations. */
  notes: string[];
}

/**
 * Calculates remaining capacity for a shared allowance pool across one or more accounts.
 *
 * Guarantees:
 * 1. Multiple project links to the same resource do NOT double-count the resource's allocation.
 * 2. If telemetry is missing or stale, it is marked as such and not assumed to be zero.
 * 3. Never subtracts more than once for any unique resource ID.
 */
export function calculatePoolCapacity(
  pool: SharedAllowancePool,
  resources: ResourceItem[],
  bindings: ProjectResourceBinding[] = []
): PoolAccountingResult {
  // Only instantaneous capacity is supported. Monthly requests need separate usage evidence.
  if (pool.metric === "requests_per_month" || !["none", "pool"].includes(pool.period)) {
    throw new Error("Unsupported pool metric or period");
  }
  if (!Number.isSafeInteger(pool.totalAllowance) || pool.totalAllowance < 0) {
    throw new Error("Invalid baseline allowance");
  }
  // Filter resources that belong to this pool's account and product
  const matchingResources = resources.filter(
    r => r.provider.toLowerCase() === pool.provider.toLowerCase() && r.accountId === pool.accountId && r.product.toLowerCase() === pool.product.toLowerCase()
  );

  // Group project bindings by resourceId to detect multi-project sharing
  const projectsByResource = new Map<string, Set<string>>();
  for (const binding of bindings) {
    if (binding.status === "allocated" || binding.status === "in_use") {
      const set = projectsByResource.get(binding.resourceId) ?? new Set<string>();
      set.add(binding.projectId);
      projectsByResource.set(binding.resourceId, set);
    }
  }

  const deduplicatedResources: DeduplicatedResourceUsage[] = [];
  let totalAllocated = 0;
  let totalObserved = 0;
  let hasUnmeasuredOrStale = pool.inventoryComplete !== true;

  // Track unique resource IDs to guarantee zero double-counting
  const seenResourceIds = new Set<string>();

  for (const r of matchingResources) {
    if (seenResourceIds.has(r.resourceId)) {
      const first = matchingResources.find(resource => resource.resourceId === r.resourceId);
      // Identical join rows are harmless; conflicting evidence cannot establish headroom.
      if (JSON.stringify(first) !== JSON.stringify(r)) hasUnmeasuredOrStale = true;
      continue;
    }
    seenResourceIds.add(r.resourceId);

    let baselineAllocated = 0;
    let baselineObserved: number | null = null;

    if (pool.metric === "storage_bytes") {
      baselineAllocated = r.declaredBytes ?? 0;
      baselineObserved = r.observedBytes ?? null;
    } else if (pool.metric === "compute_milli_cpu") {
      baselineAllocated = r.declaredMilliCpu ?? 0;
      baselineObserved = r.observedMilliCpu ?? null;
    } else if (pool.metric === "compute_mem_mi") {
      baselineAllocated = r.declaredMemMi ?? 0;
      baselineObserved = r.observedMemMi ?? null;
    }

    if (!Number.isSafeInteger(baselineAllocated) || baselineAllocated < 0) {
      throw new Error("Invalid baseline allocation");
    }
    if (baselineObserved !== null && (!Number.isSafeInteger(baselineObserved) || baselineObserved < 0)) {
      baselineObserved = null;
    }
    const freshness: TelemetryFreshness = baselineObserved === null
      ? "unmeasured" : (r.telemetryFreshness ?? "unmeasured");
    totalObserved += baselineObserved ?? 0;
    if (freshness !== "fresh") {
      hasUnmeasuredOrStale = true;
    }

    const boundProjects = Array.from(projectsByResource.get(r.resourceId) ?? []);

    deduplicatedResources.push({
      resourceId: r.resourceId,
      name: r.name,
      allocatedBaseline: baselineAllocated,
      observedBaseline: baselineObserved,
      telemetryStatus: freshness,
      projectCount: boundProjects.length,
      projectIds: boundProjects,
    });

    totalAllocated += baselineAllocated;
    if (!Number.isSafeInteger(totalAllocated) || !Number.isSafeInteger(totalObserved)) {
      throw new Error("Pool total exceeds safe baseline range");
    }
  }

  const remaining = Math.max(0, pool.totalAllowance - totalAllocated);
  const utilizationPct = pool.totalAllowance > 0
    ? Math.round((totalAllocated / pool.totalAllowance) * 1000) / 10
    : null;

  const notes: string[] = [];
  notes.push(`Deduplicated ${deduplicatedResources.length} resource(s) drawing from pool ${pool.poolId}.`);
  if (hasUnmeasuredOrStale) {
    notes.push("Pool membership is incomplete or observations are not fresh; measured headroom is unknown. Declared budgets are separate.");
  }
  if (totalAllocated > pool.totalAllowance) {
    notes.push(`Pool is over-allocated by ${totalAllocated - pool.totalAllowance} ${pool.unit}.`);
  }

  return {
    poolId: pool.poolId,
    accountId: pool.accountId,
    provider: pool.provider,
    product: pool.product,
    metric: pool.metric,
    totalAllowance: pool.totalAllowance,
    totalAllocated,
    remainingUnallocated: remaining,
    remainingObserved: hasUnmeasuredOrStale || deduplicatedResources.length === 0 ? null : Math.max(0, pool.totalAllowance - totalObserved),
    utilizationPct,
    resources: deduplicatedResources,
    hasUnmeasuredOrStaleTelemetry: hasUnmeasuredOrStale,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 5. Object Storage Comparison Slice (EAS-17 Foundation)
// ---------------------------------------------------------------------------

export interface ObjectStorageCandidate {
  resourceId: string;
  name: string;
  provider: string;
  product: string;
  region: string | null;
  accountId: string;
  allocatedBytes: number;
  observedBytes: number | null;
  telemetryFreshness: TelemetryFreshness;
  sharedAllowanceRemainingBytes: number | null;
  projectConsumers: string[];
  reasons: string[];
  fitVerdict: "fits" | "tight" | "over" | "unverified";
}

export interface ObjectStorageNeed {
  estimatedBytes: number;
  preferredRegion?: string | null;
  requiredApi?: "s3_compatible" | "oci_native" | "any";
}

/**
 * Compare object storage buckets across authorized personal/family accounts.
 * Provides fact-based advice without taking irreversible mutation or deployment actions.
 */
export function compareObjectStorageCandidates(
  candidates: ResourceItem[],
  pools: SharedAllowancePool[],
  need: ObjectStorageNeed,
  bindings: ProjectResourceBinding[] = []
): ObjectStorageCandidate[] {
  if (!Number.isSafeInteger(need.estimatedBytes) || need.estimatedBytes < 0) {
    throw new Error("Invalid estimated storage demand");
  }
  const seen = new Set<string>();
  const objectStorageItems = candidates.filter(c => {
    const supported = c.category === "object_storage" ||
      (c.category === "storage" && ["r2", "bucket", "object_storage", "s3"].includes(c.product.toLowerCase()));
    if (!supported || seen.has(c.resourceId)) return false;
    seen.add(c.resourceId);
    return true;
  });

  const results: ObjectStorageCandidate[] = [];

  for (const item of objectStorageItems) {
    const matchingPools = pools.filter(p => p.accountId === item.accountId &&
      p.provider.toLowerCase() === item.provider.toLowerCase() &&
      p.product.toLowerCase() === item.product.toLowerCase() && p.metric === "storage_bytes");
    const pool = matchingPools.length === 1 ? matchingPools[0] : undefined;
    const accounting = pool && ["none", "pool"].includes(pool.period)
      ? calculatePoolCapacity(pool, candidates, bindings) : undefined;
    const remainingPoolBytes = accounting?.remainingObserved ?? null;
    const boundProjects = [...new Set(bindings
      .filter(b => b.resourceId === item.resourceId && (b.status === "allocated" || b.status === "in_use"))
      .map(b => b.projectId))];

    const reasons: string[] = [];
    let fitVerdict: ObjectStorageCandidate["fitVerdict"] = "unverified";

    reasons.push("Egress, request limits, entitlement and access/retention constraints require verification");

    if (item.region) {
      reasons.push(`Region: ${item.region}`);
      if (need.preferredRegion && item.region.toLowerCase() === need.preferredRegion.toLowerCase()) {
        reasons.push("Matches preferred region");
      }
    }

    if (boundProjects.length > 0) {
      reasons.push(`Shared with ${boundProjects.length} existing project(s)`);
    } else {
      reasons.push("No project consumers recorded; actual use is unknown");
    }

    const freshness = item.telemetryFreshness ?? "unmeasured";
    // A known protocol mismatch remains a mismatch even without current usage evidence.
    const apiUnknown = need.requiredApi && need.requiredApi !== "any" && !item.supportedApis;
    const apiMismatch = need.requiredApi && need.requiredApi !== "any" &&
      item.supportedApis && !item.supportedApis.includes(need.requiredApi);
    if (apiMismatch) {
      fitVerdict = "over";
      reasons.push("Required API is not supported");
    } else if (freshness !== "fresh") {
      reasons.push(`Telemetry is ${freshness}: capacity cannot be assumed free`);
    } else {
      // Evaluate based on fresh measured pool usage
      if (apiUnknown) {
        reasons.push("Required API compatibility is unknown");
      } else if (remainingPoolBytes !== null) {
        if (remainingPoolBytes >= need.estimatedBytes) {
          fitVerdict = remainingPoolBytes <= need.estimatedBytes * 1.2 ? "tight" : "fits";
          reasons.push(`Remaining shared pool allowance: ${formatStorageBytes(remainingPoolBytes)}`);
        } else {
          fitVerdict = "over";
          reasons.push(`Insufficient pool allowance (${formatStorageBytes(remainingPoolBytes)} remaining)`);
        }
      } else {
        fitVerdict = "unverified";
        reasons.push("Shared pool usage, scope or allowance is unknown or ambiguous; fit unverified");
      }
    }

    results.push({
      resourceId: item.resourceId,
      name: item.name,
      provider: item.provider,
      product: item.product,
      region: item.region ?? null,
      accountId: item.accountId,
      allocatedBytes: item.declaredBytes ?? 0,
      observedBytes: item.observedBytes ?? null,
      telemetryFreshness: freshness,
      sharedAllowanceRemainingBytes: remainingPoolBytes,
      projectConsumers: boundProjects,
      reasons,
      fitVerdict,
    });
  }

  // Sort order:
  // 1. "fits" > "tight" > "unverified" > "over"
  // 2. Fewer recorded project consumers first
  // 3. Name alphabetical
  const verdictRank: Record<ObjectStorageCandidate["fitVerdict"], number> = {
    fits: 3,
    tight: 2,
    unverified: 1,
    over: 0,
  };

  results.sort((a, b) => {
    const vDiff = verdictRank[b.fitVerdict] - verdictRank[a.fitVerdict];
    if (vDiff !== 0) return vDiff;
    const pDiff = a.projectConsumers.length - b.projectConsumers.length;
    if (pDiff !== 0) return pDiff;
    return a.name.localeCompare(b.name);
  });

  return results;
}
