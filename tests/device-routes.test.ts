import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), resolve: vi.fn(), limit: vi.fn(), s: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/auth/sessions", async importOriginal => {
 const original = await importOriginal<typeof import("../src/lib/auth/sessions")>();
 for (const name of ["listSessions", "revokeSession", "revokeOtherSessions", "createPairing", "listPairings", "cancelPairing", "redeemPairing"]) fixture.s[name] = vi.fn();
 return { ...original, ...fixture.s, resolveSession: fixture.resolve };
});
import { PairingLimitReached } from "../src/lib/auth/sessions";
import { createSessionToken, verifySessionToken } from "../src/lib/auth/session";
import { DELETE as deleteSession, GET as getSessions } from "../src/app/api/sessions/route";
import { DELETE as cancel, GET as getPairings, POST as createPairing } from "../src/app/api/devices/pairing/route";
import { POST as pair } from "../src/app/api/devices/pair/route";
const user = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local" as const, createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000"; const pairId = "pair-123e4567-e89b-12d3-a456-426614174000";
let counter = 0;
const cookie = (value = { ...user, sid }) => `fleethub_session=${createSessionToken({ ...value, id: `usr-${counter += 1}` })}`;
const origin = "http://localhost:3060"; const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
const req = (path: string, method: string, headers: Record<string, string> = {}, body?: unknown) => new Request(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const operator = () => fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
beforeEach(() => {
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin); vi.stubEnv("FLEETHUB_AUTH_SECRET", "device-route-secret-at-least-32-bytes!!"); vi.stubEnv("FLEETHUB_API_KEY", "device-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "device-reader-fixture");
 fixture.boot.mockReset().mockResolvedValue({ success: true }); fixture.resolve.mockReset().mockResolvedValue({ user: null, failure: "none" });
 for (const mock of Object.values(fixture.s)) mock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/sessions", () => {
 it("is limited to operators: devices, read-only keys and anonymous callers are refused", async () => {
  expect((await getSessions(req("/api/sessions", "GET"))).status).toBe(401);
  expect((await getSessions(req("/api/sessions", "GET", { authorization: "Bearer device-reader-fixture" }))).status).toBe(403);
  fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "read" });
  expect((await getSessions(req("/api/sessions", "GET", { cookie: cookie() }))).status).toBe(403);
  expect((await deleteSession(req("/api/sessions?id=" + sid, "DELETE", { cookie: cookie(), ...sameOrigin }))).status).toBe(403);
  expect(fixture.s.listSessions).not.toHaveBeenCalled(); expect(fixture.s.revokeSession).not.toHaveBeenCalled();
 });
 it("lists sessions with the current id and revokes by id or all others", async () => {
  operator(); fixture.s.listSessions.mockResolvedValue([{ id: sid }]);
  const listed = await getSessions(req("/api/sessions", "GET", { cookie: cookie() })); expect(await listed.json()).toEqual({ sessions: [{ id: sid }], currentId: sid });
  fixture.s.revokeSession.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("x"));
  const del = (query: string) => deleteSession(req(`/api/sessions${query}`, "DELETE", { cookie: cookie(), ...sameOrigin }));
  expect((await del(`?id=${sid}`)).status).toBe(200); expect((await del(`?id=${sid}`)).status).toBe(404); expect((await del(`?id=${sid}`)).status).toBe(503); expect((await del("?id=bad")).status).toBe(400);
  fixture.s.revokeOtherSessions.mockResolvedValue(3); expect(await (await del("?others=true")).json()).toEqual({ revoked: 3 }); expect(fixture.s.revokeOtherSessions).toHaveBeenCalledWith(sid);
  const admin = await getSessions(req("/api/sessions", "GET", { authorization: "Bearer device-admin-fixture" })); expect((await admin.json()).currentId).toBeNull();
 });
 it("reports storage failures without diagnostics", async () => {
  operator(); fixture.s.listSessions.mockRejectedValue(new Error("private-diagnostic"));
  const failed = await getSessions(req("/api/sessions", "GET", { cookie: cookie() })); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("private-diagnostic");
  fixture.boot.mockResolvedValue({ success: false }); expect((await getSessions(req("/api/sessions", "GET", { cookie: cookie() }))).status).toBe(503);
  expect((await deleteSession(req(`/api/sessions?id=${sid}`, "DELETE", { cookie: cookie(), ...sameOrigin }))).status).toBe(503);
 });
});

