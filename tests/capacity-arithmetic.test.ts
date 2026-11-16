import { describe, expect, it } from "vitest";
import {
  parseStorageBytes,
  bytesToGiB,
  bytesToMiB,
  formatStorageBytes,
  parseComputeMilli,
  milliToCores,
  evaluateFreshness,
  calculatePoolCapacity,
  compareObjectStorageCandidates,
  type SharedAllowancePool,
  type ResourceItem,
  type ProjectResourceBinding,
  type ObjectStorageNeed,
} from "../src/lib/capacity/arithmetic";

describe("Storage unit normalization", () => {
  it("parses raw numbers and standard strings accurately to bytes", () => {
    expect(parseStorageBytes(1024)).toBe(1024);
    expect(parseStorageBytes("1024")).toBe(1024);
    expect(parseStorageBytes("1024 B")).toBe(1024);
    expect(parseStorageBytes("1 KiB")).toBe(1024);
    expect(parseStorageBytes("1 MiB")).toBe(1024 * 1024);
    expect(parseStorageBytes("1 GiB")).toBe(1024 * 1024 * 1024);
    expect(parseStorageBytes("1 TiB")).toBe(1024 * 1024 * 1024 * 1024);

    // Decimal units
    expect(parseStorageBytes("1 KB")).toBe(1000);
    expect(parseStorageBytes("1 MB")).toBe(1000000);
    expect(parseStorageBytes("1 GB")).toBe(1000000000);
    expect(parseStorageBytes("1 TB")).toBe(1000000000000);

    // Single-letter fallback
    expect(parseStorageBytes("10G")).toBe(10 * 1024 * 1024 * 1024);
    expect(parseStorageBytes("512M")).toBe(512 * 1024 * 1024);
  });

  it("handles null, undefined, invalid, and negative inputs safely without throwing", () => {
    expect(parseStorageBytes(null)).toBeNull();
    expect(parseStorageBytes(undefined)).toBeNull();
    expect(parseStorageBytes("")).toBeNull();
    expect(parseStorageBytes("   ")).toBeNull();
    expect(parseStorageBytes("invalid")).toBeNull();
    expect(parseStorageBytes("-500B")).toBeNull();
    expect(parseStorageBytes(-100)).toBeNull();
  });

  it("converts bytes to GiB and MiB with correct precision", () => {
    expect(bytesToGiB(10 * 1024 * 1024 * 1024)).toBe(10);
    expect(bytesToGiB(1.5 * 1024 * 1024 * 1024)).toBe(1.5);
    expect(bytesToGiB(null)).toBeNull();

    expect(bytesToMiB(256 * 1024 * 1024)).toBe(256);
    expect(bytesToMiB(null)).toBeNull();
  });

  it("formats storage bytes into readable units", () => {
    expect(formatStorageBytes(null)).toBe("Unknown size");
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(2048)).toBe("2 KiB");
    expect(formatStorageBytes(10 * 1024 * 1024)).toBe("10 MiB");
    expect(formatStorageBytes(5 * 1024 * 1024 * 1024)).toBe("5 GiB");
  });
});

describe("Compute unit normalization", () => {
  it("normalizes cores, OCPUs, vCPUs and milli to integer milliCPUs", () => {
    expect(parseComputeMilli(1)).toBe(1000);
    expect(parseComputeMilli("1")).toBe(1000);
    expect(parseComputeMilli("1 core")).toBe(1000);
    expect(parseComputeMilli("2 cores")).toBe(2000);
    expect(parseComputeMilli("2 OCPU")).toBeNull();
    expect(parseComputeMilli("2 OCPU", { arch: "arm64" })).toBe(2000);
    expect(parseComputeMilli("2 OCPU", { arch: "amd64" })).toBe(4000);
    expect(parseComputeMilli("2 vcpu", { arch: "amd64" })).toBe(2000);
    expect(parseComputeMilli("4 vcpu")).toBe(4000);
    expect(parseComputeMilli("500m")).toBe(500);
    expect(parseComputeMilli("250 milli")).toBe(250);
    expect(parseComputeMilli("250 milliCPUs")).toBe(250);
  });

  it("converts milli to decimal cores", () => {
    expect(milliToCores(1500)).toBe(1.5);
    expect(milliToCores(1000)).toBe(1);
    expect(milliToCores(null)).toBeNull();
  });

  it("rejects invalid or negative compute values", () => {
    expect(parseComputeMilli(null)).toBeNull();
    expect(parseComputeMilli("-2 cores")).toBeNull();
    expect(parseComputeMilli("fast-cpu")).toBeNull();
  });
});

