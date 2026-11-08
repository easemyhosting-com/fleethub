import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planHostEnrollment, hostEnrollmentInput } from "../src/lib/enrollment/plan";
import { POST } from "../src/app/api/host-enrollment/plan/route";
import { GET as mcpDescription, POST as mcpPost } from "../src/app/api/mcp/route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
  vi.stubEnv("FLEETHUB_API_KEY", "");
  vi.stubEnv("FLEETHUB_READONLY_KEY", "enrollment-reader-fixture");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (body: unknown, authorized = true) => new Request("http://localhost/api/host-enrollment/plan", {
  method: "POST", headers: { "content-type": "application/json", ...(authorized ? { authorization: "Bearer enrollment-reader-fixture" } : {}) }, body: JSON.stringify(body),
});

describe("non-executable host enrollment plans", () => {
  it("defaults unknown hosts to protected inventory and never implies verification", () => {
    const plan = planHostEnrollment({ host: "new-server.example" });
    expect(plan.executionEnabled).toBe(false);
    expect(plan.verificationPerformed).toBe(false);
    expect(plan.disposition).toBe("inventory_only");
    expect(plan.proposedOperations).toEqual(["register_inventory"]);
    expect(plan.blockers).toContain("registered_host_required");
    expect(plan.target.port).toBe(22);
  });

  it("keeps OCI, protected, and production targets inventory-only despite caller hints", () => {
    for (const input of [
      { provider: "oracle", isProtected: false, isProduction: false },
      { provider: "oci", isProtected: false, isProduction: false },
      { provider: "other", isProtected: true, isProduction: false },
      { provider: "other", isProtected: false, isProduction: true },
    ]) {
      const plan = planHostEnrollment({ host: "192.0.2.10", ...input });
      expect(plan.disposition).toBe("inventory_only");
      expect(plan.proposedOperations).toEqual(["register_inventory"]);
    }
  });

  it("produces an assisted proposal with blockers rather than enabling remote execution", () => {
    const plan = planHostEnrollment({ host: "2001:db8::1", mode: "assisted", username: "root", provider: "other", isProtected: false, isProduction: false });
    expect(plan.disposition).toBe("proposal_requires_verification_and_approval");
    expect(plan.executionEnabled).toBe(false);
    expect(plan.blockers).toEqual(expect.arrayContaining(["trusted_host_key_required", "scoped_ssh_access_required", "dedicated_non_root_account_recommended", "no_approved_execution_worker"]));
    expect(plan.proposedOperations).toContain("approve_exact_bootstrap_plan");
    const referenced = planHostEnrollment({ host: "server.example", hostId: "host-1", mode: "assisted", isProtected: false, isProduction: false, provider: "other", hostKeyFingerprint: `SHA256:${"a".repeat(43)}`, sshCredentialRef: "ref-fixture" });
    expect(referenced.blockers).toEqual(["authoritative_host_policy_not_verified", "no_approved_execution_worker"]);
    expect(referenced.inputTrust).toBe("unverified_caller_description");
  });

  it("rejects raw credentials, shell text, invalid hostnames and invalid references", () => {
    for (const input of [
      { host: "ssh://user@host" }, { host: "host; reboot" }, { host: "bad..example" },
      { host: "host", privateKey: "private-key-sentinel" }, { host: "host", token: "token-sentinel" },
      { host: "host", port: 0 }, { host: "host", username: "user;id" }, { host: "host", sshCredentialRef: "actual-secret" },
    ]) expect(hostEnrollmentInput.safeParse(input).success).toBe(false);
  });

  it("serves a read-only planning API with validation and no network operations", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await POST(request({ host: "host.example" }, false))).status).toBe(401);
    const valid = await POST(request({ host: "host.example" }));
    expect(valid.status).toBe(200);
    expect((await valid.json()).executionEnabled).toBe(false);
    const invalid = await POST(request({ host: "host", privateKey: "sentinel" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("sentinel");
    expect((await POST(request({ host: "x".repeat(17000) }))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exposes the same side-effect-free planner to MCP read-only clients", async () => {
    const headers = { authorization: "Bearer enrollment-reader-fixture", "content-type": "application/json" };
    const catalog = await (await mcpDescription(new Request("http://localhost/api/mcp", { headers }))).json();
    expect(catalog.capabilities.tools.find((tool: { name: string }) => tool.name === "plan_host_enrollment").annotations.readOnlyHint).toBe(true);
    expect(catalog.capabilities.tools.find((tool: { name: string }) => tool.name === "plan_host_enrollment").inputSchema.required).toEqual(["host"]);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const call = (args: unknown) => mcpPost(new Request("http://localhost/api/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "plan_host_enrollment", arguments: args } }) }));
    const result = await call({ host: "server.example" });
    expect(result.status).toBe(200);
    expect(JSON.parse((await result.json()).result.content[0].text).proposedOperations).toEqual(["register_inventory"]);
    const bad = await call({ host: "host", password: "sentinel" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32602);
    expect(fetch).not.toHaveBeenCalled();
  });
});
