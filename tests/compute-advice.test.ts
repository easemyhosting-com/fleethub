import { describe, expect, it, vi, beforeEach } from "vitest";
import { hostCapacity, type HostCapacity } from "../src/lib/capacity/host";
import { adviseCompute } from "../src/lib/projects/compute-advice";
import { needInput } from "../src/lib/projects/schemas";

const now = new Date("2026-11-16T12:00:00Z");
function host(id = "host"): HostCapacity {
  return { ...hostCapacity({ id, name: id, state: "online", region: "region-a", specs: { ocpus: 4, memoryGb: 8, arch: "aarch64" } }, [
    { projectId: "existing", slug: "existing", name: "existing", kind: "app", runtime: "docker", declared: { cpuRequestMilli: 1000, memRequestMi: 2048 } },
  ]), measuredUsage: { instance: "sample", cpuCores: 4, cpuBusyCores: 1, memTotalMi: 8192, memUsedMi: 2048, measuredAt: now.toISOString(), stale: false } };
}
const spec = { cpu: 1, memoryGb: 2, arch: "arm64" as const, region: "region-a" };

describe("Compute constraints", () => {
  it("reuses declared host fit and separately checks observed load without double counting", () => {
    expect(adviseCompute(host(), { ...spec, cpu: 2 }, now)).toMatchObject({ verdict: "fits", basis: "declared_and_observed" });
    expect(adviseCompute(host(), { ...spec, cpu: 3 }, now).verdict).toBe("mismatch");
  });
  it("checks known architecture, region and state mismatches before missing load", () => {
    expect(adviseCompute({ ...host(), measuredUsage: null }, { ...spec, arch: "amd64" }, now).verdict).toBe("mismatch");
    expect(adviseCompute(host(), { ...spec, region: "elsewhere" }, now).verdict).toBe("mismatch");
    expect(adviseCompute({ ...host(), state: "offline", status: "no_data" }, spec, now).verdict).toBe("mismatch");
  });
  it("preserves missing requirements, unknown architecture and undeclared workloads", () => {
    expect(adviseCompute(host(), {}, now).verdict).toBe("unverified");
    expect(adviseCompute({ ...host(), arch: null }, spec, now).verdict).toBe("unverified");
    expect(adviseCompute({ ...host(), withoutRequests: ["unknown"] }, spec, now).verdict).toBe("unverified");
    expect(adviseCompute(undefined, spec, now).verdict).toBe("unverified");
    expect(adviseCompute(host(), { ...spec, storageGb: 10 }, now).verdict).toBe("unverified");
  });
  it.each(["2026-11-16T10:00:00Z", "2026-11-14T12:00:00Z", "2099-01-01T00:00:00Z", "invalid"])("refuses stale or invalid load timestamps: %s", measuredAt => {
    const capacity = host();
    if (capacity.measuredUsage) capacity.measuredUsage.measuredAt = measuredAt;
    expect(adviseCompute(capacity, spec, now).verdict).toBe("unverified");
  });
  it("rejects overloaded hosts and inconsistent telemetry instead of trusting declarations", () => {
    const capacity = host();
    if (capacity.measuredUsage) capacity.measuredUsage.cpuBusyCores = 3.5;
    expect(adviseCompute(capacity, spec, now).verdict).toBe("mismatch");
    if (capacity.measuredUsage) capacity.measuredUsage.memUsedMi = Number.NaN;
    expect(adviseCompute(capacity, spec, now).verdict).toBe("unverified");
    expect(adviseCompute({ ...host(), totalCpuMilli: Number.NaN }, spec, now).verdict).toBe("unverified");
  });
  it("does not trust invalid declared requests or mismatched telemetry totals", () => {
    const capacity = host();
    capacity.projects[0].cpuRequestMilli = -100;
    expect(adviseCompute(capacity, spec, now).verdict).toBe("unverified");
    const mismatched = host();
    if (mismatched.measuredUsage) mismatched.measuredUsage.cpuCores = 8;
    expect(adviseCompute(mismatched, spec, now).verdict).toBe("unverified");
  });
  it("rejects a known CPU shortage even when RAM size is unknown", () => {
    const capacity = { ...host(), totalMemMi: null, freeMemMi: null, freeCpuMilli: 900 } as unknown as HostCapacity;
    expect(adviseCompute(capacity, { ...spec, cpu: 2 }, now)).toMatchObject({ verdict: "mismatch", basis: "declared_only" });
    expect(adviseCompute(capacity, { ...spec, cpu: 0.5 }, now).verdict).toBe("unverified");
  });
  it("accepts a host-reported memory total slightly below the configured size", () => {
    const capacity = host();
    if (capacity.measuredUsage) capacity.measuredUsage.memTotalMi = 7_850;
    expect(adviseCompute(capacity, spec, now)).toMatchObject({ verdict: "fits", basis: "declared_and_observed" });
    for (const total of [4_096, 9_000]) {
      const off = host();
      if (off.measuredUsage) off.measuredUsage.memTotalMi = total;
      expect(adviseCompute(off, spec, now).verdict).toBe("unverified");
    }
  });
  it("adds optional region to the existing strict need contract", () => {
    expect(needInput.parse({ kind: "compute", purpose: "test", spec }).spec.region).toBe("region-a");
    expect(needInput.safeParse({ kind: "compute", purpose: "test", spec: { ...spec, unknown: true } }).success).toBe(false);
  });
});