describe("Telemetry Freshness & Unknown State Preservation", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("marks recent reading as fresh (< 1 hour)", () => {
    const halfHourAgo = new Date("2026-11-15T11:30:00Z");
    expect(evaluateFreshness(halfHourAgo, now)).toBe("fresh");
  });

  it("marks readings between 1h and 24h as stale", () => {
    const twoHoursAgo = new Date("2026-11-15T10:00:00Z");
    expect(evaluateFreshness(twoHoursAgo, now)).toBe("stale");
  });

  it("marks readings older than 24h as expired", () => {
    const twoDaysAgo = new Date("2026-11-13T12:00:00Z");
    expect(evaluateFreshness(twoDaysAgo, now)).toBe("expired");
  });

  it("preserves unmeasured status when timestamp is missing or invalid", () => {
    expect(evaluateFreshness(null, now)).toBe("unmeasured");
    expect(evaluateFreshness(undefined, now)).toBe("unmeasured");
    expect(evaluateFreshness("invalid-date", now)).toBe("unmeasured");
  });
});

describe("Shared Allowance Pool & Deduplicated Allocations", () => {
  const pool: SharedAllowancePool = {
    poolId: "pool-cf-r2-1",
    accountId: "cf-acc-123",
    provider: "cloudflare",
    product: "r2",
    metric: "storage_bytes",
    totalAllowance: 10 * 1024 * 1024 * 1024, // 10 GiB free tier
    unit: "GiB",
    period: "none",
    inventoryComplete: true,
  };

  const bucket1: ResourceItem = {
    resourceId: "res-b1",
    name: "media-assets",
    provider: "cloudflare",
    category: "storage",
    product: "r2",
    accountId: "cf-acc-123",
    declaredBytes: 3 * 1024 * 1024 * 1024, // 3 GiB
    observedBytes: 2.5 * 1024 * 1024 * 1024,
    telemetryFreshness: "fresh",
  };

  const bucket2: ResourceItem = {
    resourceId: "res-b2",
    name: "user-backups",
    provider: "cloudflare",
    category: "storage",
    product: "r2",
    accountId: "cf-acc-123",
    declaredBytes: 2 * 1024 * 1024 * 1024, // 2 GiB
    observedBytes: null,
    telemetryFreshness: "unmeasured",
  };

  it("models shared allowance across multiple buckets under same account", () => {
    const result = calculatePoolCapacity(pool, [bucket1, bucket2], []);
    expect(result.totalAllocated).toBe(5 * 1024 * 1024 * 1024); // 3 + 2 = 5 GiB
    expect(result.remainingUnallocated).toBe(5 * 1024 * 1024 * 1024); // 10 - 5 = 5 GiB
    expect(result.utilizationPct).toBe(50);
    expect(result.resources.length).toBe(2);
  });

  it("deduplicates project allocations: multiple projects linking to one resource do NOT double count", () => {
    // Project A and Project B both use bucket1
    const bindings: ProjectResourceBinding[] = [
      { projectId: "proj-alpha", resourceId: "res-b1", status: "allocated" },
      { projectId: "proj-beta", resourceId: "res-b1", status: "allocated" },
      { projectId: "proj-gamma", resourceId: "res-b1", status: "in_use" },
    ];

    const result = calculatePoolCapacity(pool, [bucket1], bindings);
    // Even though 3 projects link to res-b1, totalAllocated MUST be exactly 3 GiB, NOT 9 GiB!
    expect(result.totalAllocated).toBe(3 * 1024 * 1024 * 1024);
    expect(result.remainingUnallocated).toBe(7 * 1024 * 1024 * 1024);
    expect(result.resources[0].projectCount).toBe(3);
    expect(result.resources[0].projectIds).toEqual(["proj-alpha", "proj-beta", "proj-gamma"]);
  });

  it("preserves unmeasured/stale telemetry rather than guessing zero", () => {
    const result = calculatePoolCapacity(pool, [bucket2], []);
    expect(result.hasUnmeasuredOrStaleTelemetry).toBe(true);
    expect(result.resources[0].telemetryStatus).toBe("unmeasured");
    expect(result.resources[0].observedBaseline).toBeNull();
    // Does NOT assume 0 allocation; relies on declaredBytes
    expect(result.totalAllocated).toBe(2 * 1024 * 1024 * 1024);
  });
});

