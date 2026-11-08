import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("../src/lib/inventory/collectors", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/inventory/collectors")>()), collectInventory: fixture.collect }));
import { CollectionError } from "../src/lib/inventory/model";
import { probeCredential } from "../src/lib/inventory/probe";

afterEach(() => fixture.collect.mockReset());
const cf = { apiToken: "t", accountId: "acct" };
const res = (product?: string, category = "network") => ({ nativeId: product ?? "x", name: "n", category, region: null, state: "online", providerState: null, sourceUrl: "https://x.test", ...(product ? { product } : {}) });

describe("test before save", () => {
  it("counts what is readable and names products the key cannot read", async () => {
    fixture.collect.mockResolvedValueOnce({ scope: "s", resources: [res("zone"), res("zone"), res(undefined, "compute")], covered: ["zone", "worker"], plan: "free" });
    expect(await probeCredential("cloudflare", cf)).toEqual({ ok: true, counts: { zone: 2, compute: 1 }, total: 3, missing: ["kv", "d1", "r2"], plan: "free" });
  });
  it("has nothing to say about coverage for providers that list one product", async () => {
    fixture.collect.mockResolvedValueOnce({ scope: "s", resources: [] });
    expect(await probeCredential("upstash", { apiEmail: "o@example.test", apiKey: "k" })).toEqual({ ok: true, counts: {}, total: 0, missing: [], plan: null });
  });
  it("turns failures into messages without echoing the credential", async () => {
    fixture.collect.mockRejectedValueOnce(new CollectionError("unauthorized"));
    const denied = await probeCredential("cloudflare", cf);
    expect(denied).toMatchObject({ ok: false, code: "unauthorized" });
    expect(JSON.stringify(denied)).not.toContain("acct");
    fixture.collect.mockRejectedValueOnce(new Error("boom"));
    expect(await probeCredential("cloudflare", cf)).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(await probeCredential("cloudflare", { apiToken: "t" })).toMatchObject({ ok: false, code: "invalid_config", fields: ["accountId"] });
    expect(await probeCredential("gcp", {})).toMatchObject({ ok: false, code: "unsupported" });
  });
});
