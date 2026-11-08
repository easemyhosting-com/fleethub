import { beforeEach, describe, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ calls: [] as unknown[][], replies: [] as unknown[][], scan: vi.fn(), bootstrap: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ queryClient: (strings: TemplateStringsArray, ...values: unknown[]) => { fx.calls.push([strings.join("?"), ...values]); return Promise.resolve(fx.replies.shift() ?? []); } }));
vi.mock("@/lib/connectors/service", () => ({ scanConnector: fx.scan }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fx.bootstrap }));
import { effectiveScanInterval, nextDue, scanIsDue } from "../src/lib/connectors/schedule-rules";
import { hashRescanKey, isRescanKeyFormat, newRescanKey, requestRescan, revokeRescanKey, rotateRescanKey, runDueConnectorScans, setScanInterval, UnknownConnectorId } from "../src/lib/connectors/schedule";
import { intervalLabel, scheduleNote } from "../src/lib/connectors/view";
import { POST as rescanHook } from "../src/app/api/hooks/rescan/route";

const now = new Date("2026-11-07T12:00:00Z"), ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const sql = () => fx.calls.map(call => String(call[0]));
beforeEach(() => { fx.calls.length = 0; fx.replies.length = 0; fx.scan.mockReset(); fx.bootstrap.mockReset(); fx.bootstrap.mockResolvedValue({ success: true }); });

describe("scan schedule rules", () => {
  it("uses the kind default until a connector has its own interval, and 0 means manual", () => {
    expect(effectiveScanInterval("prometheus", null)).toBe(15);
    expect(effectiveScanInterval("kubernetes", undefined)).toBe(360);
    expect(effectiveScanInterval("argo", null)).toBe(0);
    expect(effectiveScanInterval("prometheus", 0)).toBe(0);
    expect(effectiveScanInterval("docker", 60)).toBe(60);
  });
  it("is due when the interval has passed, when never scanned, or when a rescan was requested", () => {
    const row = { kind: "prometheus", scanIntervalMinutes: null, lastScanAt: ago(14), scanRequestedAt: null };
    expect(scanIsDue(row, now)).toBe(false);
    expect(scanIsDue({ ...row, lastScanAt: ago(15) }, now)).toBe(true);
    expect(scanIsDue({ ...row, lastScanAt: null }, now)).toBe(true);
    expect(scanIsDue({ ...row, scanIntervalMinutes: 0, lastScanAt: null }, now)).toBe(false);
    expect(scanIsDue({ ...row, scanIntervalMinutes: 0, scanRequestedAt: ago(1) }, now)).toBe(true);
  });
  it("runs requested rescans first, then never-scanned, then the oldest", () => {
    const rows = [
      { id: "old", kind: "prometheus", scanIntervalMinutes: null, lastScanAt: ago(100), scanRequestedAt: null },
      { id: "never", kind: "docker", scanIntervalMinutes: null, lastScanAt: null, scanRequestedAt: null },
      { id: "asked", kind: "kubernetes", scanIntervalMinutes: 0, lastScanAt: ago(1), scanRequestedAt: ago(1) },
      { id: "fresh", kind: "prometheus", scanIntervalMinutes: null, lastScanAt: ago(1), scanRequestedAt: null },
    ];
    expect(nextDue(rows, now)?.id).toBe("asked");
    expect(nextDue(rows.filter(row => row.id !== "asked"), now)?.id).toBe("never");
    expect(nextDue(rows.filter(row => row.id === "fresh"), now)).toBeNull();
  });
  it("labels intervals and says what an automatic scan does", () => {
    expect([0, 15, 60, 360, 1440, 2880].map(intervalLabel)).toEqual(["Manual only", "Every 15 minutes", "Every hour", "Every 6 hours", "Once a day", "Every 2 days"]);
    expect(scheduleNote("prometheus")).toMatch(/measured usage/);
    expect(scheduleNote("kubernetes")).toMatch(/only listed for review/);
  });
});