describe("Object Storage Comparison Slice", () => {
  const poolR2: SharedAllowancePool = {
    poolId: "pool-r2",
    accountId: "cf-acc-1",
    provider: "cloudflare",
    product: "r2",
    metric: "storage_bytes",
    totalAllowance: 10 * 1024 * 1024 * 1024,
    unit: "GiB",
    period: "none",
    inventoryComplete: true,
  };

  const poolOci: SharedAllowancePool = {
    poolId: "pool-oci",
    accountId: "oci-acc-1",
    provider: "oracle",
    product: "bucket",
    metric: "storage_bytes",
    totalAllowance: 10 * 1024 * 1024 * 1024,
    unit: "GiB",
    period: "pool",
    inventoryComplete: true,
  };

  const candidates: ResourceItem[] = [
    {
      resourceId: "r2-b1",
      name: "photos",
      provider: "cloudflare",
      category: "storage",
      product: "r2",
      region: "auto",
      accountId: "cf-acc-1",
      declaredBytes: 2 * 1024 * 1024 * 1024, // 2 GiB
      observedBytes: 2 * 1024 * 1024 * 1024,
      telemetryFreshness: "fresh",
    },
    {
      resourceId: "oci-b1",
      name: "archive-bucket",
      provider: "oracle",
      category: "storage",
      product: "bucket",
      region: "ap-mumbai-1",
      accountId: "oci-acc-1",
      declaredBytes: 1 * 1024 * 1024 * 1024, // 1 GiB
      observedBytes: 1 * 1024 * 1024 * 1024,
      telemetryFreshness: "fresh",
    },
    {
      resourceId: "unmeasured-b1",
      name: "mystery-bucket",
      provider: "cloudflare",
      category: "storage",
      product: "r2",
      region: null,
      accountId: "cf-acc-1",
      declaredBytes: 0,
      observedBytes: null,
      telemetryFreshness: "unmeasured",
    },
  ];

  it("ranks candidates that fit within shared allowance and highlights tradeoffs", () => {
    const need: ObjectStorageNeed = {
      estimatedBytes: 3 * 1024 * 1024 * 1024, // 3 GiB needed
      preferredRegion: "ap-mumbai-1",
    };

    const results = compareObjectStorageCandidates(candidates, [poolR2, poolOci], need);
    expect(results.length).toBe(3);

    // Unknown sibling usage makes shared headroom unknown
    const photos = results.find(r => r.name === "photos");
    expect(photos?.fitVerdict).toBe("unverified");
    expect(photos?.sharedAllowanceRemainingBytes).toBeNull();

    // OCI bucket fits within 9 GiB remaining OCI allowance, and matches preferred region
    const oci = results.find(r => r.name === "archive-bucket");
    expect(oci?.fitVerdict).toBe("fits");
    expect(oci?.reasons).toContain("Matches preferred region");

    // Mystery bucket has unmeasured telemetry: marked unverified, not fits!
    const mystery = results.find(r => r.name === "mystery-bucket");
    expect(mystery?.fitVerdict).toBe("unverified");
    expect(mystery?.reasons.some(r => r.includes("Telemetry is unmeasured"))).toBe(true);
  });
});

