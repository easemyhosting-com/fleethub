import { describe, expect, it } from "vitest";
import { resourceUsage } from "../src/lib/fleet/usage";
import { describeProbe, describeScan } from "../src/lib/providers/scan-feedback";

describe("usage per resource", () => {
  it("shows an A1 instance's share of the free compute pool", () => {
    const usage = resourceUsage({ provider: "oracle", specs: { capacityKind: "shared_pool", ocpus: 1, memoryGb: 6 } });
    expect(usage.map(item => [item.key, item.pct, item.band])).toEqual([["ocpus", 50, "half"], ["memory", 50, "half"]]);
    expect(resourceUsage({ provider: "oracle", specs: { capacityKind: "shared_pool", ocpus: 2, memoryGb: 12 } }).map(item => item.band)).toEqual(["full", "full"]);
    expect(resourceUsage({ provider: "oracle", specs: { capacityKind: "shared_pool", ocpus: 4 } })).toHaveLength(1);
  });
  it("shows volumes against the shared block storage pool and ignores everything else", () => {
    expect(resourceUsage({ provider: "oracle", specs: { product: "bootvolume", sizeGb: 100 } })[0]).toMatchObject({ key: "storage", pct: 50 });
    expect(resourceUsage({ provider: "oracle", specs: { product: "volume", sizeGb: 300 } })[0]).toMatchObject({ pct: 100, band: "full" });
    expect(resourceUsage({ provider: "oracle", specs: { product: "bucket", sizeGb: 5 } })).toEqual([]);
    expect(resourceUsage({ provider: "oracle", specs: { capacityKind: "fixed", ocpus: 1 } })).toEqual([]);
    expect(resourceUsage({ provider: "oracle" })).toEqual([]);
    expect(resourceUsage({ provider: "cloudflare", specs: { sizeGb: 5, product: "volume" } })).toEqual([]);
  });
});

describe("feedback in the dialog", () => {
  it("describes a test result", () => {
    expect(describeProbe({ ok: true, counts: {}, total: 0, missing: [], plan: null })).toBe("Credentials work; nothing found yet.");
    expect(describeProbe({ ok: true, counts: { instance: 3, bucket: 1 }, total: 4, missing: ["volume", "database"], plan: "paid" })).toBe("Credentials work. Found 4: instance 3, bucket 1. Cannot read: volume, database. Widen the read permissions if you want those listed. Plan: paid.");
    expect(describeProbe({ ok: false, code: "invalid_config", message: "Incomplete.", fields: ["accountId"] })).toBe("Incomplete. Check: accountId.");
    expect(describeProbe({ ok: false, code: "unauthorized", message: "Rejected.", fields: [] })).toBe("Rejected.");
  });
  it("describes the first scan", () => {
    expect(describeScan(undefined)).toMatchObject({ done: false });
    expect(describeScan({ state: "queued", resourceCount: 0, message: "" })).toMatchObject({ done: false, message: expect.stringContaining("queued") });
    expect(describeScan({ state: "running", resourceCount: 0, message: "" })).toMatchObject({ done: false, message: expect.stringContaining("Scanning") });
    expect(describeScan({ state: "ready", resourceCount: 1, message: "" })).toEqual({ done: true, ok: true, message: "First scan done: found 1 resource." });
    expect(describeScan({ state: "ready", resourceCount: 4, message: "" }).message).toContain("4 resources");
    expect(describeScan({ state: "error", resourceCount: 0, message: "Rejected." })).toEqual({ done: true, ok: false, message: "First scan failed: Rejected." });
  });
});
