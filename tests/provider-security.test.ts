import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  bootstrap: vi.fn(),
  fetch: vi.fn(),
  authorized: true,
}));

vi.mock("../src/lib/db/client", () => ({ queryClient: Object.assign(mocks.query, { begin: async (callback: (query: typeof mocks.query) => Promise<unknown>) => callback(mocks.query) }) }));
vi.mock("../src/lib/db/bootstrap", () => ({ bootstrapDatabase: mocks.bootstrap }));
vi.mock("../src/lib/auth/guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/auth/guard")>();
  return { ...original, verifyApiAccess: vi.fn(async () => ({ authorized: mocks.authorized, status: mocks.authorized ? 200 : 401 })) };
});
vi.mock("../src/lib/providers/oci", () => ({ getOciFleetResources: vi.fn(async () => ({})) }));
vi.mock("../src/lib/providers/cloudflare", () => ({ getCloudflareResources: vi.fn(async () => ({})) }));
vi.mock("../src/lib/infisical/client", () => ({
  getInfisicalStatus: vi.fn(async () => ({ connected: false, totalWorkspaces: 0, totalSecretKeys: 0, agentVault: { status: "unknown" } })),
}));

import { GET as getProviders, POST as postProvider, DELETE as deleteProvider } from "../src/app/api/providers/route";
import { GET as getFleet } from "../src/app/api/fleet/route";
import { getIdentitiesWithAccounts, getIdentityGraph } from "../src/lib/identity/service";

const secret = "fixture-secret-DO-NOT-RETURN-56789";
const request = (body: unknown) => new Request("http://localhost/api/providers", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(typeof body === "object" && body !== null ? { ownerEmail: "owner@example.test", ...body } : body),
});