describe("/api/devices/pairing", () => {
 const call = (method: string, body?: unknown, query = "", headers: Record<string, string> = { cookie: cookie(), ...sameOrigin }) => req(`/api/devices/pairing${query}`, method, headers, body);
 it("requires an operator session to create, list or cancel codes", async () => {
  expect((await createPairing(call("POST", { label: "x" }, "", {}))).status).toBe(401);
  expect((await createPairing(call("POST", { label: "x" }, "", { authorization: "Bearer device-admin-fixture" }))).status).toBe(403);
  fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "read" });
  for (const handler of [createPairing, getPairings, cancel]) expect((await handler(call("POST", { label: "x" }))).status).toBe(403);
  expect(fixture.s.createPairing).not.toHaveBeenCalled();
 });
 it("creates a one-time code that is shown once, and validates input and the cap", async () => {
  operator(); fixture.s.createPairing.mockResolvedValue({ id: pairId, code: "ABCD-EFGH-JKLM", status: "pending" });
  const created = await createPairing(call("POST", { label: "iPhone", scope: "read", expiresInMinutes: 5 }));
  expect(created.status).toBe(201); expect(await created.json()).toMatchObject({ code: "ABCD-EFGH-JKLM", notice: expect.stringContaining("cannot be shown again") });
  expect(fixture.s.createPairing).toHaveBeenCalledWith({ label: "iPhone", scope: "read", expiresInMinutes: 5 }, expect.objectContaining({ email: user.email }));
  expect((await createPairing(call("POST", { label: "" }))).status).toBe(400); expect((await createPairing(call("POST", { label: "x", scope: "root" }))).status).toBe(400);
  fixture.s.createPairing.mockRejectedValueOnce(new PairingLimitReached()); expect((await createPairing(call("POST", { label: "x" }))).status).toBe(409);
  fixture.s.createPairing.mockRejectedValueOnce(new Error("x")); expect((await createPairing(call("POST", { label: "x" }))).status).toBe(503);
  fixture.boot.mockResolvedValue({ success: false }); expect((await createPairing(call("POST", { label: "x" }))).status).toBe(503);
 });
 it("enforces the pairing policy and reports it to the page", async () => {
  operator(); fixture.s.listPairings.mockResolvedValue([]);
  expect((await (await getPairings(call("GET", undefined, "", { cookie: cookie() }))).json()).options).toEqual({ enabled: true, qr: true, maxScope: "operator" });
  vi.stubEnv("FLEETHUB_PAIRING_QR", "off"); vi.stubEnv("FLEETHUB_PAIRING_MAX_SCOPE", "read");
  expect((await (await getPairings(call("GET", undefined, "", { cookie: cookie() }))).json()).options).toEqual({ enabled: true, qr: false, maxScope: "read" });
  const refused = await createPairing(call("POST", { label: "x", scope: "operator" })); expect(refused.status).toBe(403); expect(fixture.s.createPairing).not.toHaveBeenCalled();
  fixture.s.createPairing.mockResolvedValue({ id: pairId, code: "ABCD-EFGH-JKLM" }); expect((await createPairing(call("POST", { label: "x", scope: "read" }))).status).toBe(201);
  vi.stubEnv("FLEETHUB_DEVICE_PAIRING", "disabled"); fixture.s.createPairing.mockClear(); expect((await createPairing(call("POST", { label: "x", scope: "read" }))).status).toBe(403); expect(fixture.s.createPairing).not.toHaveBeenCalled();
 });
 it("lists pending codes without secrets and cancels them", async () => {
  operator(); fixture.s.listPairings.mockResolvedValue([{ id: pairId, label: "iPhone", status: "pending" }]);
  expect(await (await getPairings(call("GET", undefined, "", { cookie: cookie() }))).json()).toEqual({ pairings: [{ id: pairId, label: "iPhone", status: "pending" }], options: { enabled: true, qr: true, maxScope: "operator" } });
  fixture.s.cancelPairing.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("x"));
  expect((await cancel(call("DELETE", undefined, `?id=${pairId}`))).status).toBe(200); expect((await cancel(call("DELETE", undefined, `?id=${pairId}`))).status).toBe(404);
  expect((await cancel(call("DELETE", undefined, `?id=${pairId}`))).status).toBe(503); expect((await cancel(call("DELETE", undefined, "?id=x"))).status).toBe(400);
  fixture.s.listPairings.mockRejectedValue(new Error("x")); expect((await getPairings(call("GET", undefined, "", { cookie: cookie() }))).status).toBe(503);
  fixture.boot.mockResolvedValue({ success: false }); expect((await getPairings(call("GET", undefined, "", { cookie: cookie() }))).status).toBe(503); expect((await cancel(call("DELETE", undefined, `?id=${pairId}`))).status).toBe(503);
 });
});

