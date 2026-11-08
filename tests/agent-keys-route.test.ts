import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), create: vi.fn(), list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/auth/agent-keys", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/auth/agent-keys")>()), createAgentKey: fixture.create, listAgentKeys: fixture.list, revokeAgentKey: fixture.revoke }));
import { AgentKeyLimitReached } from "../src/lib/auth/agent-keys";
import { DELETE, GET, POST } from "../src/app/api/agent-keys/route";
const call = (method: string, token: string | null, body?: unknown, query = "") => new Request(`http://localhost/api/agent-keys${query}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const id = "agk-123e4567-e89b-12d3-a456-426614174000";
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_API_KEY", "route-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "route-reader-fixture");
 for (const mock of Object.values(fixture)) mock.mockReset(); fixture.boot.mockResolvedValue({ success: true }); });
afterEach(() => vi.unstubAllEnvs());
describe("/api/agent-keys", () => {
 it("is limited to write-capable credentials, including listing", async () => {
  for (const handler of [GET, POST, DELETE]) { expect((await handler(call("GET", null))).status).toBe(401); expect((await handler(call("POST", "route-reader-fixture", { label: "x" }, `?id=${id}`))).status).toBe(403); }
  expect(fixture.list).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled(); expect(fixture.revoke).not.toHaveBeenCalled();
 });
 it("creates a key, shows the secret once and attributes it to the principal", async () => {
  fixture.create.mockResolvedValue({ id, key: "fhk_secret", label: "Claude" });
  const response = await POST(call("POST", "route-admin-fixture", { label: "Claude", expiresInDays: 7 }));
  expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ key: "fhk_secret", notice: expect.stringContaining("cannot be shown again") });
  expect(fixture.create).toHaveBeenCalledWith({ label: "Claude", expiresInDays: 7 }, "api:admin");
 });
 it("validates input, reports the cap and storage failures", async () => {
  expect((await POST(call("POST", "route-admin-fixture", { label: "" }))).status).toBe(400);
  expect((await POST(call("POST", "route-admin-fixture", { label: "x", extra: true }))).status).toBe(400);
  fixture.create.mockRejectedValue(new AgentKeyLimitReached()); expect((await POST(call("POST", "route-admin-fixture", { label: "x" }))).status).toBe(409);
  fixture.create.mockRejectedValue(new Error("private-diagnostic")); const failed = await POST(call("POST", "route-admin-fixture", { label: "x" }));
  expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("private-diagnostic");
  fixture.boot.mockResolvedValue({ success: false }); expect((await POST(call("POST", "route-admin-fixture", { label: "x" }))).status).toBe(503);
  expect((await GET(call("GET", "route-admin-fixture"))).status).toBe(503); expect((await DELETE(call("DELETE", "route-admin-fixture", undefined, `?id=${id}`))).status).toBe(503);
 });
 it("lists keys without secrets and revokes by id", async () => {
  fixture.list.mockResolvedValue([{ id, label: "Claude", hint: "abcd", status: "active" }]);
  const listed = await GET(call("GET", "route-admin-fixture")); expect(await listed.json()).toEqual({ keys: [{ id, label: "Claude", hint: "abcd", status: "active" }] });
  fixture.list.mockRejectedValue(new Error("x")); expect((await GET(call("GET", "route-admin-fixture"))).status).toBe(503);
  fixture.revoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("x"));
  expect((await DELETE(call("DELETE", "route-admin-fixture", undefined, `?id=${id}`))).status).toBe(200);
  expect((await DELETE(call("DELETE", "route-admin-fixture", undefined, `?id=${id}`))).status).toBe(404);
  expect((await DELETE(call("DELETE", "route-admin-fixture", undefined, `?id=${id}`))).status).toBe(503);
  expect((await DELETE(call("DELETE", "route-admin-fixture", undefined, "?id=bad"))).status).toBe(400);
  const body = await POST(call("POST", "route-admin-fixture")); expect(body.status).toBe(400);
 });
});