const storage = vi.hoisted(() => ({ queryClient: vi.fn(), readHostCapacities: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ queryClient: storage.queryClient }));
vi.mock("@/lib/capacity/read", () => ({ readHostCapacities: storage.readHostCapacities }));
import { recommendFor } from "../src/lib/projects/recommend";
const row = (id: string, role = "general") => ({ id, name: id, provider: "manual", category: "compute", state: "online", is_protected: false, role, attributes: {}, others: 0 });

describe("Compute recommendation integration", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("excludes mismatches and ranks evidence-backed fits ahead of high-scoring unknowns", async () => {
    const current = new Date().toISOString();
    const good = host("good");
    if (good.measuredUsage) good.measuredUsage.measuredAt = current;
    const unknown = { ...host("unknown"), measuredUsage: null };
    const wrong = { ...host("wrong"), arch: "amd64" };
    storage.queryClient.mockResolvedValue([row("wrong", "unused"), row("unknown", "unused"), row("good")]);
    storage.readHostCapacities.mockResolvedValue([wrong, unknown, good]);
    const result = await recommendFor({ kind: "compute", purpose: "test", spec }, "project");
    expect(result.allocated).toBe(false);
    expect(result.candidates.map(item => item.resourceId)).toEqual(["good", "unknown"]);
    expect(result.excluded?.map(item => item.resourceId)).toEqual(["wrong"]);
    expect(result.candidates[0].computeFit?.verdict).toBe("fits");
  });
  it("excludes known non-online rows when capacity evidence cannot be read", async () => {
    storage.queryClient.mockResolvedValue([{ ...row("down"), state: "offline" }, row("up")]);
    storage.readHostCapacities.mockRejectedValue(new Error("Unavailable"));
    const result = await recommendFor({ kind: "compute", purpose: "test", spec }, "project");
    expect(result.candidates.map(item => item.resourceId)).toEqual(["up"]);
    expect(result.excluded?.map(item => item.resourceId)).toEqual(["down"]);
    expect(result.excluded?.[0].computeFit?.reasons).toContain("Host is offline");
  });
  it("isolates missing compute evidence and leaves other categories unverified", async () => {
    storage.queryClient.mockResolvedValue([row("unknown")]);
    storage.readHostCapacities.mockRejectedValue(new Error("Unavailable"));
    const compute = await recommendFor({ kind: "compute", purpose: "test", spec }, "project");
    expect(compute.candidates[0].computeFit?.verdict).toBe("unverified");
    storage.readHostCapacities.mockClear();
    const other = await recommendFor({ kind: "storage", purpose: "test", spec: {} }, "project");
    expect(storage.readHostCapacities).not.toHaveBeenCalled();
    expect(other.candidates[0].computeFit).toBeUndefined();
    expect(other.candidates[0].reasons.join(" ")).toContain("fit unverified");
  });
});
