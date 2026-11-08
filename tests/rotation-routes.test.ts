import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), resolve: vi.fn(), s: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/auth/sessions", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/auth/sessions")>()), resolveSession: fixture.resolve }));
vi.mock("@/lib/rotation/service", () => {
  for (const name of ["configureRotation", "listRotation", "replaceCredentials", "rotateNow", "setManualExpiry"]) fixture.s[name] = vi.fn();
  return { ...fixture.s };
});
import { createSessionToken } from "../src/lib/auth/session";
import { RotationError } from "../src/lib/rotation/types";
import { GET, POST } from "../src/app/api/rotation/route";

const user = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local" as const, createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
let counter = 0;
const cookie = () => `fleethub_session=${createSessionToken({ ...user, sid, id: `usr-${counter += 1}` })}`;
const origin = "http://localhost:3060"; const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
const post = (body: unknown, headers: Record<string, string> = { cookie: cookie(), ...sameOrigin }) => POST(new Request(`${origin}/api/rotation`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const operator = () => fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "rotation-route-secret-at-least-32-bytes!!"); vi.stubEnv("FLEETHUB_API_KEY", "rotation-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "rotation-reader-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true }); fixture.resolve.mockReset().mockResolvedValue({ user: null, failure: "none" });
  for (const mock of Object.values(fixture.s)) mock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/rotation", () => {
  it("lets any authorized reader see rotation status and refuses anonymous callers", async () => {
    expect((await GET(new Request(`${origin}/api/rotation`))).status).toBe(401);
    fixture.s.listRotation.mockResolvedValue({ rotators: [], accounts: [], events: [] });
    const response = await GET(new Request(`${origin}/api/rotation`, { headers: { authorization: "Bearer rotation-reader-fixture" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await GET(new Request(`${origin}/api/rotation`, { headers: { authorization: "Bearer rotation-reader-fixture" } }))).status).toBe(503);
  });

  it("changes credentials only for operators", async () => {
    const body = { action: "rotate", accountId: "acc-1" };
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, { authorization: "Bearer rotation-reader-fixture" })).status).toBe(403);
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "read" });
    expect((await post(body)).status).toBe(403);
    expect(fixture.s.rotateNow).not.toHaveBeenCalled();
  });

  it("validates strictly and never echoes submitted credentials", async () => {
    operator();
    expect((await post({ action: "replace", accountId: "bad id!", config: {} })).status).toBe(400);
    expect((await post({ action: "rotate", accountId: "a", extra: 1 })).status).toBe(400);
    expect((await post({ action: "configure", accountId: "a", scheduleDays: 400 })).status).toBe(400);
    expect((await post({ action: "unknown" })).status).toBe(400);
    fixture.s.replaceCredentials.mockRejectedValue(new RotationError("invalid_config", ["apiToken"]));
    const failed = await post({ action: "replace", accountId: "acc-1", config: { apiToken: "super-secret-value" } });
    expect(failed.status).toBe(400);
    const text = JSON.stringify(await failed.json());
    expect(text).toContain("Check: apiToken");
    expect(text).not.toContain("super-secret-value");
  });

  it("saves and clears a manual expiry date, rejecting malformed dates", async () => {
    operator();
    expect((await post({ action: "expiry", accountId: "acc-1", expiresOn: "2027-01-31" })).status).toBe(200);
    expect(fixture.s.setManualExpiry).toHaveBeenCalledWith("acc-1", "2027-01-31", "op@example.test");
    expect((await post({ action: "expiry", accountId: "acc-1", expiresOn: null })).status).toBe(200);
    expect(fixture.s.setManualExpiry).toHaveBeenLastCalledWith("acc-1", null, "op@example.test");
    for (const expiresOn of ["tomorrow", "2027-13-45", 5]) expect((await post({ action: "expiry", accountId: "acc-1", expiresOn })).status).toBe(400);
  });

  it("runs replace, rotate and configure for operators with the signed-in actor", async () => {
    operator();
    expect((await post({ action: "replace", accountId: "acc-1", config: { apiToken: "t", accountId: "a" } })).status).toBe(200);
    expect(fixture.s.replaceCredentials).toHaveBeenCalledWith("acc-1", { apiToken: "t", accountId: "a" }, "manual", "op@example.test");
    expect((await post({ action: "rotate", accountId: "acc-1" })).status).toBe(200);
    expect(fixture.s.rotateNow).toHaveBeenCalledWith("acc-1", "rotate", "op@example.test");
    expect((await post({ action: "configure", accountId: "acc-1", rotatorSecret: "r", scheduleDays: 30 })).status).toBe(200);
    expect(fixture.s.configureRotation).toHaveBeenCalledWith("acc-1", expect.objectContaining({ rotatorSecret: "r", scheduleDays: 30 }), "op@example.test");
    const removed = await post({ action: "configure", accountId: "acc-1", removeRotator: true });
    expect((await removed.json()).message).toBe("Rotation credential removed.");
  });

  it("maps failures to status codes and hides unexpected errors", async () => {
    operator();
    fixture.s.rotateNow.mockRejectedValueOnce(new RotationError("busy"));
    expect((await post({ action: "rotate", accountId: "a" })).status).toBe(409);
    fixture.s.rotateNow.mockRejectedValueOnce(new RotationError("provider_rejected"));
    expect((await post({ action: "rotate", accountId: "a" })).status).toBe(502);
    fixture.s.rotateNow.mockRejectedValueOnce(new Error("postgres://user:pw@host leaked"));
    const unexpected = await post({ action: "rotate", accountId: "a" });
    expect(unexpected.status).toBe(500);
    expect(JSON.stringify(await unexpected.json())).not.toContain("postgres://");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await post({ action: "rotate", accountId: "a" })).status).toBe(503);
  });
});
