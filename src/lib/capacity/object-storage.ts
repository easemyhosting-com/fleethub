import { z } from "zod";
import { compareObjectStorageCandidates, evaluateFreshness } from "./arithmetic";

const label = z.string().trim().min(1).max(120);
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stamp = z.iso.datetime({ offset: true }).nullable();
const evidence = z.strictObject({ source: label, measuredAt: stamp });

/** Manual snapshots are declarations, not proof of provider entitlement or live collection. */
export const objectStorageComparisonInput = z.strictObject({
  need: z.strictObject({
    estimatedBytes: bytes,
    preferredRegion: label.optional(),
    requiredApi: z.enum(["s3_compatible", "oci_native", "any"]).default("any"),
  }),
  pools: z.array(z.strictObject({
    poolId: label, accountId: label, provider: label, product: label,
    allowanceBytes: bytes, inventoryComplete: z.boolean(), evidence,
  })).min(1).max(20),
  resources: z.array(z.strictObject({
    resourceId: label, name: label, poolId: label, region: label.nullable(),
    observedBytes: bytes.nullable(), declaredBytes: bytes.nullable(), evidence,
    supportedApis: z.array(z.enum(["s3_compatible", "oci_native"])).max(2).optional(),
    consumers: z.array(label).max(50),
    egressNote: label.nullable(), requestNote: label.nullable(),
  })).min(1).max(100),
}).superRefine((input, ctx) => {
  const poolIds = new Set(input.pools.map(pool => pool.poolId));
  const ids = input.resources.map(resource => resource.resourceId);
  if (poolIds.size !== input.pools.length || new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate pool or resource IDs" });
  }
  // The arithmetic helper supports one instantaneous scope per account/product.
  const scopes = input.pools.map(pool => JSON.stringify([pool.accountId, pool.provider.toLowerCase(), pool.product.toLowerCase()]));
  if (new Set(scopes).size !== scopes.length || input.resources.some(resource => !poolIds.has(resource.poolId))) {
    ctx.addIssue({ code: "custom", message: "Ambiguous or missing pool scope" });
  }
});

export function compareManualObjectStorage(raw: unknown, now = new Date()) {
  const input = objectStorageComparisonInput.parse(raw);
  const poolsById = new Map(input.pools.map(pool => [pool.poolId, pool]));
  const pools = input.pools.map(pool => ({
    ...pool, totalAllowance: pool.allowanceBytes, unit: "B",
    metric: "storage_bytes" as const, period: "none" as const,
    inventoryComplete: pool.inventoryComplete && evaluateFreshness(pool.evidence.measuredAt, now) === "fresh",
  }));
  const resources = input.resources.map(resource => {
    const pool = poolsById.get(resource.poolId);
    if (!pool) throw new Error("Missing validated pool");
    return {
      ...resource, accountId: pool.accountId, provider: pool.provider, product: pool.product,
      category: "object_storage" as const,
      telemetryFreshness: evaluateFreshness(resource.evidence.measuredAt, now),
    };
  });
  const bindings = input.resources.flatMap(resource => resource.consumers.map(projectId => ({
    resourceId: resource.resourceId, projectId, status: "in_use" as const,
  })));
  const results = compareObjectStorageCandidates(resources, pools, input.need, bindings);
  return {
    sourceMode: "manual_snapshot" as const, allocated: false as const,
    note: "Capacity/API comparison only. Verify entitlement, access, retention, request and egress constraints before choosing. Nothing is reserved or deployed.",
    candidates: results.map(result => {
      const resource = input.resources.find(item => item.resourceId === result.resourceId);
      const pool = resource && poolsById.get(resource.poolId);
      if (!resource || !pool) throw new Error("Missing validated evidence");
      return {
        ...result, totalAllowanceBytes: pool.allowanceBytes, usageEvidence: resource.evidence, allowanceEvidence: pool.evidence,
        allowanceFreshness: evaluateFreshness(pool.evidence.measuredAt, now),
        egressNote: resource.egressNote, requestNote: resource.requestNote,
        unknowns: [
          "Provider entitlement, access and retention need independent verification",
          ...(!resource.egressNote ? ["Egress constraints unknown"] : []),
          ...(!resource.requestNote ? ["Request constraints unknown"] : []),
        ],
      };
    }),
  };
}
