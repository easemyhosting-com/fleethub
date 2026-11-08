import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const agent = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/auth/agent-keys", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/auth/agent-keys")>()), authenticateAgentKey: agent.authenticate }));
import { verifyApiAccess } from "../src/lib/auth/guard";
const token = `fhk_${"C".repeat(43)}`;
const req = (method = "GET", auth: string | null = `Bearer ${token}`, extra: Record<string, string> = {}) => new Request("http://localhost/api/fleet", { method, headers: { ...(auth ? { authorization: auth } : {}), ...extra } });
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_API_KEY", "guard-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "guard-reader-fixture"); agent.authenticate.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("agent keys in the API guard", () => {
 it("grants read access to a valid agent key and identifies the principal", async () => {
  agent.authenticate.mockResolvedValue({ status: "valid", id: "agk-9" });
  expect(await verifyApiAccess(req())).toMatchObject({ authorized: true, status: 200, principalId: "agent-key:agk-9" });
  expect(await verifyApiAccess(req("GET", null, { "x-api-key": token }))).toMatchObject({ authorized: true });
 });
 it("never allows writes with an agent key", async () => {
  agent.authenticate.mockResolvedValue({ status: "valid", id: "agk-9" });
  for (const method of ["POST", "DELETE"]) expect(await verifyApiAccess(req(method))).toMatchObject({ authorized: false, status: 403 });
  expect(await verifyApiAccess(req("GET"), { requireWrite: true })).toMatchObject({ authorized: false, status: 403 });
 });
 it("rejects revoked, expired or unknown keys and fails closed when storage is unavailable", async () => {
  agent.authenticate.mockResolvedValue({ status: "invalid" });
  expect(await verifyApiAccess(req())).toMatchObject({ authorized: false, status: 401 });
  agent.authenticate.mockResolvedValue({ status: "unavailable" });
  expect(await verifyApiAccess(req())).toMatchObject({ authorized: false, status: 503 });
 });
 it("does not consult storage for static keys, other formats, or combined credentials", async () => {
  expect(await verifyApiAccess(req("GET", "Bearer guard-reader-fixture"))).toMatchObject({ authorized: true });
  expect(await verifyApiAccess(req("GET", "Bearer guard-admin-fixture"))).toMatchObject({ authorized: true });
  expect(await verifyApiAccess(req("GET", "Bearer not-a-key"))).toMatchObject({ authorized: false, status: 401 });
  agent.authenticate.mockResolvedValue({ status: "valid", id: "agk-9" });
  expect(await verifyApiAccess(req("GET", `Bearer ${token}`, { "x-api-key": "guard-reader-fixture" }))).toMatchObject({ authorized: false, status: 401 });
  expect(agent.authenticate).not.toHaveBeenCalled();
 });
 it("rate limits a validated agent key in its own bucket", async () => {
  agent.authenticate.mockResolvedValue({ status: "valid", id: "agk-9" });
  const results = [];
  for (let index = 0; index < 125; index += 1) results.push((await verifyApiAccess(req())).status);
  expect(results.slice(0, 3)).toEqual([200, 200, 200]); expect(results).toContain(429);
  expect((await verifyApiAccess(req("GET", "Bearer guard-reader-fixture"))).status).toBe(200);
 });
});
