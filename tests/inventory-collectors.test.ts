import { afterEach, describe, expect, it, vi } from "vitest";
import { collectInventory, supportsInventory, validateInventoryConfig } from "../src/lib/inventory/collectors";
import { CollectionError } from "../src/lib/inventory/model";

const signal = new AbortController().signal;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
function mockPages(...pages: unknown[]) {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(pages.shift()), { status: 200, headers: { "content-type": "application/json" } }));
  globalThis.fetch = fetch;
  return fetch;
}
const emptyProducts = [
  { success: true, result: [] },
  { success: true, result: [], result_info: { page: 1, total_pages: 0 } },
  { success: true, result: [], result_info: { page: 1, total_pages: 0 } },
  { success: true, result: { buckets: [] }, result_info: {} },
];
const denied = (status = 403) => new Response("{}", { status });
function mockMixed(...responses: (unknown | Response)[]) {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => { const next = responses.shift(); return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 }); });
  globalThis.fetch = fetch as typeof globalThis.fetch;
  return fetch;
}
function code(error: unknown) { return error instanceof CollectionError ? error.code : "unexpected"; }

describe("native inventory collectors", () => {
  it("rejects unsupported and data-plane configurations", () => {
    expect(supportsInventory("gcp")).toBe(false);
    expect(supportsInventory("supabase")).toBe(true);
    expect(() => validateInventoryConfig("upstash", { restUrl: "https://x", restToken: "key" })).toThrow(CollectionError);
    expect(() => validateInventoryConfig("neon", { apiKey: "key", organizationId: "org-a", connectionUri: "postgres://secret" })).toThrow(CollectionError);
    for (const [config, fields] of [[{ apiToken: "t" }, ["accountId"]], [{ apiToken: "t", accountId: "a", extra: "secret-value" }, ["extra"]]] as const) {
      const error = (() => { try { validateInventoryConfig("cloudflare", config); } catch (cause) { return cause as CollectionError; } })();
      expect(error?.fields).toEqual(fields);
      expect(JSON.stringify(error?.fields)).not.toContain("secret-value");
    }
  });

  it("lists every Cloudflare page inside the requested account", async () => {
    const fetch = mockPages(
      { success: true, result: [{ id: "zone-a", name: "a.example", status: "active", account: { id: "acct-a" } }], result_info: { page: 1, total_pages: 2, count: 1 } },
      { success: true, result: [{ id: "zone-b", name: "b.example", account: { id: "acct-a" } }], result_info: { page: 2, total_pages: 2, count: 1 } },
      ...emptyProducts,
    );
    const result = await collectInventory("cloudflare", { apiToken: "hidden-token", accountId: "acct-a" }, signal);
    expect(result.scope).toBe("cloudflare/account/acct-a");
    expect(result.resources.map((resource) => resource.nativeId)).toEqual(["zone-a", "zone-b"]);
    expect(result.resources[0].state).toBe("online");
    expect(result.resources[1].state).toBe("unknown");
    expect(fetch.mock.calls).toHaveLength(7);
    expect(result.covered).toEqual(["zone", "worker", "kv", "d1", "r2"]);
    expect(String(fetch.mock.calls[0][0])).toContain("account.id=acct-a");
    expect(JSON.stringify(result)).not.toContain("hidden-token");
  });

  it("rejects a Cloudflare zone from another account and incomplete metadata", async () => {
    mockPages({ success: true, result: [{ id: "zone", name: "x", account: { id: "acct-b" } }], result_info: { page: 1, total_pages: 1 } });
    await expect(collectInventory("cloudflare", { apiToken: "key", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("accepts an empty Cloudflare account and rejects an unstable page count", async () => {
    mockPages({ success: true, result: [], result_info: { page: 1, total_pages: 0, count: 0 } }, ...emptyProducts);
    await expect(collectInventory("cloudflare", { apiToken: "key", accountId: "acct-a" }, signal)).resolves.toMatchObject({ resources: [] });
    mockPages(
      { success: true, result: [{ id: "a", name: "a", account: { id: "acct-a" } }], result_info: { page: 1, total_pages: 3 } },
      { success: true, result: [{ id: "b", name: "b", account: { id: "acct-a" } }], result_info: { page: 2, total_pages: 2 } },
    );
    await expect(collectInventory("cloudflare", { apiToken: "key", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("lists Workers, KV, D1 and R2 with product-prefixed IDs and marks them covered", async () => {
    const fetch = mockMixed(
      { success: true, result: [], result_info: { page: 1, total_pages: 0 } },
      { success: true, result: [{ id: "api-worker" }] },
      { success: true, result: [{ id: "abc123", title: "sessions" }], result_info: { page: 1, total_pages: 1 } },
      { success: true, result: [{ uuid: "d1-uuid", name: "app-db" }], result_info: { page: 1, total_pages: 1 } },
      { success: true, result: { buckets: [{ name: "assets", location: "APAC" }] }, result_info: { cursor: "c1" } },
      { success: true, result: { buckets: [{ name: "backups" }] }, result_info: {} },
    );
    const result = await collectInventory("cloudflare", { apiToken: "t", accountId: "acct-a" }, signal);
    expect(result.resources.map(item => [item.nativeId, item.category, item.product])).toEqual([
      ["worker:api-worker", "serverless", "worker"], ["kv:abc123", "storage", "kv"], ["d1:d1-uuid", "database", "d1"], ["r2:assets", "storage", "r2"], ["r2:backups", "storage", "r2"],
    ]);
    expect(result.resources.find(item => item.name === "assets")?.region).toBe("APAC");
    expect(result.covered).toEqual(["zone", "worker", "kv", "d1", "r2"]);
    expect(String(fetch.mock.calls[4][0])).not.toContain("cursor=");
    expect(String(fetch.mock.calls[5][0])).toContain("cursor=c1");
  });

  it("leaves a product uncovered when the token cannot read it, but fails the scan on other errors", async () => {
    mockMixed({ success: true, result: [], result_info: { page: 1, total_pages: 0 } }, denied(403), emptyProducts[1], denied(401), emptyProducts[3]);
    const partial = await collectInventory("cloudflare", { apiToken: "t", accountId: "acct-a" }, signal);
    expect(partial.covered).toEqual(["zone", "kv", "r2"]);
    mockMixed({ success: true, result: [], result_info: { page: 1, total_pages: 0 } }, denied(500));
    await expect(collectInventory("cloudflare", { apiToken: "t", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "provider_unavailable" });
    mockMixed({ success: true, result: [], result_info: { page: 1, total_pages: 0 } }, emptyProducts[0], emptyProducts[1], emptyProducts[2], { success: true, result: { buckets: [{ name: "a" }] }, result_info: { cursor: "same" } }, { success: true, result: { buckets: [{ name: "b" }] }, result_info: { cursor: "same" } }, { success: true, result: { buckets: [{ name: "c" }] }, result_info: { cursor: "same" } });
    await expect(collectInventory("cloudflare", { apiToken: "t", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
    mockMixed({ success: true, result: [], result_info: { page: 1, total_pages: 0 } }, { success: true, result: [{ id: "w" }, { id: "w" }] });
    await expect(collectInventory("cloudflare", { apiToken: "t", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects Cloudflare page budgets and duplicate native IDs", async () => {
    mockPages({ success: true, result: [], result_info: { page: 1, total_pages: 21 } });
    await expect(collectInventory("cloudflare", { apiToken: "key", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "scan_limit" });
    mockPages({ success: true, result: [{ id: "a", name: "A", account: { id: "acct-a" } }, { id: "a", name: "A", account: { id: "acct-a" } }], result_info: { page: 1, total_pages: 1 } });
    await expect(collectInventory("cloudflare", { apiToken: "key", accountId: "acct-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("projects only Upstash metadata, excluding credentials from the response", async () => {
    mockPages([{ database_id: "db-1", database_name: "Cache", region: "global", state: "active", rest_token: "sentinel-rest", password: "sentinel-password" }]);
    const result = await collectInventory("upstash", { apiEmail: "owner@example.com", apiKey: "sentinel-api" }, signal);
    expect(result.resources[0]).toMatchObject({ nativeId: "db-1", name: "Cache", state: "unknown", providerState: "active" });
    expect(JSON.stringify(result)).not.toMatch(/sentinel|owner@example.com/);
  });

  it("filters Supabase projects to the requested organization", async () => {
    mockPages([{ id: "p1", name: "One", organization_id: "org-a", status: "ACTIVE_HEALTHY" }, { id: "p2", name: "Two", organization_id: "org-b" }]);
    const result = await collectInventory("supabase", { accessToken: "secret", organizationId: "org-a" }, signal);
    expect(result.resources.map((resource) => resource.nativeId)).toEqual(["p1"]);
    expect(result.resources[0].state).toBe("online");
  });

  it("follows Neon cursors and rejects repetition", async () => {
    const fetch = mockPages(
      { projects: [{ id: "p1", name: "One", org_id: "org-a" }], pagination: { cursor: "next" } },
      { projects: [{ id: "p2", name: "Two", org_id: "org-a" }], pagination: {} },
    );
    const result = await collectInventory("neon", { apiKey: "secret", organizationId: "org-a" }, signal);
    expect(result.resources.map((resource) => resource.nativeId)).toEqual(["p1", "p2"]);
    expect(String(fetch.mock.calls[1][0])).toContain("cursor=next");
    mockPages({ projects: [{ id: "p1", name: "One" }], pagination: { cursor: "same" } }, { projects: [{ id: "p2", name: "Two" }], pagination: { cursor: "same" } });
    await expect(collectInventory("neon", { apiKey: "secret", organizationId: "org-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects full Neon pages without cursors and cross-organization records", async () => {
    mockPages({ projects: Array.from({ length: 100 }, (_, index) => ({ id: `p${index}`, name: `Project ${index}` })) });
    await expect(collectInventory("neon", { apiKey: "secret", organizationId: "org-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
    mockPages({ projects: [{ id: "p1", name: "Project", org_id: "org-b" }] });
    await expect(collectInventory("neon", { apiKey: "secret", organizationId: "org-a" }, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps denials, oversized bodies, and redirects to safe errors", async () => {
    globalThis.fetch = vi.fn(async () => new Response("secret body", { status: 403 }));
    await expect(collectInventory("supabase", { accessToken: "secret", organizationId: "org-a" }, signal)).rejects.toMatchObject({ code: "unauthorized" });
    globalThis.fetch = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1)));
    await expect(collectInventory("supabase", { accessToken: "secret", organizationId: "org-a" }, signal)).rejects.toMatchObject({ code: "scan_limit" });
    globalThis.fetch = vi.fn(async () => { throw new TypeError("redirect contained secret"); });
    await expect(collectInventory("supabase", { accessToken: "secret", organizationId: "org-a" }, signal)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(code(new CollectionError("unauthorized"))).toBe("unauthorized");
  });
});

describe("collection failure budgets", () => {
  const config = { accessToken: "secret-fixture", organizationId: "org-a" };
  it("rejects incomplete Neon results for both response variants", async () => {
    for (const extra of [{ unavailable_project_ids: ["delayed-project"] }, { unavailable: ["delayed-project"] }]) {
      mockPages({ projects: [], ...extra });
      await expect(collectInventory("neon", {apiKey:"secret",organizationId:"org-a"}, signal)).rejects.toMatchObject({code:"invalid_response"});
    }
  });
  it("maps rate limits, server errors, invalid JSON and missing bodies without exposing diagnostics", async () => {
    for (const [response, expected] of [
      [new Response("sensitive", {status:429}),"rate_limited"],
      [new Response("sensitive", {status:500}),"provider_unavailable"],
      [new Response("{"),"invalid_response"],
      [new Response(null),"invalid_response"],
      [new Response("[]", {headers:{"content-length":"1048577"}}),"scan_limit"],
    ] as const) {
      globalThis.fetch = vi.fn(async () => response);
      await expect(collectInventory("supabase",config,signal)).rejects.toMatchObject({code:expected});
    }
  });
  it("honors cancellation and rejects malformed resource fields", async () => {
    const canceled = AbortSignal.abort();
    globalThis.fetch = vi.fn(async () => { throw new Error("private network diagnostic"); });
    await expect(collectInventory("supabase",config,canceled)).rejects.toMatchObject({code:"scan_timeout"});
    mockPages([{id:"project",name:"x".repeat(257),organization_id:"org-a"}]);
    await expect(collectInventory("supabase",config,signal)).rejects.toMatchObject({code:"invalid_response"});
    mockPages({unexpected:true});
    await expect(collectInventory("supabase",config,signal)).rejects.toMatchObject({code:"invalid_response"});
    await expect(collectInventory("unknown",{},signal)).rejects.toMatchObject({code:"unsupported"});
  });
  it("rejects more than 1000 resources or 20 cursor pages without returning a partial snapshot", async () => {
    mockPages(Array.from({length:1001},(_,i)=>({database_id:`db-${i}`,database_name:`Cache ${i}`})));
    await expect(collectInventory("upstash",{apiEmail:"owner@example.test",apiKey:"secret"},signal)).rejects.toMatchObject({code:"scan_limit"});
    mockPages(...Array.from({length:20},(_,i)=>({projects:[{id:`p${i}`,name:`Project ${i}`}],pagination:{cursor:`next${i}`}})));
    await expect(collectInventory("neon",{apiKey:"secret",organizationId:"org-a"},signal)).rejects.toMatchObject({code:"scan_limit"});
  });
  it("keeps unreported lifecycle unknown rather than assuming active", async () => {
    mockPages([{database_id:"db-1",database_name:"Cache"}]);
    expect((await collectInventory("upstash",{apiEmail:"owner@example.test",apiKey:"secret"},signal)).resources[0]).toMatchObject({state:"unknown",region:null,providerState:null});
    mockPages([{id:"p1",name:"Project",organization_id:"org-a"}]);
    expect((await collectInventory("supabase",config,signal)).resources[0].state).toBe("unknown");
  });
});
