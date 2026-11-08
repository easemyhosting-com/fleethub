import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), resolve: vi.fn(), s: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/auth/sessions", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/auth/sessions")>()), resolveSession: fixture.resolve }));
vi.mock("@/lib/entitlements/service", async importOriginal => {
  const original = await importOriginal<typeof import("../src/lib/entitlements/service")>();
  for (const name of ["listLimits", "setEntitlement", "setAllowance", "deleteAllowance"]) fixture.s[name] = vi.fn();
  return { ...original, ...fixture.s };
});
import { createSessionToken } from "../src/lib/auth/session";
import { LimitsError } from "../src/lib/entitlements/service";
import { GET, POST } from "../src/app/api/capacity/limits/route";

const user = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local" as const, createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
let counter = 0;
const cookie = () => `fleethub_session=${createSessionToken({ ...user, sid, id: `usr-${counter += 1}` })}`;
const origin = "http://localhost:3060"; const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
const post = (body: unknown, headers: Record<string, string> = { cookie: cookie(), ...sameOrigin }) => POST(new Request(`${origin}/api/capacity/limits`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const operator = () => fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
const id = "cloudflare.workers_ai.neurons";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "limits-route-secret-at-least-32-bytes!!"); vi.stubEnv("FLEETHUB_API_KEY", "limits-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "limits-reader-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true }); fixture.resolve.mockReset().mockResolvedValue({ user: null, failure: "none" });
  for (const mock of Object.values(fixture.s)) mock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/capacity/limits", () => {
  it("lets readers list limits and refuses anonymous callers", async () => {
    expect((await GET(new Request(`${origin}/api/capacity/limits`))).status).toBe(401);
    fixture.s.listLimits.mockResolvedValue({ entitlements: [], allowances: [], events: [] });
    const ok = await GET(new Request(`${origin}/api/capacity/limits`, { headers: { authorization: "Bearer limits-reader-fixture" } }));
    expect(ok.status).toBe(200); expect(ok.headers.get("cache-control")).toBe("no-store");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await GET(new Request(`${origin}/api/capacity/limits`, { headers: { authorization: "Bearer limits-reader-fixture" } }))).status).toBe(503);
  });

  it("only operators may change limits", async () => {
    const body = { action: "set_allowance", entitlementId: id, scopeType: "global", limit: 5 };
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, { authorization: "Bearer limits-reader-fixture" })).status).toBe(403);
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "read" });
    expect((await post(body)).status).toBe(403);
    expect(fixture.s.setAllowance).not.toHaveBeenCalled();
  });

  it("validates strictly", async () => {
    operator();
    for (const body of [
      { action: "set_allowance", entitlementId: "bad id", scopeType: "global", limit: 1 },
      { action: "set_allowance", entitlementId: id, scopeType: "global", limit: -1 },
      { action: "set_allowance", entitlementId: id, scopeType: "global", limit: 1, extra: true },
      { action: "set_entitlement", id, limit: 1e13 },
      { action: "set_entitlement", id, sourceUrl: "javascript:alert(1)" },
      { action: "delete_allowance", id: "nope" }, { action: "other" },
    ]) expect((await post(body)).status).toBe(400);
  });

  it("applies each action with the signed-in actor and maps errors", async () => {
    operator();
    expect((await post({ action: "set_entitlement", id, limit: 20000, verification: "reported", note: null })).status).toBe(200);
    expect(fixture.s.setEntitlement).toHaveBeenCalledWith(id, { limit: 20000, verification: "reported", note: null }, "op@example.test");
    expect((await post({ action: "set_allowance", entitlementId: id, scopeType: "account", scopeId: "acc-1", limit: 5000, reason: "keep headroom" })).status).toBe(200);
    expect(fixture.s.setAllowance).toHaveBeenCalledWith({ entitlementId: id, scopeType: "account", scopeId: "acc-1", limit: 5000, reason: "keep headroom" }, "op@example.test");
    expect((await post({ action: "delete_allowance", id: `alw-${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}` })).status).toBe(200);
    fixture.s.setAllowance.mockRejectedValueOnce(new LimitsError("not_found"));
    expect((await post({ action: "set_allowance", entitlementId: id, scopeType: "global", limit: 1 })).status).toBe(404);
    fixture.s.setAllowance.mockRejectedValueOnce(new LimitsError("invalid"));
    expect((await post({ action: "set_allowance", entitlementId: id, scopeType: "account", limit: 1 })).status).toBe(400);
    fixture.s.setAllowance.mockRejectedValueOnce(new Error("postgres://secret leaked"));
    const failed = await post({ action: "set_allowance", entitlementId: id, scopeType: "global", limit: 1 });
    expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("postgres://");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await post({ action: "set_allowance", entitlementId: id, scopeType: "global", limit: 1 })).status).toBe(503);
  });
});