describe("provider credential boundary", () => {
  beforeEach(() => {
    mocks.authorized = true;
    mocks.query.mockReset().mockResolvedValue([]);
    mocks.bootstrap.mockReset().mockResolvedValue(undefined);
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects credentialed onboarding before connection tests or writes", async () => {
    const response = await postProvider(request({
      providerId: "cloudflare", label: "Production", config: { accountId: "native-account", apiToken: secret },
    }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
    expect(mocks.fetch).not.toHaveBeenCalled();
    // Setup state may be read, but nothing may be written before a secret store is verified.
    expect(mocks.query.mock.calls.filter(([text]) => /INSERT|UPDATE|DELETE/i.test(Array.isArray(text) ? text.join(" ") : String(text)))).toEqual([]);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it("rejects unknown nested config, URL credentials and oversized bodies", async () => {
    for (const config of [
      { unknown: { credential: secret } },
      { restUrl: `https://user:${secret}@example.com` },
      { restUrl: `https://example.com/?token=${secret}` },
    ]) {
      const response = await postProvider(request({ providerId: "upstash", label: "Test", config }));
      expect([400, 503]).toContain(response.status);
      expect(await response.text()).not.toContain(secret);
    }
    const large = await postProvider(request({ providerId: "cloudflare", label: "Test", config: { apiToken: "x".repeat(17000) } }));
    expect(large.status).toBe(413);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("stores only selected public options as pending inventory without inventing a resource", async () => {
    const response = await postProvider(request({
      providerId: "cloudflare", label: "Inventory", config: {
        _vaultBackend: "infisical", _infisicalRef: `infisical://${secret}`,
      },
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.account.onboardingStatus).toBe("pending_verification");
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const call = mocks.query.mock.calls[0];
    expect(call[0].join(" ")).toContain("INSERT INTO provider_accounts");
    expect(JSON.stringify(call.slice(1))).toContain("pending_verification");
    expect(JSON.stringify(call.slice(1))).not.toContain(secret);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("projects legacy account metadata and notes without exposing credentials", async () => {
    mocks.query.mockResolvedValueOnce([{
      id: "old", kind: "cloudflare", label: "Old", notes: secret,
      meta: { apiToken: secret, nested: { token: secret }, onboardingStatus: "pending_verification", publicConfig: { region: secret } },
    }]);
    const response = await getProviders(new Request("http://localhost/api/providers"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connectedAccounts[0].meta).toEqual({ onboardingStatus: "pending_verification" });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("projects fleet resource attributes and tags through public allowlists", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "old", account_id: null, account_email: "owner@example.test", provider: "cloudflare", name: "Old", category: "storage", state: "unknown", is_protected: true,
        attributes: { apiToken: secret, nested: { token: secret }, sizeGb: 4.2, endpointUrl: `https://example.com/?token=${secret}` },
        tags: ["edge", secret], last_seen_at: null, native_id: null, region: null, source_url: null, inventory_source: "manual", retired_at: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const response = await getFleet(new Request("http://localhost/api/fleet"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resources[0].attributes).toEqual({ sizeGb: 4.2 });
    expect(body.resources[0].tags).toEqual(["edge"]);
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("projects identity resources before both list and graph responses", async () => {
    const queueIdentityRows = () => {
      mocks.query
        .mockResolvedValueOnce([{ id: "person", displayName: "Operator", createdAt: "2026-01-01", updatedAt: "2026-01-01" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "account", identityId: "person", provider: "cloudflare", label: "Cloudflare", ownerEmail: "test@example.com", role: "general", health: "ok", healthDetail: secret, notes: secret, enabled: true, createdAt: "2026-01-01" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "resource", accountId: "account", name: "Test", category: "storage", provider: "Cloudflare", state: "online", tags: ["r2", secret], attributes: { sizeGb: 4, apiToken: secret, endpointUrl: `https://example.com/?token=${secret}` } }])
        .mockResolvedValueOnce([]);
    };

    queueIdentityRows();
    const identities = await getIdentitiesWithAccounts();
    expect(identities[0].accounts[0].resources[0].attributes).toEqual({ sizeGb: 4 });
    expect(identities[0].accounts[0].resources[0].tags).toEqual(["r2"]);
    expect(JSON.stringify(identities)).not.toContain(secret);

    queueIdentityRows();
    const graph = await getIdentityGraph();
    const resource = graph.nodes.find((node) => node.type === "resource");
    expect(resource?.data.attributes).toEqual({ sizeGb: 4 });
    expect(JSON.stringify(graph)).not.toContain(secret);
  });
});


describe("provider and fleet failure boundaries", () => {
  beforeEach(() => {
    mocks.authorized = true;
    mocks.query.mockReset().mockResolvedValue([]);
    mocks.bootstrap.mockReset().mockResolvedValue({ success: true });
  });
  it("rejects unauthorized reads, registration, and deletion", async () => {
    mocks.authorized = false;
    for (const response of [await getProviders(new Request("http://localhost/api/providers")), await getFleet(new Request("http://localhost/api/fleet")), await postProvider(request({})), await deleteProvider(new Request("http://localhost/api/providers?id=account"))]) {
      expect(response.status).toBe(401);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("filters the catalog by search and capability, including no-match cases", async () => {
    const search = await getProviders(new Request("http://localhost/api/providers?search=cloudflare"));
    expect((await search.json()).providers.map((provider: { id: string }) => provider.id)).toEqual(["cloudflare"]);
    const category = await getProviders(new Request("http://localhost/api/providers?category=llm"));
    const body = await category.json();
    expect(body.providers.some((provider: { id: string }) => provider.id === "cliproxyapi")).toBe(true);
    const missing = await getProviders(new Request("http://localhost/api/providers?search=does-not-exist"));
    expect((await missing.json()).providers).toEqual([]);
  });

  it("rejects unsupported providers, invalid shapes and malformed bodies without persistence", async () => {
    expect((await postProvider(request({ providerId: "not-supported", label: "Test" }))).status).toBe(404);
    for (const config of [{ unknown: "x" }, { authMethod: "invalid-option" }, { authMethod: false }, { authMethod: 5 }, { apiToken: "x".repeat(513) }, { _vaultBackend: {} }]) {
      expect((await postProvider(request({ providerId: "cloudflare", label: "Test", config }))).status).toBe(400);
    }
    expect((await postProvider(request({ label: "Test" }))).status).toBe(400);
    const malformed = new Request("http://localhost/api/providers", { method: "POST", body: "{" });
    expect((await postProvider(malformed)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("reports persistence failures without returning database diagnostics", async () => {
    mocks.query.mockRejectedValue(new Error(secret));
    const registered = await postProvider(request({ providerId: "cloudflare", label: "Test", config: {} }));
    expect(registered.status).toBe(500);
    expect(await registered.text()).not.toContain(secret);
    mocks.bootstrap.mockRejectedValue(new Error(secret));
    const catalog = await getProviders(new Request("http://localhost/api/providers"));
    expect(catalog.status).toBe(500);
    expect(await catalog.text()).not.toContain(secret);
    const fleet = await getFleet(new Request("http://localhost/api/fleet"));
    expect(fleet.status).toBe(503);
    expect((await fleet.json()).status).toBe("unavailable");
  });

  it("retains a catalog and degraded fleet response during read failures", async () => {
    mocks.query.mockRejectedValue(new Error(secret));
    const catalog = await getProviders(new Request("http://localhost/api/providers"));
    expect(catalog.status).toBe(200);
    const body = await catalog.json();
    expect(body.providers.some((provider: { id: string }) => provider.id === "cloudflare")).toBe(true);
    expect(body.connectedAccounts).toEqual([]);
    const fleet = await getFleet(new Request("http://localhost/api/fleet"));
    expect(fleet.status).toBe(503);
    expect((await fleet.json()).resources).toBeUndefined();
  });

  it("deletes inventory records and reports missing IDs and failed deletes", async () => {
    expect((await deleteProvider(new Request("http://localhost/api/providers"))).status).toBe(400);
    const url = "http://localhost/api/providers?id=account";
    expect((await deleteProvider(new Request(url))).status).toBe(404);
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "account", secret_ref_id: null }]);
    const success = await deleteProvider(new Request(url));
    expect(await success.json()).toEqual({ success: true, deletedId: "account" });
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "account", secret_ref_id: "tracked-ref" }]);
    expect((await deleteProvider(new Request(url))).status).toBe(409);
    mocks.query.mockRejectedValueOnce(new Error(secret));
    const failed = await deleteProvider(new Request(url));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain(secret);
  });
});


it("removes absent or unverified legacy metadata and keeps measured numeric fields only", async () => {
 const { publicProviderMeta, publicResourceAttributes, publicResourceTags } = await import("../src/lib/providers/config-security");
 expect(publicProviderMeta({ onboardingStatus: "pending_verification", secret: "hidden" })).toEqual({ onboardingStatus: "pending_verification" });
 expect(publicProviderMeta(null)).toEqual({});
 expect(publicProviderMeta({ secret: "hidden" })).toEqual({});
 expect(publicResourceAttributes({ sizeGb: 8, vcpus: -1, ramMb: Number.NaN })).toEqual({ sizeGb: 8 });
 expect(publicResourceAttributes(null)).toEqual({});
 expect(publicResourceTags(["edge", "hidden"])).toEqual(["edge"]);
 expect(publicResourceTags(null)).toEqual([]);
});
