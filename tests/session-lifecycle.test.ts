import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ user: undefined as undefined | Record<string, string>, create: vi.fn(), revoke: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/db/client", () => ({ queryClient: Object.assign(async (strings: TemplateStringsArray) => strings.join("?").trim().startsWith("SELECT id, email") && fixture.user ? [fixture.user] : [], { begin: async () => null }) }));
vi.mock("@/lib/auth/sessions", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/auth/sessions")>()), createServerSession: fixture.create, revokeSession: fixture.revoke, resolveSession: fixture.resolve }));
import { POST, GET } from "../src/app/api/auth/route";
import { SessionLimitReached } from "../src/lib/auth/sessions";
import { createSessionToken, hashPassword, verifySessionToken } from "../src/lib/auth/session";
const origin = "http://localhost:3060"; const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request(`${origin}/api/auth`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
beforeEach(async () => {
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_APP_URL", origin); vi.stubEnv("FLEETHUB_AUTH_SECRET", "lifecycle-secret-at-least-32-bytes!!!");
 fixture.user = { id: "usr-1", email: "op@example.test", name: "Op", auth_provider: "local", password_hash: await hashPassword("correct-horse-battery") };
 fixture.create.mockReset().mockResolvedValue(sid); fixture.revoke.mockReset().mockResolvedValue(true); fixture.resolve.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("server-side session lifecycle in the auth route", () => {
 it("creates a revocable browser session at login and keeps the session id out of the response body", async () => {
  const response = await post({ action: "login", email: "op@example.test", password: "correct-horse-battery" }, { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120 Safari/537" });
  expect(response.status).toBe(200); expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ email: "op@example.test" }), "browser", "operator", "Chrome on macOS");
  const body = await response.json(); expect(JSON.stringify(body)).not.toContain(sid);
  expect(verifySessionToken(/fleethub_session=([^;]+)/.exec(response.headers.get("set-cookie")!)![1])).toMatchObject({ sid });
 });
 it("refuses to sign in when the session cap is reached or storage fails, without setting a cookie", async () => {
  fixture.create.mockRejectedValueOnce(new SessionLimitReached()); const capped = await post({ action: "login", email: "op@example.test", password: "correct-horse-battery" });
  expect(capped.status).toBe(429); expect(capped.headers.get("set-cookie")).toBeNull();
  fixture.create.mockRejectedValueOnce(new Error("private-diagnostic")); const failed = await post({ action: "login", email: "op@example.test", password: "correct-horse-battery" });
  expect(failed.status).toBe(503); expect(failed.headers.get("set-cookie")).toBeNull(); expect(JSON.stringify(await failed.json())).not.toContain("private-diagnostic");
 });
 it("revokes the server session on logout and still clears the cookie if revocation fails", async () => {
  const cookie = `fleethub_session=${createSessionToken({ id: "usr-1", email: "op@example.test", name: "Op", provider: "local", createdAt: Date.now(), sid })}`;
  const out = await post({ action: "logout" }, { cookie }); expect(fixture.revoke).toHaveBeenCalledWith(sid); expect(await out.json()).toEqual({ success: true, serverRevoked: true }); expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  fixture.revoke.mockRejectedValueOnce(new Error("x")); const failed = await post({ action: "logout" }, { cookie }); expect(await failed.json()).toEqual({ success: true, serverRevoked: false }); expect(failed.headers.get("set-cookie")).toContain("Max-Age=0");
  fixture.revoke.mockClear(); expect(await (await post({ action: "logout" })).json()).toEqual({ success: true, serverRevoked: true }); expect(fixture.revoke).not.toHaveBeenCalled();
 });
 it("signs in from an additional allowed origin with a cookie suited to that origin, and refuses other origins", async () => {
  const canonical = "https://fleet.tailnet.ts.net:8443";
  vi.stubEnv("FLEETHUB_APP_URL", canonical); vi.stubEnv("FLEETHUB_ALLOWED_ORIGINS", "http://localhost:3060");
  const login = (from: string) => POST(new Request(`${canonical}/api/auth`, { method: "POST", headers: { origin: from, "content-type": "application/json" }, body: JSON.stringify({ action: "login", email: "op@example.test", password: "correct-horse-battery" }) }));
  const local = await login("http://localhost:3060"); expect(local.status).toBe(200); expect(local.headers.get("set-cookie")).not.toContain("Secure");
  const remote = await login(canonical); expect(remote.status).toBe(200); expect(remote.headers.get("set-cookie")).toContain("Secure");
  expect((await login("http://localhost:3999")).status).toBe(403); expect((await login("https://evil.example")).status).toBe(403);
 });
 it("reports a revoked session as signed out", async () => {
  fixture.resolve.mockResolvedValue({ user: null, failure: "inactive" });
  const status = await (await GET(new Request(`${origin}/api/auth`))).json(); expect(status).toMatchObject({ authenticated: false, user: null });
  fixture.resolve.mockResolvedValue({ user: { id: "usr-1", email: "op@example.test", name: "Op", provider: "local", createdAt: 1, sid }, scope: "operator" });
  const active = await (await GET(new Request(`${origin}/api/auth`))).json(); expect(active.user).toEqual({ id: "usr-1", email: "op@example.test", name: "Op", provider: "local", createdAt: 1 });
 });
});
