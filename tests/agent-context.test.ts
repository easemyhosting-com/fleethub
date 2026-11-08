import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ query: vi.fn(), setup: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ queryClient: fixture.query }));
vi.mock("@/lib/onboarding/service", () => ({ getSetupState: fixture.setup }));
import { getAgentContext } from "../src/lib/agent-context/context";
import { GET } from "../src/app/api/agent-context/route";
import { POST as mcpPost } from "../src/app/api/mcp/route";

beforeEach(() => {
 fixture.query.mockReset().mockResolvedValue([]);
 fixture.setup.mockReset().mockResolvedValue({ ready: false, steps: [] });
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
 vi.stubEnv("FLEETHUB_API_KEY", ""); vi.stubEnv("FLEETHUB_READONLY_KEY", "context-reader-fixture");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("returns known metadata, explicit unknown SSH connectivity and protection without leaking legacy secrets", async () => {
 fixture.query.mockResolvedValueOnce([{ id: "account", provider: "oracle", label: "Production", enabled: false, reportedHealth: "unknown", credentialRefId: "ref-1", meta: { apiToken: "secret-sentinel" } }])
 .mockResolvedValueOnce([
  { id: "host", name: "Production host", provider: "Oracle Cloud", category: "compute", accountId: "account", isProtected: false, reportedState: "online", recordedAt: null, attributes: { privateKey: "secret-sentinel" } },
  { id: "other", name: "Other", provider: "other", category: "database", accountId: null, isProtected: false, reportedState: "unknown", recordedAt: null },
 ])
 .mockResolvedValueOnce([{ id: "ref-1", project: "fleet", environment: "prod", path: "/hosts/host/ssh", reportedStatus: "pending", lastVerifiedAt: null, value: "secret-sentinel" }]);
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 const context = await getAgentContext();
 expect(context.inventory.status).toBe("available");
 expect(context.inventory.resources?.[0]).toMatchObject({ effectivePolicy: "inventory_only", connectivity: "not_probed", sshConnection: "unknown" });
 expect(context.inventory.resources?.[1].effectivePolicy).toBe("no_execution_authorization_registered");
 expect(context.completeness).toBe("partial");
 expect(context.policy.executionEnabled).toBe(false);
 expect(JSON.stringify(context)).not.toContain("secret-sentinel");
 expect(fetch).not.toHaveBeenCalled();
});

it("distinguishes a verified empty inventory from an unavailable database", async () => {
 const empty = await getAgentContext();
 expect(empty.inventory.status).toBe("available"); expect(empty.inventory.accounts).toEqual([]);
 fixture.query.mockRejectedValue(new Error("private database diagnostic"));
 fixture.setup.mockRejectedValue(new Error("private credential diagnostic"));
 const unavailable = await getAgentContext();
 expect(unavailable.inventory.status).toBe("unavailable"); expect(unavailable.inventory.accounts).toBeNull();
 expect(unavailable.setup.status).toBe("unavailable"); expect(unavailable.setup.ready).toBe(false);
 expect(JSON.stringify(unavailable)).not.toContain("private");
});

it("serves the context through an authenticated read-only endpoint and marks read failures", async () => {
 const req = (authorized: boolean) => new Request("http://localhost/api/agent-context", { headers: authorized ? { authorization: "Bearer context-reader-fixture" } : {} });
 expect((await GET(req(false))).status).toBe(401);
 const response = await GET(req(true)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
 expect((await response.json()).scope).toBe("registered_fleet_only");
 fixture.query.mockRejectedValue(new Error("offline"));
 expect((await GET(req(true))).status).toBe(503);
});

it("provides a matching read-only MCP result and rejects invented tool arguments", async () => {
 const request = (args: unknown) => new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: "Bearer context-reader-fixture", "content-type": "application/json" }, body: JSON.stringify({ id: 1, method: "tools/call", params: { name: "get_fleet_context", arguments: args } }) });
 const good = await mcpPost(request({})); expect(good.status).toBe(200);
 const body = await good.json(); expect(body.result.isError).toBe(false);
 expect(JSON.parse(body.result.content[0].text).capabilities.find((entry: { capability: string }) => entry.capability === "ssh_connectivity_and_execution").availability).toBe("not_implemented");
 fixture.query.mockRejectedValue(new Error("offline"));
 const failed = await mcpPost(request({})); expect((await failed.json()).result.isError).toBe(true);
 expect((await mcpPost(request({ includeSecrets: true }))).status).toBe(400);
});