describe("scheduled scans in the worker", () => {
  it("does nothing when no connector is due", async () => {
    fx.replies.push([{ id: "c1", kind: "prometheus", scan_interval_minutes: null, last_scan_at: new Date().toISOString(), scan_requested_at: null }]);
    expect(await runDueConnectorScans()).toBe(false);
    expect(fx.scan).not.toHaveBeenCalled();
  });
  it("claims a due Prometheus connector, records usage, then clears only requests older than the claim", async () => {
    const claimedAt = new Date();
    fx.replies.push([{ id: "c1", kind: "prometheus", scan_interval_minutes: null, last_scan_at: ago(30).toISOString(), scan_requested_at: null }], [{ claimed_at: claimedAt }]);
    expect(await runDueConnectorScans(now)).toBe(true);
    expect(fx.scan).toHaveBeenCalledWith("c1", { apply: true, select: [] });
    expect(sql()[1]).toMatch(/date_trunc\('milliseconds', last_scan_at\) IS NOT DISTINCT FROM/);
    expect(fx.calls[1]).toContain("c1");
    expect(fx.calls[2]).toEqual([expect.stringContaining("scan_requested_at <="), claimedAt.toISOString(), "c1"]);
  });
  it("refreshes only registered projects for clusters and Docker hosts, and survives a failed scan", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fx.scan.mockRejectedValue(new Error("unreachable"));
    fx.replies.push([{ id: "k1", kind: "kubernetes", scan_interval_minutes: 0, last_scan_at: null, scan_requested_at: ago(1).toISOString() }], [{ claimed_at: now }]);
    expect(await runDueConnectorScans(now)).toBe(true);
    expect(fx.scan).toHaveBeenCalledWith("k1", { apply: false, select: [], refreshRegistered: true });
    expect(error).toHaveBeenCalledOnce();
    expect(sql()[2]).toMatch(/SET scan_lease_until = NULL/);
    error.mockRestore();
  });
  it("skips a connector another pass already claimed", async () => {
    fx.replies.push([{ id: "c1", kind: "prometheus", scan_interval_minutes: null, last_scan_at: null, scan_requested_at: null }], []);
    expect(await runDueConnectorScans(now)).toBe(true);
    expect(fx.scan).not.toHaveBeenCalled();
  });
});

describe("rescan keys", () => {
  it("creates keys of a fixed shape and stores only their hash", async () => {
    const key = newRescanKey();
    expect(isRescanKeyFormat(key)).toBe(true);
    expect(isRescanKeyFormat("fhp_" + "a".repeat(43))).toBe(false);
    fx.replies.push([{ id: "c1" }]);
    const rotated = await rotateRescanKey("c1");
    expect(JSON.stringify(fx.calls)).not.toContain(rotated);
    expect(fx.calls[0]).toContain(hashRescanKey(rotated));
    await expect(rotateRescanKey("missing")).rejects.toBeInstanceOf(UnknownConnectorId);
  });
  it("sets the interval and revokes the key", async () => {
    fx.replies.push([{ id: "c1" }]);
    await setScanInterval("c1", 60);
    expect(fx.calls[0]).toEqual([expect.stringContaining("scan_interval_minutes ="), 60, "c1"]);
    await expect(setScanInterval("missing", null)).rejects.toBeInstanceOf(UnknownConnectorId);
    fx.replies.push([{ id: "c1" }]);
    await revokeRescanKey("c1");
    expect(sql()[2]).toMatch(/rescan_key_hash = NULL/);
    await expect(revokeRescanKey("missing")).rejects.toBeInstanceOf(UnknownConnectorId);
  });
  it("marks only the key's own connector and rejects malformed keys without a query", async () => {
    expect(await requestRescan("nope")).toBeNull();
    expect(fx.calls).toHaveLength(0);
    const key = newRescanKey();
    fx.replies.push([{ id: "c1", label: "borealis" }]);
    expect(await requestRescan(key)).toEqual({ id: "c1", label: "borealis" });
    expect(fx.calls[0]).toEqual([expect.stringContaining("SET scan_requested_at = NOW() WHERE rescan_key_hash ="), hashRescanKey(key)]);
    expect(await requestRescan(key)).toBeNull();
  });
});

describe("rescan webhook", () => {
  const post = (authorization?: string) => rescanHook(new Request("http://localhost/api/hooks/rescan", { method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify({ involvedObject: { kind: "Kustomization" } }) }));
  it("needs a bearer key and accepts a valid one with 202", async () => {
    expect((await post()).status).toBe(401);
    const key = newRescanKey();
    fx.replies.push([{ id: "c1", label: "borealis" }], [{ id: "c1", label: "borealis" }]);
    const ok = await post(`Bearer ${key}`);
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ accepted: true, connector: "borealis" });
    expect((await post(`Bearer ${key}`)).status).toBe(401);
  });
  it("reports storage trouble as 503 and rate-limits one key", async () => {
    fx.bootstrap.mockResolvedValueOnce({ success: false });
    expect((await post(`Bearer ${newRescanKey()}`)).status).toBe(503);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    const key = newRescanKey(), statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await post(`Bearer ${key}`)).status);
    expect(statuses.slice(0, 30).every(status => status === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    // Unknown identities share one bucket and cannot exhaust capacity for a real key.
    for (let i = 0; i < 4100; i += 1) await post(`Bearer ${newRescanKey()}`);
    fx.replies.push([{ id: "c1", label: "borealis" }], [{ id: "c1", label: "borealis" }]);
    expect((await post(`Bearer ${newRescanKey()}`)).status).toBe(202);
    clock.mockRestore();
  });
});
