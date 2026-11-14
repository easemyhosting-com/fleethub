import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkAgentVaultStatus,
  getInfisicalStatus,
  _resetTokenCache,
} from "../src/lib/infisical/client";

describe("Infisical Secrets Management & Agent Vault Security", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("AGENT_VAULT_URL", "http://agent-vault.test");
    vi.stubEnv("INFISICAL_URL", "https://vault.test");
    _resetTokenCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never sends credentials to a remote HTTP vault", async () => {
    vi.stubEnv("INFISICAL_URL", "http://vault.example.test");
    vi.stubEnv("FLEETHUB_ALLOW_INSECURE_SERVICE_HTTP", "false");
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "fixture-client");
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "fixture-secret");
    vi.stubEnv("AGENT_VAULT_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await getInfisicalStatus()).connected).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when Agent Vault proxy is unreachable", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    try {
      const status = await checkAgentVaultStatus();
      expect(status).toBe("offline");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reports 'online' when Agent Vault proxy is reachable", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
    } as any);

    try {
      const status = await checkAgentVaultStatus();
      expect(status).toBe("online");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("fails closed when credentials are unconfigured or invalid, reporting connected: false", async () => {
    const status = await getInfisicalStatus();

    // Since INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET is not set in test environment,
    // it MUST fail closed: connected = false, workspaces marked as baseline snapshots
    expect(status.connected).toBe(false);
    expect(status.workspaces.length).toBeGreaterThanOrEqual(3);
    expect(status.totalSecretKeys).toBeGreaterThanOrEqual(10);
    expect(status.secretReferences[0].status).toBe("pending");
  });

  it("connects successfully and returns connected: true when valid token and workspaces exist", async () => {
    const originalFetch = global.fetch;
    process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID = "test-client-id";
    process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET = "test-client-secret";

    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (url.includes("/universal-auth/login")) {
        expect(init.redirect).toBe("error");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accessToken: "mock-token-xyz", expiresIn: 3600 }),
        } as any);
      }
      if (url.includes("/api/v1/workspace")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              workspaces: [
                {
                  id: "ws-test-1",
                  name: "Test Workspace",
                  slug: "test-workspace",
                  createdAt: "2026-01-01T00:00:00Z",
                  environments: [{ id: "env-prod", name: "Production", slug: "prod" }],
                },
              ],
            }),
        } as any);
      }
      if (url.includes("/api/v3/secrets/raw")) {
        expect(new URL(url).searchParams.get("viewSecretValue")).toBe("false");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              secrets: [{ secretKey: "KEY_ONE" }, { secretKey: "KEY_TWO" }],
            }),
        } as any);
      }
      return Promise.resolve({ status: 200 } as any);
    });

    try {
      const status = await getInfisicalStatus();
      expect(status.connected).toBe(true);
      expect(status.workspaces.length).toBe(1);
      expect(status.workspaces[0].secretKeys).toEqual(["KEY_ONE", "KEY_TWO"]);
      expect(status.secretReferences[0].status).toBe("verified");
    } finally {
      delete process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID;
      delete process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
      global.fetch = originalFetch;
    }
  });

  it("handles auth HTTP errors (e.g. 401 Unauthorized) by reporting connected: false", async () => {
    const originalFetch = global.fetch;
    process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID = "test-id";
    process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET = "test-secret";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/universal-auth/login")) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: "Invalid credentials" }),
        } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    try {
      const status = await getInfisicalStatus();
      expect(status.connected).toBe(false);
      expect(status.workspaces.length).toBeGreaterThanOrEqual(3);
    } finally {
      delete process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID;
      delete process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
      global.fetch = originalFetch;
    }
  });

  it("handles offline network failures gracefully without false positives", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("Network offline"));

    try {
      const fallbackStatus = await getInfisicalStatus();
      expect(fallbackStatus.connected).toBe(false);
      expect(fallbackStatus.agentVault.status).toBe("offline");
      expect(fallbackStatus.workspaces.length).toBeGreaterThanOrEqual(3);
      expect(fallbackStatus.totalSecretKeys).toBeGreaterThanOrEqual(10);
    } finally {
      global.fetch = originalFetch;
    }
  });
});


describe("Infisical error and freshness behavior", () => {
 beforeEach(() => { _resetTokenCache(); vi.stubEnv("INFISICAL_URL", "https://vault.test"); vi.stubEnv("AGENT_VAULT_URL", ""); });
 afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
 it("does not contact an unconfigured agent vault", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await checkAgentVaultStatus()).toBe("offline");
  expect(fetch).not.toHaveBeenCalled();
 });
 it("fails closed on malformed auth and upstream network failures", async () => {
  vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "fixture"); vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "fixture");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  expect((await getInfisicalStatus()).connected).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  expect((await getInfisicalStatus()).connected).toBe(false);
 });
 it("reuses a live token and leaves inaccessible secret metadata pending", async () => {
  vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "fixture"); vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "fixture");
  let authCount = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
   const url = String(input);
   if (url.includes("universal-auth")) { authCount++; return Response.json({ accessToken: "fixture-token", expiresIn: 3600 }); }
   if (url.includes("/workspace")) return Response.json({ workspaces: [{ id: "one", name: "One", slug: "one" }] });
   throw new Error("metadata denied");
  }));
  const first = await getInfisicalStatus();
  expect(first.connected).toBe(true);
  expect(first.secretReferences[0].status).toBe("pending");
  expect(first.secretReferences[0].keys).toEqual([]);
  expect((await getInfisicalStatus()).totalWorkspaces).toBe(1);
  expect(authCount).toBe(1);
 });
 it("does not invent workspaces when workspace discovery fails", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_DEMO_MODE", "false");
  vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "fixture"); vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "fixture");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
   if (String(input).includes("universal-auth")) return Response.json({ accessToken: "fixture-token" });
   throw new Error("workspace unavailable");
  }));
  const status = await getInfisicalStatus();
  expect(status.connected).toBe(false);
  expect(status.workspaces).toEqual([]);
  expect(status.secretReferences).toEqual([]);
 });
});
