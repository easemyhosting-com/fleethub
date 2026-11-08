import { afterEach, describe, expect, it, vi } from "vitest";
import { collectInventory } from "../src/lib/inventory/collectors";
import { cloudflarePlan, ociPlan, ociShapeBilling, orgPlan, upstashBilling, upstashPlan, zoneIsFree } from "../src/lib/inventory/plans";
import { resourceBilling } from "../src/lib/providers/config-security";
import { applyBilling, hasPaidResources } from "../src/lib/fleet/billing";

const signal = new AbortController().signal;
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });
function routes(table: Record<string, unknown | number>) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const hit = Object.entries(table).find(([part]) => String(url).includes(part));
    if (!hit) return new Response("{}", { status: 404 });
    return typeof hit[1] === "number" ? new Response("{}", { status: hit[1] }) : new Response(JSON.stringify(hit[1]), { status: 200 });
  }) as typeof globalThis.fetch;
}
const cfZones = (...plans: Array<Record<string, string> | undefined>) => ({ success: true, result: plans.map((plan, index) => ({ id: `z${index}`, name: `z${index}.example`, status: "active", account: { id: "acct" }, ...(plan ? { plan } : {}) })), result_info: { page: 1, total_pages: 1, count: plans.length } });
const cfEmpty = { success: true, result: [], result_info: { page: 1, total_pages: 0 } };
const cf = (zones: unknown, subscriptions: unknown | number) => routes({ "/zones": zones, "/subscriptions": subscriptions, "workers/scripts": { success: true, result: [] }, "kv/namespaces": cfEmpty, "d1/database": cfEmpty, "r2/buckets": { success: true, result: { buckets: [] }, result_info: {} } });

describe("plan rules", () => {
  it("reads Cloudflare zone plans", () => {
    expect(zoneIsFree(undefined)).toBeUndefined();
    expect(zoneIsFree({})).toBeUndefined();
    expect(zoneIsFree({ legacy_id: "free" })).toBe(true);
    expect(zoneIsFree({ name: "Free Website" })).toBe(true);
    expect(zoneIsFree({ name: "Pro Website", legacy_id: "pro" })).toBe(false);
  });
  it("proves free only with readable billing, and paid from any paid signal", () => {
    expect(cloudflarePlan([true], [])).toBe("free");
    expect(cloudflarePlan([true], null)).toBeUndefined();
    expect(cloudflarePlan([true, undefined], [])).toBeUndefined();
    expect(cloudflarePlan([true, false], null)).toBe("paid");
    expect(cloudflarePlan([], [{ price: 5, state: "Paid" }])).toBe("paid");
    expect(cloudflarePlan([], [{ price: 0, state: "Paid" }, { price: 5, state: "Cancelled" }, {}])).toBe("free");
  });
  it("maps organisation, Upstash and Oracle signals", () => {
    expect(orgPlan(undefined)).toBeUndefined();
    expect(orgPlan("free_v2")).toBe("free");
    expect(orgPlan("Pro")).toBe("paid");
    expect(upstashPlan([])).toBeUndefined();
    expect(upstashPlan(["free", "free"])).toBe("free");
    expect(upstashPlan(["free", "payg"])).toBe("paid");
    expect(upstashPlan(["free", undefined])).toBeUndefined();
    expect(upstashBilling(undefined)).toBeUndefined();
    expect(upstashBilling("free")).toBe("free_tier");
    expect(upstashBilling("pro")).toBe("billable");
    expect(ociShapeBilling("VM.Standard.A1.Flex")).toBe("free_tier");
    expect(ociShapeBilling("VM.Standard.E2.1.Micro")).toBe("free_tier");
    expect(ociShapeBilling("VM.Standard3.Flex")).toBe("billable");
    expect(ociPlan(["free_tier", undefined])).toBeUndefined();
    expect(ociPlan(["free_tier", "billable"])).toBe("paid");
    expect(resourceBilling({ billing: "billable" })).toBe("billable");
    expect(resourceBilling({ billing: "other" })).toBe("unknown");
    expect(resourceBilling(null)).toBe("unknown");
  });
  it("hides paid resources on free accounts and can hide them everywhere", () => {
    const snapshot = { accounts: [{ id: "f", plan: "free" }, { id: "p", plan: "paid" }], resources: [{ accountId: "f", billing: "billable" }, { accountId: "p", billing: "billable" }, { accountId: "p", billing: "free_tier" }, { accountId: null, billing: "billable" }] };
    expect(applyBilling(snapshot, true).resources).toEqual([{ accountId: "p", billing: "billable" }, { accountId: "p", billing: "free_tier" }, { accountId: null, billing: "billable" }]);
    expect(applyBilling(snapshot, false).resources).toEqual([{ accountId: "p", billing: "free_tier" }]);
    expect(applyBilling({ accounts: [], resources: [{ accountId: "x" }] }, false).resources).toHaveLength(1);
    expect(hasPaidResources(snapshot)).toBe(true);
    expect(hasPaidResources({ accounts: snapshot.accounts.slice(0, 1), resources: [snapshot.resources[0]] })).toBe(false);
  });
});

