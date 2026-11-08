import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), resolve: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/auth/sessions", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/auth/sessions")>()), resolveSession: fixture.resolve }));
vi.mock("@/lib/fleet/profiles", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/fleet/profiles")>()), setProfile: fixture.set }));
import { createSessionToken } from "../src/lib/auth/session";
import { ProfileError } from "../src/lib/fleet/profiles";
import { POST } from "../src/app/api/resources/profile/route";

const user = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local" as const, createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
let counter = 0;
const cookie = () => `fleethub_session=${createSessionToken({ ...user, sid, id: `usr-${counter += 1}` })}`;
const origin = "http://localhost:3060"; const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
const post = (body: unknown, headers: Record<string, string> = { cookie: cookie(), ...sameOrigin }) => POST(new Request(`${origin}/api/resources/profile`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const operator = () => fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "profile-route-secret-at-least-32-bytes!!"); vi.stubEnv("FLEETHUB_API_KEY", "profile-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "profile-reader-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true }); fixture.set.mockReset(); fixture.resolve.mockReset().mockResolvedValue({ user: null, failure: "none" });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/resources/profile", () => {
  it("is operator-only", async () => {
    const body = { resourceId: "inv-1", profile: { role: "ci_runner" } };
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, { authorization: "Bearer profile-reader-fixture" })).status).toBe(403);
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "read" });
    expect((await post(body)).status).toBe(403);
    expect(fixture.set).not.toHaveBeenCalled();
  });
  it("validates against the fixed vocabulary", async () => {
    operator();
    for (const body of [{ resourceId: "", profile: {} }, { resourceId: "x", profile: { role: "wizard" } }, { resourceId: "x", profile: { extra: 1 } }]) expect((await post(body)).status).toBe(400);
  });
  it("saves with the signed-in actor and maps errors", async () => {
    operator();
    expect((await post({ resourceId: "inv-1", profile: { role: "ci_runner", labels: { site: "main" } } })).status).toBe(200);
    expect(fixture.set).toHaveBeenCalledWith("inv-1", { role: "ci_runner", labels: { site: "main" } }, "op@example.test");
    fixture.set.mockRejectedValueOnce(new ProfileError("not_found"));
    expect((await post({ resourceId: "inv-2", profile: {} })).status).toBe(404);
    fixture.set.mockRejectedValueOnce(new ProfileError("protected_auto_stop"));
    expect((await post({ resourceId: "inv-3", profile: { autoStop: "auto" } })).status).toBe(409);
    fixture.set.mockRejectedValueOnce(new Error("postgres://leak"));
    const failed = await post({ resourceId: "inv-4", profile: {} });
    expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("postgres://");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await post({ resourceId: "inv-5", profile: {} })).status).toBe(503);
  });
});
