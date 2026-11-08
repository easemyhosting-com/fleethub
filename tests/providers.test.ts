import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getOciFleetResources } from "../src/lib/providers/oci";
import { discoverConfiguredAccounts, getCloudflareResources } from "../src/lib/providers/cloudflare";

describe("Cloud Providers Discovery & Live Telemetry", () => {
  beforeEach(() => { vi.stubEnv("HOME", "/tmp/non-existent-oci-dir-test"); });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("discovers OCI fleet resources across tenancies with correct allocations", async () => {
    const oci = await getOciFleetResources();

    expect(oci.totalInstances).toBeGreaterThanOrEqual(4);
    expect(oci.runningInstances).toBeGreaterThanOrEqual(3);
    expect(oci.totalOcpusAllocated).toBeGreaterThanOrEqual(6);
    expect(oci.totalMemoryAllocatedGb).toBeGreaterThanOrEqual(36);
    expect(oci.ampereA1Instances).toBeGreaterThanOrEqual(3);
    expect(oci.amdInstances).toBeGreaterThanOrEqual(1);

    // Verify Atlas Docker Brain instance
    const atlas = oci.instances.find((i) => i.name.toLowerCase().includes("atlas"));
    expect(atlas).toBeDefined();
    expect(atlas?.state).toBe("RUNNING");
    expect(atlas?.isProtected).toBe(true);
    expect(atlas?.ocpus).toBe(2);
    expect(atlas?.memoryGb).toBe(12);
    expect(atlas?.region).toBe("ap-mumbai-1");

    // Verify K3s nodes
    const borealis = oci.instances.find((i) => i.name.toLowerCase().includes("borealis"));
    expect(borealis?.isProtected).toBe(true);
    expect(borealis?.state).toBe("RUNNING");

    const night = oci.instances.find((i) => i.name.toLowerCase().includes("night"));
    expect(night?.isProtected).toBe(true);
    expect(night?.state).toBe("RUNNING");

    // Verify standby instance
    const standby = oci.instances.find((i) => i.name.toLowerCase().includes("ember"));
    expect(standby).toBeDefined();
    expect(standby?.state).toBe("STOPPED");
    expect(standby?.isProtected).toBe(true);
  });

  it("fails closed to offline_snapshot with connected: false when ~/.oci/config does not exist", async () => {
    const origHome = process.env.HOME;
    try {
      process.env.HOME = "/tmp/non-existent-oci-dir-test";
      const fallbackReport = await getOciFleetResources();

      expect(fallbackReport.connected).toBe(false);
      expect(fallbackReport.dataSource).toBe("offline_snapshot");
      expect(fallbackReport.totalInstances).toBe(4);
      expect(fallbackReport.runningInstances).toBe(3);
      expect(fallbackReport.totalOcpusAllocated).toBe(6);
      expect(fallbackReport.totalMemoryAllocatedGb).toBe(36);
    } finally {
      process.env.HOME = origHome;
    }
  });

  it("reports connected: false and sample_baseline when Cloudflare token is unconfigured or invalid", async () => {
    const origToken = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;

    try {
      const cf = await getCloudflareResources();
      expect(cf.connected).toBe(false);
      expect(cf.dataSource).toBe("sample_baseline");
      expect(cf.accounts.length).toBeGreaterThanOrEqual(3);

      // Verify primary DNS account is shielded (isProtected: true)
      const dnsAccount = cf.accounts.find((a) => a.role === "dns_control");
      expect(dnsAccount?.isProtected).toBe(true);

      // Verify worker sandbox accounts are available for placement
      const workerAccount = cf.accounts.find((a) => a.role === "worker_ephemeral");
      expect(workerAccount?.isProtected).toBe(true);
    } finally {
      if (origToken) process.env.CLOUDFLARE_API_TOKEN = origToken;
    }
  });

  it("reports connected: true and live_api when Cloudflare API verification succeeds", async () => {
    const origFetch = global.fetch;
    const origToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "valid-cf-token";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("api.cloudflare.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              result: [{ id: "zone-live-1", name: "example.com", status: "active" }],
            }),
        } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    try {
      const cf = await getCloudflareResources();
      expect(cf.connected).toBe(true);
      expect(cf.dataSource).toBe("partial_live_api");
      expect(cf.zones.some((z) => z.id === "zone-live-1")).toBe(true);
    } finally {
      global.fetch = origFetch;
      if (origToken) {
        process.env.CLOUDFLARE_API_TOKEN = origToken;
      } else {
        delete process.env.CLOUDFLARE_API_TOKEN;
      }
    }
  });

  it("supports multi-account JSON configuration with separate roles and protection flags", async () => {
    const origJson = process.env.CLOUDFLARE_ACCOUNTS_JSON;
    process.env.CLOUDFLARE_ACCOUNTS_JSON = JSON.stringify([
      {
        id: "cf-main-dns",
        label: "Production DNS (fleethub.dev)",
        ownerEmail: "operator@fleethub.dev",
        role: "dns_control",
        isProtected: true,
      },
      {
        id: "cf-worker-sandbox",
        label: "Ephemeral Jobs Pool",
        ownerEmail: "bot@fleethub.dev",
        role: "worker_ephemeral",
        isProtected: false,
      },
    ]);

    try {
      const report = await getCloudflareResources();
      expect(report.accounts.length).toBe(2);
      expect(report.accounts[0].isProtected).toBe(true);
      expect(report.accounts[1].isProtected).toBe(true);
    } finally {
      if (origJson) {
        process.env.CLOUDFLARE_ACCOUNTS_JSON = origJson;
      } else {
        delete process.env.CLOUDFLARE_ACCOUNTS_JSON;
      }
    }
  });
});


describe("Cloudflare collection failure behavior", () => {
 afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
 it("rejects malformed and duplicate account identities", () => {
  vi.stubEnv("CLOUDFLARE_ACCOUNTS_JSON", "invalid");
  expect(discoverConfiguredAccounts()).toEqual([]);
  vi.stubEnv("CLOUDFLARE_ACCOUNTS_JSON", JSON.stringify([{ id: "duplicate" }, { id: "duplicate" }]));
  expect(discoverConfiguredAccounts()).toEqual([]);
 });
 it("never treats an empty token or rejected upstream response as live", async () => {
  vi.stubEnv("CLOUDFLARE_ACCOUNTS_JSON", JSON.stringify([{ id: "test", token: " " }]));
  expect((await getCloudflareResources()).connected).toBe(false);
  vi.stubEnv("CLOUDFLARE_ACCOUNTS_JSON", JSON.stringify([{ id: "test", token: "fixture" }]));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  expect((await getCloudflareResources()).connected).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false })));
  expect((await getCloudflareResources()).connected).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  expect((await getCloudflareResources()).connected).toBe(false);
 });
});


it("keeps live Cloudflare zone discovery separate from unavailable usage", async () => {
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_DEMO_MODE", "false");
 vi.stubEnv("CLOUDFLARE_ACCOUNTS_JSON", JSON.stringify([{ id: "one", token: "fixture" }]));
 vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, result: [{ id: "zone-one", name: "example.test", status: "active" }] })));
 try {
  const report = await getCloudflareResources();
  expect(report.zones.map(zone => zone.id)).toEqual(["zone-one"]);
  expect(report.r2Buckets).toEqual([]);
  expect(report.workersUsage).toEqual({ invocationsToday: null, dailyLimit: null, status: "unknown" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  const offline = await getCloudflareResources();
  expect(offline.dataSource).toBe("unavailable");
  expect(offline.zones).toEqual([]);
 } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});
