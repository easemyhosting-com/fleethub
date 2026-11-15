import { describe, expect, it, vi, beforeEach } from "vitest";
import { compareManualObjectStorage } from "../src/lib/capacity/object-storage";

const now = new Date("2026-11-16T12:00:00Z");
const protocol = "s3_compatible";
const evidence = { source: "manual account console", measuredAt: now.toISOString() };
const pool = (poolId: string, provider: string) => ({ poolId, provider, accountId: poolId, product: "object_storage", allowanceBytes: 100, inventoryComplete: true, evidence });
const resource = (resourceId: string, poolId: string) => ({
  resourceId, poolId, name: resourceId, region: "region-a", observedBytes: 20,
  declaredBytes: 50, evidence, supportedApis: [protocol], consumers: ["project", "project"],
  egressNote: null, requestNote: null,
});
const fixture = () => ({
  need: { estimatedBytes: 30, requiredApi: protocol },
  pools: [pool("account-a", "provider-a"), pool("account-b", "provider-b")],
  resources: [resource("bucket-a", "account-a"), resource("bucket-b", "account-b")],
});

describe("Manual object-storage comparison", () => {
  it("compares two manual sources with provenance, consumers and explicit unknowns", () => {
    const result = compareManualObjectStorage(fixture(), now);
    expect(result.allocated).toBe(false);
    expect(result.candidates).toHaveLength(2);
    for (const candidate of result.candidates) {
      expect(candidate.fitVerdict).toBe("fits");
      expect(candidate.sharedAllowanceRemainingBytes).toBe(80);
      expect(candidate.projectConsumers).toEqual(["project"]);
      expect(candidate.usageEvidence).toEqual(evidence);
      expect(candidate.unknowns).toContain("Egress constraints unknown");
    }
  });

  it("preserves stale or missing allowance evidence without contaminating another account", () => {
    const input = fixture();
    input.pools[0].evidence = { ...evidence, measuredAt: "2026-11-15T00:00:00Z" };
    const results = compareManualObjectStorage(input, now).candidates;
    expect(results.find(item => item.resourceId === "bucket-a")?.fitVerdict).toBe("unverified");
    expect(results.find(item => item.resourceId === "bucket-b")?.fitVerdict).toBe("fits");
  });

  it("derives freshness from timestamps instead of trusting declared freshness", () => {
    const input = fixture();
    input.resources[0].evidence = { ...evidence, measuredAt: "2099-01-01T00:00:00Z" };
    expect(compareManualObjectStorage(input, now).candidates.find(item => item.resourceId === "bucket-a")?.telemetryFreshness).toBe("unmeasured");
    expect(() => compareManualObjectStorage({ ...input, telemetryFreshness: "fresh" }, now)).toThrow();
  });

  it("rejects duplicate IDs, missing scopes, unsafe numbers and unknown fields", () => {
    const input = fixture();
    expect(() => compareManualObjectStorage({ ...input, resources: [input.resources[0], input.resources[0]] }, now)).toThrow();
    expect(() => compareManualObjectStorage({ ...input, pools: [input.pools[0]] }, now)).toThrow();
    expect(() => compareManualObjectStorage({ ...input, need: { estimatedBytes: Number.MAX_VALUE } }, now)).toThrow();
    expect(() => compareManualObjectStorage({ ...input, token: "synthetic-placeholder" }, now)).toThrow();
  });

  it("keeps a known API mismatch visible even if usage is stale", () => {
    const input = fixture();
    input.need.requiredApi = "oci_native";
    input.resources[0].evidence = { ...evidence, measuredAt: "2026-11-14T00:00:00Z" };
    expect(compareManualObjectStorage(input, now).candidates.every(item => item.fitVerdict === "over")).toBe(true);
  });
});

const auth = vi.hoisted(() => ({
  verifyApiAccess: vi.fn(), isOperator: vi.fn(), readJsonWithLimit: vi.fn(),
  createUnauthorizedResponse: vi.fn(() => Response.json({ error: "Unauthorized" }, { status: 401 })),
}));
vi.mock("@/lib/auth/guard", () => auth);
import { POST } from "../src/app/api/capacity/object-storage/route";

describe("Object-storage comparison endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyApiAccess.mockResolvedValue({ authorized: true, status: 200 });
    auth.isOperator.mockReturnValue(true);
    auth.readJsonWithLimit.mockResolvedValue({ ok: true, data: fixture() });
  });
  const request = () => new Request("https://example.com/api/capacity/object-storage", { method: "POST" });

  it("rejects unauthenticated and non-operator callers before reading the payload", async () => {
    auth.verifyApiAccess.mockResolvedValueOnce({ authorized: false, status: 401 });
    expect((await POST(request())).status).toBe(401);
    auth.isOperator.mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(403);
    expect(auth.readJsonWithLimit).not.toHaveBeenCalled();
  });

  it("enforces the body limit and returns generic validation failures", async () => {
    auth.readJsonWithLimit.mockResolvedValueOnce({ ok: false, error: "Too large", status: 413 });
    expect((await POST(request())).status).toBe(413);
    expect(auth.readJsonWithLimit).toHaveBeenCalledWith(expect.any(Request), 64 * 1024);
    auth.readJsonWithLimit.mockResolvedValueOnce({ ok: true, data: { secret: "synthetic-placeholder" } });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid object-storage comparison" });
  });

  it("returns advice without caching or mutation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ allocated: false, sourceMode: "manual_snapshot" });
    expect(auth.verifyApiAccess).toHaveBeenCalledWith(expect.any(Request), { requireWrite: true });
  });
});
