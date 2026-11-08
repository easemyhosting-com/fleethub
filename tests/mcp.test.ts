import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), boot: vi.fn(), setup: vi.fn(), context: vi.fn(), recommend: vi.fn(), footprints: vi.fn(), orphans: vi.fn(), hosts: vi.fn() }));
vi.mock("@/lib/projects/recommend", () => ({ recommendFor: fixture.recommend }));
vi.mock("@/lib/capacity/read", () => ({ readHostCapacities: fixture.hosts }));
vi.mock("@/lib/projects/footprint", () => ({ readFootprints: fixture.footprints, readOrphans: fixture.orphans }));
vi.mock("@/lib/inventory/snapshot", () => ({ readSnapshot: fixture.snapshot }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/onboarding/service", () => ({ getSetupState: fixture.setup }));
vi.mock("@/lib/agent-context/context", () => ({ getAgentContext: fixture.context }));
import { GET, POST } from "../src/app/api/mcp/route";
const resource = { id: "registered", accountId: "account-1", category: "compute", provider: "oracle", presence: "present", freshness: "stale", isProtected: true, name: "Protected host" };
const request = (value: unknown, token = "mcp-reader-fixture") => new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(value) });
const call = (name: string, args: unknown = {}) => POST(request({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name, arguments: args } }));
async function value(response: Response) { return JSON.parse((await response.json()).result.content[0].text); }
beforeEach(() => {
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_API_KEY", "mcp-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "mcp-reader-fixture");
 fixture.boot.mockReset().mockResolvedValue({success: true});
 fixture.snapshot.mockReset().mockResolvedValue({timestamp: "fixture-time", resources: [resource, {...resource,id:"database",category:"database",freshness:"current",isProtected:false}, {...resource,id:"missing",presence:"missing"}]});
 fixture.setup.mockReset().mockResolvedValue({ steps: [] }); fixture.context.mockReset().mockResolvedValue({inventory: {status:"available"}});
});
afterEach(() => vi.unstubAllEnvs());
describe("stored-inventory JSON-RPC bridge", () => {
 it("describes its actual limited transport and exposes no execution tools", async () => {
  const read = (token: string) => new Request("http://localhost/api/mcp", {headers:{authorization:`Bearer ${token}`}});
  expect((await GET(read("wrong"))).status).toBe(401);
  const response = await GET(read("mcp-reader-fixture")); const body = await response.json();
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(body.standardMcpTransport).toBe(false);
  expect(body.capabilities.tools.map((tool: {name: string})=>tool.name)).toEqual(["get_fleet_context","plan_host_enrollment","list_resources","get_fleet_capacity","get_quotas","find_free_capacity","get_host_capacity","get_project_footprint","get_llm_endpoints"]);
  expect((await POST(request({method:"server/discover",id:1}))).status).toBe(200);
  expect((await (await POST(request({method:"tools/list",id:2}))).json()).result.tools).toHaveLength(9);
 });
 it("reads the registry with validated account/category filters and excludes missing by default", async () => {
  expect(await value(await call("list_resources",{accountId:"account-1",category:"compute"}))).toEqual([resource]);
  expect(fixture.snapshot).toHaveBeenCalledWith({accountId:"account-1"});
  expect(await value(await call("list_resources",{includeMissing:true}))).toHaveLength(3);
  expect((await call("list_resources",{category:"credentials"})).status).toBe(400);
  expect((await call("list_resources",{url:"http://untrusted"})).status).toBe(400);
 });
 it("reports counts rather than inventing available capacity or quotas", async () => {
  expect(await value(await call("get_fleet_capacity"))).toMatchObject({registeredResources:2,currentProviderResources:1,protectedResources:1,availableCpu:null,availableMemoryBytes:null,availableStorageBytes:null,executionEnabled:false});
  expect(await value(await call("get_quotas"))).toMatchObject({status:"unavailable",observations:[]});
  expect(await value(await call("get_llm_endpoints"))).toMatchObject({setupStatus:"unconfigured",apiUrl:null,upstreamAvailability:"unknown",quota:"unknown"});
  fixture.setup.mockResolvedValue({steps:[{id:"cliproxy",status:"verified",verifiedAt:"fixture",config:{apiUrl:"https://gateway.example",consoleUrl:"https://console.example/management.html"}}]});
  expect(await value(await call("get_llm_endpoints"))).toMatchObject({setupStatus:"verified",apiUrl:"https://gateway.example",consoleUrl:"https://console.example/management.html"});
 });
 it("keeps proposal and context tools read-only and reports storage outages", async () => {
  expect(await value(await call("get_fleet_context"))).toEqual({inventory:{status:"available"}});
  fixture.context.mockResolvedValue({inventory:{status:"unavailable"}}); expect((await (await call("get_fleet_context")).json()).result.isError).toBe(true);
  expect(await value(await call("plan_host_enrollment",{host:"host.example"}))).toMatchObject({proposedOperations:["register_inventory"]});
  fixture.snapshot.mockRejectedValue(new Error("private-diagnostic"));
  const failed = await call("list_resources"); const body = await failed.json(); expect(body.result.isError).toBe(true); expect(JSON.stringify(body)).not.toContain("private-diagnostic");
  fixture.boot.mockResolvedValue({success:false}); expect((await (await call("get_fleet_capacity")).json()).result.isError).toBe(true);
 });
 it("rejects malformed requests, unknown tools and execution for every credential", async () => {
  expect((await POST(request({},"wrong"))).status).toBe(401);
  const invalidJson = new Request("http://localhost/api/mcp",{method:"POST",headers:{authorization:"Bearer mcp-reader-fixture"},body:"{"});
  expect((await POST(invalidJson)).status).toBe(400);
  expect((await POST(request(null))).status).toBe(400);
  expect((await POST(request({method:"invalid"}))).status).toBe(400);
  expect((await POST(request({method:"tools/call",params:{}}))).status).toBe(400);
  expect((await call("unknown" )).status).toBe(404);
  expect((await call("dispatch_workload")).status).toBe(403);
  expect((await POST(request({method:"tools/call",params:{name:"dispatch_workload"}},"mcp-admin-fixture"))).status).toBe(403);
  expect(fixture.snapshot).not.toHaveBeenCalled();
 });
 it("recommends free capacity and reads project footprints without executing anything", async () => {
  fixture.recommend.mockResolvedValue({ decision: "none_free", candidates: [], allocated: false });
  expect(await value(await call("find_free_capacity", { kind: "database", providers: ["neon"] }))).toMatchObject({ decision: "none_free", allocated: false });
  expect(fixture.recommend).toHaveBeenCalledWith(expect.objectContaining({ kind: "database", spec: { providers: ["neon"] } }), "");
  expect((await call("find_free_capacity", { kind: "gpu" })).status).toBe(400);
  expect((await call("find_free_capacity", { kind: "database", command: "x" })).status).toBe(400);
  fixture.footprints.mockResolvedValue([{ slug: "app" }]); fixture.orphans.mockResolvedValue([{ resourceId: "r" }]);
  expect(await value(await call("get_project_footprint"))).toEqual({ projects: [{ slug: "app" }], orphans: [{ resourceId: "r" }], authoritative: false });
  expect(await value(await call("get_project_footprint", { project: "app" }))).toMatchObject({ orphans: [] });
  expect(fixture.footprints).toHaveBeenLastCalledWith("app");
  expect((await call("get_project_footprint", { project: "Bad Slug" })).status).toBe(400);
 });
 it("reports declared host capacity and fit without executing anything", async () => {
  const host = { hostId: "h", name: "borealis", state: "online", region: null, shape: null, totalCpuMilli: 2000, totalMemMi: 12288, requestedCpuMilli: 800, requestedMemMi: 3072, limitCpuMilli: 0, limitMemMi: 0, pvcGi: 0, freeCpuMilli: 1000, freeMemMi: 8192, cpuRequestPct: 40, memRequestPct: 25, cpuLimitPct: 0, memLimitPct: 0, status: "ok", projects: [], withoutRequests: [], basis: "declared_requests", measured: false, reserve: { cpuMilli: 200, memMi: 1024 } };
  fixture.hosts.mockResolvedValue([host]);
  expect(await value(await call("get_host_capacity"))).toMatchObject({ hosts: [{ name: "borealis" }], measured: false });
  const withAsk = await value(await call("get_host_capacity", { cpu: "500m", memory: "1Gi" }));
  expect(withAsk.fits[0]).toMatchObject({ name: "borealis", fits: true });
  expect((await call("get_host_capacity", { cpu: "lots" })).status).toBe(400);
  expect((await call("get_host_capacity", { command: "x" })).status).toBe(400);
 });
});
