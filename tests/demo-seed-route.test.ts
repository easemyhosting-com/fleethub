import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ seed: vi.fn(), begin: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({
  bootstrapDatabase: vi.fn(async () => ({ success: true })),
  seedInitialIdentitiesAndAccounts: fixture.seed,
  demoSeedIds: { accounts: ["a"], resources: ["r"], gateways: ["g"], identities: ["i"] },
}));
vi.mock("@/lib/db/client", () => ({ queryClient: { begin: fixture.begin } }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/auth/sessions", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/auth/sessions")>()), resolveSession: fixture.resolve }));
import { createSessionToken } from "../src/lib/auth/session";
import { DELETE, POST } from "../src/app/api/demo/seed/route";

const user = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local" as const, createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
const origin = "http://localhost:3060";
const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
let counter = 0;
const cookie = () => `fleethub_session=${createSessionToken({ ...user, sid, id: `usr-${counter += 1}` })}`;
const call = (handler: typeof POST, method: string, headers: Record<string, string> = {}) => handler(new Request(`${origin}/api/demo/seed`, { method, headers }));
const asSession = (scope: "operator" | "read") => { fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope }); return { cookie: cookie(), ...sameOrigin }; };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "demo-route-secret-at-least-32-bytes-long!!"); vi.stubEnv("FLEETHUB_API_KEY", "demo-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "demo-reader-fixture");
  fixture.seed.mockReset().mockResolvedValue(undefined); fixture.begin.mockReset().mockResolvedValue(undefined);
  fixture.resolve.mockReset().mockResolvedValue({ user: null, failure: "none" });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/demo/seed", () => {
  for (const [method, handler] of [["POST", POST], ["DELETE", DELETE]] as const) {
    it(`${method} refuses anonymous, read-only and non-operator callers without touching data`, async () => {
      expect((await call(handler, method)).status).toBe(401);
      expect((await call(handler, method, { authorization: "Bearer demo-reader-fixture" })).status).toBeGreaterThanOrEqual(401);
      expect((await call(handler, method, { authorization: "Bearer demo-reader-fixture" })).status).toBeLessThan(500);
      expect((await call(handler, method, asSession("read"))).status).toBeGreaterThanOrEqual(401);
      expect(fixture.seed).not.toHaveBeenCalled();
      expect(fixture.begin).not.toHaveBeenCalled();
    });
  }

  it("seeds for an operator session and for the admin key", async () => {
    expect((await call(POST, "POST", asSession("operator"))).status).toBe(200);
    expect((await call(POST, "POST", { authorization: "Bearer demo-admin-fixture" })).status).toBe(200);
    expect(fixture.seed).toHaveBeenCalledTimes(2);
  });

  it("resets in one transaction for an operator and reports failure without details", async () => {
    expect((await call(DELETE, "DELETE", asSession("operator"))).status).toBe(200);
    expect(fixture.begin).toHaveBeenCalledTimes(1);
    fixture.begin.mockRejectedValue(new Error("violates foreign key constraint on secret_table"));
    const failed = await call(DELETE, "DELETE", asSession("operator"));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("secret_table");
    fixture.seed.mockRejectedValue(new Error("seed internals"));
    const seedFailed = await call(POST, "POST", asSession("operator"));
    expect(seedFailed.status).toBe(500);
    expect(JSON.stringify(await seedFailed.json())).not.toContain("internals");
  });
});
