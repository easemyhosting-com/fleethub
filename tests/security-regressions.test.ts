import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { consumeSharedLimit } from "../src/lib/auth/rate-limit";
import { checkRateLimit, verifyApiAccess } from "../src/lib/auth/guard";
import { discoverConfiguredAccounts } from "../src/lib/providers/cloudflare";
import { pluginRegistry } from "../src/lib/plugins/registry";
import "../src/lib/plugins/defaults";
import { dispatchWorkload, STANDARD_DISPATCH_TARGETS } from "../src/lib/distribution/dispatcher";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ queryClient: (strings: TemplateStringsArray, ...values: unknown[]) => db.query(strings.join("?"), ...values) }));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.query.mockReset(); });

describe("security regressions", () => {
  it("allows production read-only keys through the proxy, but forbids writes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLEETHUB_API_KEY", "admin");
    vi.stubEnv("FLEETHUB_READONLY_KEY", "reader");
    const headers = { authorization: "Bearer reader" };
    expect((await proxy(new NextRequest("https://fleet.example/api/fleet", { headers }))).status).toBe(200);
    expect((await proxy(new NextRequest("https://fleet.example/api/fleet", { headers, method: "POST" }))).status).toBe(403);
    vi.stubEnv("FLEETHUB_API_KEY", "");
    expect((await proxy(new NextRequest("https://fleet.example/api/fleet", { headers }))).status).toBe(200);
  });

  it("does not merge same-prefix keys or let forwarding headers rotate anonymous limits", () => {
    const prefix = "same-prefix-123456789";
    vi.stubEnv("FLEETHUB_API_KEY", `${prefix}admin`);
    vi.stubEnv("FLEETHUB_READONLY_KEY", `${prefix}reader`);
    for (let i = 0; i < 20; i++) expect(checkRateLimit(new Request("https://fleet.example", { headers: { "x-api-key": `${prefix}admin` } }), true).allowed).toBe(true);
    expect(checkRateLimit(new Request("https://fleet.example", { headers: { "x-api-key": `${prefix}reader` } }), true).allowed).toBe(true);
    for (let i = 0; i < 25; i++) checkRateLimit(new Request("https://fleet.example", { headers: { "x-forwarded-for": `10.0.0.${i}` } }), true);
    expect(checkRateLimit(new Request("https://fleet.example", { headers: { "cf-connecting-ip": "8.8.8.8" } }), true).allowed).toBe(false);
  });

  it("fails closed when the production shared limiter cannot reach the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    db.query.mockRejectedValue(new Error("connection refused"));
    expect(await verifyApiAccess(new Request("https://fleet.example"))).toMatchObject({ authorized: false, status: 503, reason: "Shared rate limiter unavailable" });
  });

  it("uses one atomic PostgreSQL upsert per request and rejects exhausted limits", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    db.query.mockResolvedValueOnce([{ count: 21 }]);
    expect(await consumeSharedLimit("client", 20)).toEqual({ allowed: false });
    db.query.mockResolvedValueOnce([{ count: 20 }]);
    expect(await consumeSharedLimit("client", 20)).toEqual({ allowed: true });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][0]).toContain("ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_windows.count + 1");
    expect(db.query.mock.calls[0][0]).toContain("clock_timestamp()");
  });

  it("protects an unknown DNS account disguised as a worker", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNTS_JSON", JSON.stringify([{ id: "ordinary", role: "worker_ephemeral", isProtected: false }]));
    expect(discoverConfiguredAccounts()[0].isProtected).toBe(true);
  });

  it("keeps same-email Cloudflare accounts and resource IDs distinct", async () => {
    const results = await pluginRegistry.collectAll(["cf-primary-dns", "cf-worker-sandbox-2"].map(accountId => ({ accountId, accountEmail: "same@example.com", credentials: {}, isMock: true })));
    expect(results.size).toBe(2);
    const resources = [...results.values()].flatMap(result => result.resources);
    expect(new Set(resources.map(resource => resource.id)).size).toBe(resources.length);
  });

  it("rejects protected IDs even when caller metadata denies protection", () => {
    const protectedTarget = STANDARD_DISPATCH_TARGETS.find(target => target.isProtected);
    if (!protectedTarget) throw new Error("Protected target missing");
    const result = dispatchWorkload({ name: "batch job" }, { customTargets: [{ ...protectedTarget, isProtected: false, tags: [], kind: "workstation", provider: "local" }] });
    expect(result.success).toBe(false);
  });

  it("applies worker runtime limits to the second sandbox", () => {
    const target = STANDARD_DISPATCH_TARGETS.find(target => target.id === "cf-worker-sandbox-2");
    if (!target) throw new Error("Sandbox missing");
    const result = dispatchWorkload({ name: "long sync", maxCpuMs: 11 }, { customTargets: [target], quotaReadings: { "cf.workers.requests": 0 } });
    expect(result.success).toBe(false);
    expect(result.evaluations[0].rejectionReason).toContain("needs 11 ms");
  });
});