describe("/api/devices/pair (public redeem)", () => {
 const redeem = (body: unknown, headers: Record<string, string> = sameOrigin) => pair(req("/api/devices/pair", "POST", headers, body));
 it("exchanges a valid code for a 30-day device session cookie that carries the server session id", async () => {
  fixture.s.redeemPairing.mockResolvedValue({ user, sid, scope: "read", label: "iPhone" });
  const response = await redeem({ code: "ABCD-EFGH-JKLM", label: "iPhone" });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, scope: "read", label: "iPhone" });
  const setCookie = response.headers.get("set-cookie")!; expect(setCookie).toContain("HttpOnly"); expect(setCookie).toContain(`Max-Age=${30 * 86_400}`);
  const session = verifySessionToken(/fleethub_session=([^;]+)/.exec(setCookie)![1]); expect(session).toMatchObject({ sid, email: user.email }); expect(session!.exp! - Date.now()).toBeGreaterThan(29 * 86_400_000);
 });
 it("rejects bad origins, missing secrets, malformed bodies and unusable codes with generic errors", async () => {
  expect((await redeem({ code: "ABCD-EFGH-JKLM" }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await redeem({ code: "ABCD-EFGH-JKLM" }, { origin, "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await redeem({ code: "x" })).status).toBe(400);
  fixture.s.redeemPairing.mockResolvedValueOnce(null); const refused = await redeem({ code: "ABCD-EFGH-JKLM" }); expect(refused.status).toBe(401); expect(refused.headers.get("set-cookie")).toBeNull();
  fixture.s.redeemPairing.mockRejectedValueOnce(new Error("private-diagnostic")); const failed = await redeem({ code: "ABCD-EFGH-JKLM" }); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("private-diagnostic");
  fixture.boot.mockResolvedValue({ success: false }); expect((await redeem({ code: "ABCD-EFGH-JKLM" })).status).toBe(503);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "short"); expect((await redeem({ code: "ABCD-EFGH-JKLM" })).status).toBe(503);
 });
 it("refuses redemption when pairing is disabled", async () => {
  vi.stubEnv("FLEETHUB_DEVICE_PAIRING", "disabled"); expect((await redeem({ code: "ABCD-EFGH-JKLM" })).status).toBe(403); expect(fixture.s.redeemPairing).not.toHaveBeenCalled();
 });
 it("reports a configuration error when the canonical origin is invalid", async () => {
  vi.stubEnv("FLEETHUB_APP_URL", "ftp://bad"); expect((await redeem({ code: "ABCD-EFGH-JKLM" })).status).toBe(403);
 });
});