describe("Capacity advice regressions", () => {
  const pool: SharedAllowancePool = {
    poolId: "pool", accountId: "account", provider: "manual", product: "s3",
    metric: "storage_bytes", totalAllowance: 100, unit: "B", period: "none", inventoryComplete: true,
  };
  const item: ResourceItem = {
    resourceId: "bucket", name: "bucket", accountId: "account", provider: "manual",
    category: "object_storage", product: "s3", observedBytes: 95,
    telemetryFreshness: "fresh", supportedApis: ["s3_compatible"],
  };
  const compare = (items = [item], pools = [pool], need: ObjectStorageNeed = { estimatedBytes: 20 }) =>
    compareObjectStorageCandidates(items, pools, need);

  it("uses observed usage independently of declarations without subtracting twice", () => {
    expect(compare()[0].fitVerdict).toBe("over");
    const accounting = calculatePoolCapacity(pool, [{ ...item, declaredBytes: 80 }]);
    expect(accounting.remainingUnallocated).toBe(20);
    expect(accounting.remainingObserved).toBe(5);
  });

  it.each(["stale", "expired", "unmeasured"] as const)("preserves %s pool usage as unknown", telemetryFreshness => {
    const sibling = { ...item, resourceId: "sibling", telemetryFreshness };
    expect(compare([item, sibling])[0].fitVerdict).toBe("unverified");
    expect(compare([{ ...item, telemetryFreshness }])[0].fitVerdict).toBe("unverified");
  });

  it("does not infer freshness from a value or a fresh label without a value", () => {
    expect(compare([{ ...item, telemetryFreshness: undefined }])[0].fitVerdict).toBe("unverified");
    expect(compare([{ ...item, observedBytes: null }])[0].fitVerdict).toBe("unverified");
  });

  it("rejects incompatible APIs and preserves unknown compatibility", () => {
    const need: ObjectStorageNeed = { estimatedBytes: 1, requiredApi: "oci_native" };
    expect(compare([item], [pool], need)[0].fitVerdict).toBe("over");
    expect(compare([{ ...item, supportedApis: undefined }], [pool], need)[0].fitVerdict).toBe("unverified");
  });

  it("keeps providers separate and refuses ambiguous or periodic pools", () => {
    expect(calculatePoolCapacity({ ...pool, provider: "other" }, [item]).resources).toHaveLength(0);
    expect(compare([item], [{ ...pool, provider: "other" }])[0].fitVerdict).toBe("unverified");
    expect(compare([item], [pool, { ...pool, poolId: "other" }])[0].fitVerdict).toBe("unverified");
    expect(compare([item], [{ ...pool, period: "month" }])[0].fitVerdict).toBe("unverified");
    expect(() => calculatePoolCapacity({ ...pool, metric: "requests_per_month" }, [item])).toThrow();
  });

  it("deduplicates candidate rows and consumers", () => {
    const binding: ProjectResourceBinding = { resourceId: item.resourceId, projectId: "project", status: "in_use" };
    const result = compareObjectStorageCandidates([item, item], [pool], { estimatedBytes: 1 }, [binding, binding]);
    expect(result).toHaveLength(1);
    expect(result[0].sharedAllowanceRemainingBytes).toBe(5);
    expect(result[0].projectConsumers).toEqual(["project"]);
  });

  it("refuses conflicting duplicate observations regardless of row order", () => {
    const conflicting = { ...item, observedBytes: 1 };
    for (const items of [[item, conflicting], [conflicting, item]]) {
      expect(compare(items)[0].fitVerdict).toBe("unverified");
    }
  });

  it("requires complete membership before reporting measured pool headroom", () => {
    expect(compare([item], [{ ...pool, inventoryComplete: undefined }])[0].fitVerdict).toBe("unverified");
    expect(calculatePoolCapacity(pool, []).remainingObserved).toBeNull();
  });

  it("keeps compute observations separate from declared budgets", () => {
    const cpu = calculatePoolCapacity({ ...pool, metric: "compute_milli_cpu" },
      [{ ...item, declaredMilliCpu: 20, observedMilliCpu: 95 }]);
    expect(cpu.remainingObserved).toBe(5);
    expect(cpu.remainingUnallocated).toBe(80);
    const memory = calculatePoolCapacity({ ...pool, metric: "compute_mem_mi" },
      [{ ...item, declaredMemMi: 20, observedMemMi: 90 }]);
    expect(memory.remainingObserved).toBe(10);
  });

  it("rejects invalid units, unsafe numbers, demand and future timestamps", () => {
    expect(parseStorageBytes("1 garbage")).toBeNull();
    expect(parseStorageBytes("999999999999999 TB")).toBeNull();
    expect(parseComputeMilli(Number.MAX_VALUE)).toBeNull();
    expect(() => compare([item], [pool], { estimatedBytes: -1 })).toThrow();
    expect(evaluateFreshness("2099-01-01", new Date("2026-11-16"))).toBe("unmeasured");
    expect(evaluateFreshness("2026-11-16", new Date("invalid"))).toBe("unmeasured");
  });
});