describe("request parsing and limiter failures", () => {
  it("parses bounded JSON, empty bodies, and rejects malformed or oversized requests", async () => {
    const { readJsonWithLimit } = await import("../src/lib/auth/guard");
    expect(await readJsonWithLimit(new Request("https://fleet.example"))).toEqual({ ok: true, data: {} });
    expect(await readJsonWithLimit(new Request("https://fleet.example", { method: "POST", body: '{"name":"ok"}' }))).toEqual({ ok: true, data: { name: "ok" } });
    expect(await readJsonWithLimit(new Request("https://fleet.example", { method: "POST", body: "invalid" }))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonWithLimit(new Request("https://fleet.example", { headers: { "content-length": "70000" } }))).toMatchObject({ ok: false, status: 413 });
    expect(await verifyApiAccess(new Request("https://fleet.example", { headers: { "content-length": "70000" } }))).toMatchObject({ authorized: false, status: 413 });
  });

  it("rejects unreadable request streams", async () => {
    const { readJsonWithLimit } = await import("../src/lib/auth/guard");
    const body = new ReadableStream({ start(controller) { controller.error(new Error("Read failed")); } });
    const request = new Request("https://fleet.example", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(await readJsonWithLimit(request)).toMatchObject({ ok: false, status: 400 });
  });

  it("propagates a database error so callers deny, and a failed cleanup does not deny", async () => {
    db.query.mockRejectedValueOnce(new Error("down"));
    await expect(consumeSharedLimit("client", 20)).rejects.toThrow("down");
    vi.spyOn(Math, "random").mockReturnValue(0);
    db.query.mockResolvedValueOnce([{ count: 1 }]).mockRejectedValueOnce(new Error("cleanup failed"));
    expect(await consumeSharedLimit("client", 20)).toEqual({ allowed: true });
  });

  it("rejects development writes with spoofed local forwarding headers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLEETHUB_API_KEY", "");
    vi.stubEnv("FLEETHUB_READONLY_KEY", "");
    vi.stubEnv("FLEETHUB_TRUSTED_IP_HEADER", "");
    vi.stubEnv("FLEETHUB_DEV_ALLOW_ANONYMOUS_WRITE", "false");
    expect(await verifyApiAccess(new Request("https://fleet.example", { method: "POST", headers: { "x-real-ip": "127.0.0.1" } }), { skipRateLimit: true })).toMatchObject({ authorized: false, status: 401 });
  });
});

describe("CodeRabbit regression cases", () => {
  it("preserves omitted account protection and role fields", async () => {
    const { LinkAccountSchema } = await import("../src/lib/identity/types");
    const parsed = LinkAccountSchema.parse({ accountId: "account", identityId: "identity", provider: "oracle", label: "Account" });
    expect(parsed.role).toBeUndefined();
    expect(parsed.isProtected).toBeUndefined();
  });

  it("does not expose raw phone numbers in graph nodes", async () => {
    const { getIdentityGraph } = await import("../src/lib/identity/service");
    const graph = await getIdentityGraph();
    expect(JSON.stringify(graph)).not.toContain("+1 (555) 010-0198");
    expect(JSON.stringify(graph)).not.toContain('"rawPhone"');
  });

  it("bounds OCI compartments to their profile and accepts DEFAULT", async () => {
    const { getOciCompartments } = await import("../src/lib/providers/oci");
    expect(getOciCompartments('[DEFAULT]\nuser=user\n[secondary]\ncompartment_id = ocid1.secondary\n[sandbox]\ncompartment_id=ocid1.sandbox\n')).toEqual([
      { profile: "secondary", compartmentId: "ocid1.secondary" },
      { profile: "sandbox", compartmentId: "ocid1.sandbox" },
    ]);
    expect(getOciCompartments('[DEFAULT]\ncompartment_id=ocid1.default\n[unknown]\ncompartment_id=ignored\n[sandbox]\ncompartment_id=invalid value\n')).toEqual([{ profile: "DEFAULT", compartmentId: "ocid1.default" }]);
  });

  it("allows read-only MCP POST requests through proxy and handler", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLEETHUB_READONLY_KEY", "reader-mcp-test");
    const request = new NextRequest("https://fleet.example/api/mcp", {
      method: "POST", headers: { authorization: "Bearer reader-mcp-test", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect((await proxy(request)).status).toBe(200);
    const { POST } = await import("../src/app/api/mcp/route");
    expect((await POST(request)).status).toBe(200);
  });
});


it("isolates session rate budgets and authentication attempts from API traffic", async () => {
 const { createSessionToken } = await import("../src/lib/auth/session");
 const { checkAuthRateLimit } = await import("../src/lib/auth/guard");
 vi.stubEnv("NODE_ENV", "development");
 vi.stubEnv("FLEETHUB_AUTH_SECRET", "rate-limit-session-secret-at-least-32-bytes");
 vi.stubEnv("FLEETHUB_API_KEY", ""); vi.stubEnv("FLEETHUB_READONLY_KEY", "");
 const req = (id: string) => new Request("https://fleet.example/api/providers", { headers: { cookie: `fleethub_session=${createSessionToken({ id, email: "operator@example.com", name: "Operator", provider: "local", createdAt: Date.now() })}` } });
 const first = req("session-rate-first"); const second = req("session-rate-second");
 for (let i = 0; i < 20; i++) expect(checkRateLimit(first, true).allowed).toBe(true);
 expect(checkRateLimit(first, true).allowed).toBe(false);
 expect(checkRateLimit(second, true).allowed).toBe(true);
 expect(await checkAuthRateLimit(first)).toBe(true);
});