describe("collectors report the account plan", () => {
  it("Cloudflare: paid zone proves paid and marks that zone billable", async () => {
    cf(cfZones({ legacy_id: "free" }, { legacy_id: "pro", name: "Pro Website" }), 403);
    const result = await collectInventory("cloudflare", { apiToken: "t", accountId: "acct" }, signal);
    expect(result.plan).toBe("paid");
    expect(result.resources.map(item => item.billing)).toEqual(["free_tier", "billable"]);
  });
  it("Cloudflare: free needs readable billing; an unreadable list leaves the plan undetected", async () => {
    cf(cfZones({ legacy_id: "free" }), { success: true, result: [] });
    expect((await collectInventory("cloudflare", { apiToken: "t", accountId: "acct" }, signal)).plan).toBe("free");
    cf(cfZones({ legacy_id: "free" }), 403);
    expect((await collectInventory("cloudflare", { apiToken: "t", accountId: "acct" }, signal)).plan).toBeUndefined();
    cf(cfZones(undefined), { success: true, result: [] });
    const unknown = await collectInventory("cloudflare", { apiToken: "t", accountId: "acct" }, signal);
    expect(unknown.plan).toBeUndefined();
    expect(unknown.resources[0].billing).toBeUndefined();
  });
  it("a plan lookup that times out fails the scan, not the plan", async () => {
    const controller = new AbortController();
    cf(cfZones({ legacy_id: "free" }), { success: true, result: [] });
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { if (String(url).includes("/subscriptions")) { controller.abort(); throw new Error("aborted"); } return base(url, init); }) as typeof globalThis.fetch;
    await expect(collectInventory("cloudflare", { apiToken: "t", accountId: "acct" }, controller.signal)).rejects.toMatchObject({ code: "scan_timeout" });
  });
  it("Supabase and Neon read the organisation plan, ignoring lookup failures", async () => {
    routes({ "/v1/organizations/": { plan: "pro" }, "/v1/projects": [{ id: "p1", name: "P", organization_id: "org-a" }] });
    expect((await collectInventory("supabase", { accessToken: "t", organizationId: "org-a" }, signal)).plan).toBe("paid");
    routes({ "/v1/organizations/": 500, "/v1/projects": [] });
    expect((await collectInventory("supabase", { accessToken: "t", organizationId: "org-a" }, signal)).plan).toBeUndefined();
    routes({ "/organizations/": { plan: "free_v2" }, "/projects": { projects: [] } });
    expect((await collectInventory("neon", { apiKey: "k", organizationId: "org-a" }, signal)).plan).toBe("free");
  });
  it("Upstash derives plan and billing from database types", async () => {
    routes({ "/redis/databases": [{ database_id: "d1", database_name: "a", type: "free" }, { database_id: "d2", database_name: "b", type: "payg" }] });
    const result = await collectInventory("upstash", { apiEmail: "o@example.test", apiKey: "k" }, signal);
    expect(result.plan).toBe("paid");
    expect(result.resources.map(item => item.billing)).toEqual(["free_tier", "billable"]);
  });
});
