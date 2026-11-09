import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/db/client", () => ({
 queryClient: Object.assign((...args: unknown[]) => db.query(...args), { begin: async (work: (tx: unknown) => unknown) => work((...args: unknown[]) => db.tx(...args)) }),
}));
import { createSessionCookie, createSessionToken, type SessionUser } from "../src/lib/auth/session";
import { verifyApiAccess } from "../src/lib/auth/guard";
import * as store from "../src/lib/auth/sessions";
const sql = (call: unknown[]) => (call[0] as string[]).join("?");
const user: SessionUser = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local", createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
const cookieFor = (value: SessionUser) => `fleethub_session=${createSessionToken(value)}`;
const request = (value: SessionUser | null, method = "GET", headers: Record<string, string> = {}) => new Request("http://localhost/api/fleet", { method, headers: { ...(value ? { cookie: cookieFor(value) } : {}), ...headers } });
const sessionRow = (extra = {}) => ({ id: sid, kind: "browser", scope: "operator", label: "Safari on iOS", user_email: user.email, created_at: new Date("2026-01-01"), last_seen_at: null, expires_at: new Date(Date.now() + 86_400_000), revoked_at: null, ...extra });
beforeEach(() => {
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", "http://localhost"); vi.stubEnv("FLEETHUB_AUTH_SECRET", "session-store-secret-at-least-32-bytes!!");
 vi.stubEnv("FLEETHUB_API_KEY", "session-admin-fixture"); db.query.mockReset(); db.tx.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("pairing codes and client labels", () => {
 it("generates unambiguous 12-character codes that normalize and hash consistently", () => {
  const code = store.generatePairingCode(); expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  expect(store.generatePairingCode()).not.toBe(code);
  expect(store.hashPairingCode(code)).toBe(store.hashPairingCode(` ${code.toLowerCase().replaceAll("-", " ")} `)); expect(store.hashPairingCode(code)).not.toContain(code);
 });
 it("describes the client without storing the raw user agent", () => {
  const label = (agent: string) => store.describeClient(new Request("http://x", { headers: { "user-agent": agent } }));
  expect(label("Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Safari/605")).toBe("Safari on iOS");
  expect(label("Mozilla/5.0 (Linux; Android 14) Chrome/120 Safari/537")).toBe("Chrome on Android");
  expect(label("Mozilla/5.0 (Macintosh) Gecko Firefox/121.0")).toBe("Firefox on macOS");
  expect(label("Mozilla/5.0 (Windows NT 10) Chrome/120 Edg/120")).toBe("Edge on Windows");
  expect(label("Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537")).toBe("Chrome on Linux");
  expect(store.describeClient(new Request("http://x"))).toBe("Browser");
 });
 it("validates pairing input and exposes only public user fields", () => {
  expect(store.pairingInput.parse({ label: " Phone " })).toEqual({ label: "Phone", scope: "read", expiresInMinutes: 10 });
  for (const bad of [{}, { label: "" }, { label: "p", scope: "admin" }, { label: "p", expiresInMinutes: 31 }, { label: "p", extra: 1 }]) expect(store.pairingInput.safeParse(bad).success).toBe(false);
  expect(store.redeemInput.safeParse({ code: "short" }).success).toBe(false);
  expect(store.publicUser({ ...user, sid, exp: 1 })).toEqual({ id: user.id, email: user.email, name: user.name, provider: "local", createdAt: user.createdAt });
 });
});

describe("server-side sessions", () => {
 it("creates a session row with scope, label and lifetime, pruning old rows and enforcing the cap", async () => {
  db.tx.mockImplementation(async (...call: unknown[]) => sql(call as unknown[]).includes("COUNT") ? [{ active: 0 }] : []);
  const id = await store.createServerSession(user, "device", "read", "Phone"); expect(id).toMatch(/^ses-/);
  const insert = db.tx.mock.calls.find(call => sql(call as unknown[]).includes("INSERT INTO auth_sessions")) as unknown[];
  expect(insert.slice(1)).toEqual(expect.arrayContaining([id, "usr-1", "device", "read", "Phone", store.deviceSessionDays]));
  expect(db.tx.mock.calls.some(call => sql(call as unknown[]).includes("DELETE FROM auth_sessions"))).toBe(true);
  await store.createServerSession(user, "browser", "operator", "Chrome");
  expect((db.tx.mock.calls.at(-1) as unknown[]).slice(1)).toContain(store.browserSessionDays);
  db.tx.mockImplementation(async (...call: unknown[]) => sql(call as unknown[]).includes("COUNT") ? [{ active: store.maxActiveSessions }] : []);
  await expect(store.createServerSession(user, "browser", "operator", "x")).rejects.toBeInstanceOf(store.SessionLimitReached);
 });
 it("checks sessions, touching last seen at most hourly and failing closed", async () => {
  expect(await store.checkSession(undefined)).toEqual({ status: "inactive" });
  db.query.mockResolvedValueOnce([]); expect(await store.checkSession(sid)).toEqual({ status: "inactive" });
  db.query.mockReset().mockResolvedValueOnce([{ scope: "read", last_seen_at: new Date() }]); expect(await store.checkSession(sid)).toEqual({ status: "active", scope: "read" }); expect(db.query).toHaveBeenCalledTimes(1);
  db.query.mockReset().mockResolvedValueOnce([{ scope: "operator", last_seen_at: new Date(Date.now() - 2 * 3600_000) }]).mockResolvedValueOnce([]);
  await store.checkSession(sid); expect(sql(db.query.mock.calls[1])).toContain("UPDATE auth_sessions");
  db.query.mockReset().mockResolvedValueOnce([{ scope: "operator", last_seen_at: null }]).mockResolvedValueOnce([]); await store.checkSession(sid); expect(db.query).toHaveBeenCalledTimes(2);
  db.query.mockReset().mockRejectedValue(new Error("private-diagnostic")); expect(await store.checkSession(sid)).toEqual({ status: "unavailable" });
 });
 it("resolves cookie sessions only when the signed session still exists server-side", async () => {
  expect(await store.resolveSession(request(null))).toEqual({ user: null, failure: "none" });
  expect(await store.resolveSession(request({ ...user, id: "proxy:op@example.test" }))).toMatchObject({ scope: "operator" }); expect(db.query).not.toHaveBeenCalled();
  expect(await store.resolveSession(request(user))).toEqual({ user: null, failure: "inactive" });
  db.query.mockResolvedValueOnce([{ scope: "read", last_seen_at: new Date() }]);
  expect(await store.resolveSession(request({ ...user, sid }))).toMatchObject({ scope: "read", user: { sid } });
  db.query.mockReset().mockRejectedValue(new Error("x")); expect(await store.resolveSession(request({ ...user, sid }))).toEqual({ user: null, failure: "unavailable" });
 });
 it("lists, revokes and revokes the others", async () => {
  db.query.mockResolvedValueOnce([sessionRow(), sessionRow({ id: "ses-2", revoked_at: new Date() }), sessionRow({ id: "ses-3", expires_at: new Date(Date.now() - 1000), last_seen_at: new Date() })]);
  expect((await store.listSessions()).map(item => item.status)).toEqual(["active", "revoked", "expired"]);
  db.query.mockReset().mockResolvedValueOnce([{ id: sid }]).mockResolvedValueOnce([]); expect(await store.revokeSession(sid)).toBe(true); expect(await store.revokeSession("ses-none")).toBe(false);
  db.query.mockReset().mockResolvedValue([{ id: "a" }, { id: "b" }]); expect(await store.revokeOtherSessions(sid)).toBe(2); await expect(store.revokeOtherSessions(undefined)).rejects.toThrow(); expect(db.query).toHaveBeenCalledTimes(1);
  for (const call of db.query.mock.calls) expect(sql(call as unknown[])).toMatch(/UPDATE device_pairings SET cancelled_at = NOW\(\) WHERE created_by_session IN \(SELECT id FROM revoked\)/);
  db.query.mockReset().mockResolvedValueOnce([{ id: sid }]); await store.revokeSession(sid); expect(sql(db.query.mock.calls[0] as unknown[])).toContain("created_by_session IN (SELECT id FROM revoked)");
  const missingColumn = Object.assign(new Error('column "created_by_session" does not exist'), { code: "42703" });
  db.query.mockReset().mockRejectedValueOnce(missingColumn).mockResolvedValueOnce([{ id: sid }]); expect(await store.revokeSession(sid)).toBe(true);
  db.query.mockRejectedValueOnce(missingColumn).mockResolvedValueOnce([{ id: "a" }, { id: "b" }]); expect(await store.revokeOtherSessions(sid)).toBe(2);
  expect(db.query).toHaveBeenCalledTimes(4); for (const call of [db.query.mock.calls[1], db.query.mock.calls[3]]) expect(sql(call as unknown[])).toMatch(/^UPDATE auth_sessions SET revoked_at[\s\S]*RETURNING id$/);
  db.query.mockReset().mockRejectedValueOnce(Object.assign(new Error("down"), { code: "57P01" })); await expect(store.revokeSession(sid)).rejects.toThrow("down"); expect(db.query).toHaveBeenCalledTimes(1);
 });
});

describe("pairing lifecycle", () => {
 const pairingRow = (extra = {}) => ({ id: "pair-1", label: "Phone", scope: "read", created_by_id: user.id, created_by_email: user.email, created_by_name: user.name, provider: "local", created_at: new Date(), expires_at: new Date(Date.now() + 600_000), consumed_at: null, cancelled_at: null, ...extra });
 it("stores only a hash of a one-time code and caps pending codes", async () => {
  db.tx.mockImplementation(async (...call: unknown[]) => sql(call as unknown[]).includes("COUNT") ? [{ pending: 0 }] : sql(call as unknown[]).includes("INSERT") ? [pairingRow()] : []);
  const created = await store.createPairing(store.pairingInput.parse({ label: "Phone" }), user);
  const insert = db.tx.mock.calls.find(call => sql(call as unknown[]).includes("INSERT INTO device_pairings")) as unknown[];
  expect(insert.slice(1)).toContain(store.hashPairingCode(created.code)); expect(insert.slice(1)).not.toContain(created.code); expect(created.status).toBe("pending");
  expect(insert.slice(1)).toContain(null);
  db.tx.mockClear(); await store.createPairing(store.pairingInput.parse({ label: "Phone" }), { ...user, sid });
  expect((db.tx.mock.calls.find(call => sql(call as unknown[]).includes("INSERT INTO device_pairings")) as unknown[]).slice(1)).toContain(sid);
  db.tx.mockImplementation(async (...call: unknown[]) => sql(call as unknown[]).includes("COUNT") ? [{ pending: store.maxPendingPairings }] : []);
  await expect(store.createPairing(store.pairingInput.parse({ label: "Phone" }), user)).rejects.toBeInstanceOf(store.PairingLimitReached);
 });
 it("lists statuses and cancels only unused codes", async () => {
  db.query.mockResolvedValueOnce([pairingRow(), pairingRow({ id: "p2", consumed_at: new Date() }), pairingRow({ id: "p3", cancelled_at: new Date() }), pairingRow({ id: "p4", expires_at: new Date(Date.now() - 1) })]);
  expect((await store.listPairings()).map(item => item.status)).toEqual(["pending", "used", "cancelled", "expired"]);
  db.query.mockReset().mockResolvedValueOnce([{ id: "pair-1" }]).mockResolvedValueOnce([]); expect(await store.cancelPairing("pair-1")).toBe(true); expect(await store.cancelPairing("pair-1")).toBe(false);
 });
 it("redeems a code atomically into a device session with the pairing's scope, and rejects unusable codes", async () => {
  db.tx.mockImplementation(async (...call: unknown[]) => sql(call as unknown[]).includes("UPDATE device_pairings") ? [pairingRow({ scope: "read" })] : sql(call as unknown[]).includes("COUNT") ? [{ active: 0 }] : []);
  const redeemed = await store.redeemPairing("abcd-efgh-jklm", "My iPhone");
  expect(redeemed).toMatchObject({ scope: "read", label: "My iPhone", user: { email: user.email } }); expect(redeemed!.sid).toMatch(/^ses-/);
  expect((db.tx.mock.calls[0] as unknown[]).slice(1)).toEqual([store.hashPairingCode("ABCDEFGHJKLM")]);
  expect(sql(db.tx.mock.calls[0] as unknown[])).toMatch(/created_by_session IS NULL OR EXISTS[\s\S]*revoked_at IS NULL AND creator\.expires_at > NOW\(\)/);
  expect((await store.redeemPairing("abcd-efgh-jklm"))!.label).toBe("Phone");
  db.tx.mockReset().mockResolvedValue([]); expect(await store.redeemPairing("zzzz-zzzz-zzzz")).toBeNull();
 });
 it("downgrades an operator code to read-only when the server limit was lowered after it was created", async () => {
  db.tx.mockReset().mockImplementation(async (...call: unknown[]) => sql(call as unknown[]).includes("UPDATE device_pairings") ? [pairingRow({ scope: "operator" })] : sql(call as unknown[]).includes("COUNT") ? [{ active: 0 }] : []);
  expect((await store.redeemPairing("abcd-efgh-jklm", undefined, "read"))!.scope).toBe("read");
  const inserted = db.tx.mock.calls.find(call => sql(call as unknown[]).includes("INSERT INTO auth_sessions"));
  expect(inserted as unknown[]).toContain("read");
  expect((await store.redeemPairing("abcd-efgh-jklm", undefined, "operator"))!.scope).toBe("operator");
 });
});

describe("guard enforcement of server-side sessions", () => {
 const origin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };
 it("accepts an active operator session and enforces origin for writes", async () => {
  db.query.mockResolvedValue([{ scope: "operator", last_seen_at: new Date() }]);
  expect(await verifyApiAccess(request({ ...user, sid }))).toMatchObject({ authorized: true, scope: "operator", user: { email: user.email } });
  expect(await verifyApiAccess(request({ ...user, sid }, "POST", origin))).toMatchObject({ authorized: true });
  expect(await verifyApiAccess(request({ ...user, sid }, "POST"))).toMatchObject({ authorized: false, status: 403 });
 });
 it("makes read-only devices unable to write", async () => {
  db.query.mockResolvedValue([{ scope: "read", last_seen_at: new Date() }]);
  expect(await verifyApiAccess(request({ ...user, sid }))).toMatchObject({ authorized: true, scope: "read" });
  expect(await verifyApiAccess(request({ ...user, sid }, "POST", origin))).toMatchObject({ authorized: false, status: 403, reason: expect.stringContaining("read-only") });
  expect(await verifyApiAccess(request({ ...user, sid }), { requireWrite: true })).toMatchObject({ authorized: false, status: 403 });
 });
 it("rejects revoked, expired and legacy sessions and fails closed when storage is down", async () => {
  db.query.mockResolvedValue([]);
  expect(await verifyApiAccess(request({ ...user, sid }))).toMatchObject({ authorized: false, status: 401, reason: expect.stringContaining("revoked") });
  expect(await verifyApiAccess(request(user))).toMatchObject({ authorized: false, status: 401 });
  db.query.mockReset().mockRejectedValue(new Error("x")); expect(await verifyApiAccess(request({ ...user, sid }))).toMatchObject({ authorized: false, status: 503 });
 });
 it("honours the absolute expiry carried in a device token", () => {
  const expired = createSessionToken({ ...user, sid, createdAt: Date.now() - 40 * 86_400_000, exp: Date.now() - 1000 });
  expect(createSessionCookie(expired, false, 99 * 86_400)).toContain(`Max-Age=${30 * 86_400}`);
  return expect(store.resolveSession(new Request("http://x", { headers: { cookie: `fleethub_session=${expired}` } }))).resolves.toEqual({ user: null, failure: "none" });
 });
});

describe("DELETE /api/sessions?others=true", () => {
 it("refuses without a caller sid instead of revoking every session", async () => {
  vi.resetModules();
  const revokeOtherSessions = vi.fn(async () => 99);
  vi.doMock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: vi.fn(async () => ({ success: true })) }));
  vi.doMock("@/lib/auth/guard", () => ({ verifyApiAccess: vi.fn(async () => ({ authorized: true })), isOperator: () => true, createUnauthorizedResponse: () => new Response(null, { status: 401 }) }));
  vi.doMock("@/lib/auth/session", () => ({ getSessionFromRequest: () => ({ id: "u", email: "op@example.com" }) }));
  vi.doMock("@/lib/auth/sessions", () => ({ listSessions: vi.fn(), revokeSession: vi.fn(), revokeOtherSessions }));
  const { DELETE } = await import("../src/app/api/sessions/route");
  const res = await DELETE(new Request("http://localhost/api/sessions?others=true", { method: "DELETE" }));
  expect(res.status).toBe(409);
  expect(revokeOtherSessions).not.toHaveBeenCalled();
  vi.doUnmock("@/lib/db/bootstrap"); vi.doUnmock("@/lib/auth/guard"); vi.doUnmock("@/lib/auth/session"); vi.doUnmock("@/lib/auth/sessions");
 });
});
