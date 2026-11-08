import { describe, expect, it } from "vitest";
import { fit, hostCapacity, parseAsk, reserve, type PlacementInput } from "../src/lib/capacity/host";

const host = { id: "h", name: "borealis", state: "online", region: "ap-mumbai-1", specs: { ocpus: 2, memoryGb: 12, shape: "VM.Standard.A1.Flex" } };
const place = (slug: string, cpu: number, mem: number, over: Partial<PlacementInput["declared"]> = {}): PlacementInput => ({ projectId: slug, slug, name: slug, kind: "app", runtime: "k8s", declared: { cpuRequestMilli: cpu, memRequestMi: mem, cpuLimitMilli: cpu * 4, memLimitMi: mem * 2, pvcGi: 0, ...over } });

describe("hostCapacity", () => {
  it("sums declared requests per host against its size and reports the reserve", () => {
    const c = hostCapacity(host, [place("web", 500, 2048), place("db", 300, 1024, { pvcGi: 10 })]);
    expect(c).toMatchObject({ totalCpuMilli: 2000, totalMemMi: 12288, requestedCpuMilli: 800, requestedMemMi: 3072, pvcGi: 10, cpuRequestPct: 40, memRequestPct: 25, basis: "declared_requests", measured: false });
    expect(c.freeCpuMilli).toBe(2000 - 200 - 800); expect(c.freeMemMi).toBe(12288 - reserve.memMi - 3072);
    expect(c.status).toBe("ok"); expect(c.projects[0].slug).toBe("web");
    expect(c.cpuLimitPct).toBe(160);
  });
  it("goes tight and over as requests grow, and flags projects that declare no requests", () => {
    expect(hostCapacity(host, [place("a", 1500, 1000)]).status).toBe("tight");
    expect(hostCapacity(host, [place("a", 1900, 1000)]).status).toBe("over");
    const c = hostCapacity(host, [place("a", 100, 100), place("bare", 0, 0)]);
    expect(c.withoutRequests).toEqual(["bare"]);
  });
  it("does not call an unconnected host free: no registered workloads means no data", () => {
    const c = hostCapacity(host, []);
    expect(c.status).toBe("no_data");
    expect(fit(c, { cpuMilli: 1, memMi: 1 })).toMatchObject({ fits: null });
  });
  it("never invents a size: unknown specs give unknown_size and no fit verdict", () => {
    const c = hostCapacity({ ...host, specs: {} }, [place("a", 100, 100)]);
    expect(c).toMatchObject({ status: "unknown_size", totalCpuMilli: null, freeCpuMilli: null });
    expect(fit(c, { cpuMilli: 1, memMi: 1 })).toMatchObject({ fits: null });
  });
});

describe("fit", () => {
  const c = hostCapacity(host, [place("a", 1000, 6000)]);
  it("fits within the free space after the reserve and says what is short otherwise", () => {
    expect(fit(c, { cpuMilli: 500, memMi: 2000 })).toMatchObject({ fits: true, remainingCpuMilli: 300, remainingMemMi: 12288 - 1024 - 6000 - 2000 });
    const no = fit(c, { cpuMilli: 900, memMi: 9000 });
    expect(no.fits).toBe(false); expect(no.reason).toContain("m CPU short"); expect(no.reason).toContain("MiB memory short");
  });
  it("refuses an offline host", () => {
    expect(fit({ ...c, state: "offline" }, { cpuMilli: 1, memMi: 1 })).toMatchObject({ fits: false, reason: "Host is offline." });
  });
  it("parses asks and rejects nonsense", () => {
    expect(parseAsk("500m", "256Mi")).toEqual({ cpuMilli: 500, memMi: 256 });
    expect(parseAsk("1", null)).toEqual({ cpuMilli: 1000, memMi: 0 });
    expect(parseAsk(null, "1Gi")).toEqual({ cpuMilli: 0, memMi: 1024 });
    expect(parseAsk("lots", null)).toBeNull(); expect(parseAsk(null, null)).toBeNull();
  });
});
