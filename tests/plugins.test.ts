import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { pluginRegistry } from "../src/lib/plugins/registry";
import "../src/lib/plugins/defaults";

import * as ociProvider from "../src/lib/providers/oci";

describe("Plugin Registry & Launch Collectors", () => {
  beforeEach(() => vi.stubEnv("HOME", "/tmp/fleethub-no-oci-config"));
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("registers all default launch plugins", () => {
    const plugins = pluginRegistry.list();
    const ids = plugins.map((p) => p.id);

    expect(ids).toContain("cloudflare");
    expect(ids).toContain("upstash");
    expect(ids).toContain("github");
    expect(ids).toContain("oracle");
    expect(ids).toContain("turso");
    expect(ids).toContain("neon");
    expect(ids).toContain("gdrive");
    expect(ids).toContain("modal");
    expect(ids).toContain("freellmapi");
    expect(ids.length).toBeGreaterThanOrEqual(9);
  });

  it("retrieves a plugin by ID and returns undefined for unknown ID", () => {
    const oracle = pluginRegistry.get("oracle");
    expect(oracle?.name).toBe("Oracle Cloud");

    const unknown = pluginRegistry.get("non-existent-provider");
    expect(unknown).toBeUndefined();
  });

  it("executes collectAll across all 9 provider contexts and handles dashed account IDs", async () => {
    const contexts = [
      { accountId: "oracle-production", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "cloudflare", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "upstash", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "github", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "turso", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "neon", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "gdrive", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "modal", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
      { accountId: "freellmapi", accountEmail: "operator@fleethub.dev", credentials: {}, isMock: true },
    ];

    const results = await pluginRegistry.collectAll(contexts);
    expect(results.size).toBe(9);

    // Verify Oracle via dashed prefix resolution (oracle-production -> oracle)
    const oracleResult = results.get("oracle:oracle-production");
    expect(oracleResult?.resources).toEqual([]);
    expect(oracleResult?.samples).toEqual([]);
    expect(oracleResult?.health.ok).toBe(false);

    // Verify Cloudflare
    const cfResult = results.get("cloudflare:cloudflare");
    expect(cfResult?.resources.length).toBe(2);
    expect(cfResult?.samples.length).toBe(2);

    // Verify Upstash
    const upstashResult = results.get("upstash:upstash");
    expect(upstashResult?.resources.length).toBe(2);

    // Verify GitHub
    const ghResult = results.get("github:github");
    expect(ghResult?.resources.length).toBe(1);

    // Verify Turso
    const tursoResult = results.get("turso:turso");
    expect(tursoResult?.resources[0]?.provider).toBe("turso");

    // Verify Neon
    const neonResult = results.get("neon:neon");
    expect(neonResult?.resources[0]?.provider).toBe("neon");

    // Verify GDrive
    const gdriveResult = results.get("gdrive:gdrive");
    expect(gdriveResult?.resources[0]?.attributes?.encryption).toBe("AES-256");

    // Verify Modal
    const modalResult = results.get("modal:modal");
    expect(modalResult?.resources[0]?.attributes?.freeMonthlyCredit).toBe("$30");

    // Verify FreeLLM
    const freellmResult = results.get("freellmapi:freellmapi");
    expect(freellmResult?.resources[0]?.category).toBe("llm");
  });

  it("handles plugin collection errors gracefully in collectAll", async () => {
    // Register a faulty plugin that throws
    pluginRegistry.register({
      id: "failing-plugin",
      name: "Failing Provider",
      capabilities: ["compute"],
      collect: async () => {
        throw new Error("Connection timed out to provider API");
      },
    });

    const results = await pluginRegistry.collectAll([
      { accountId: "failing-plugin", accountEmail: "err@example.com", credentials: {} },
    ]);

    expect(results.size).toBe(1);
    const errResult = results.get("failing-plugin:failing-plugin");
    expect(errResult?.health.ok).toBe(false);
    expect(errResult?.health.error).toBe("Collection failed");
  });

  it("gracefully handles completely unknown plugins in collectAll", async () => {
    const contexts = [
      { accountId: "unknown-provider-id", accountEmail: "test@example.com", credentials: {} },
    ];

    const results = await pluginRegistry.collectAll(contexts);
    expect(results.size).toBe(0);
  });
  it("collects verified OCI instances without publishing estimated quota samples", async () => {
    const snapshot = await ociProvider.getOciFleetResources();
    vi.spyOn(ociProvider, "getOciFleetResources").mockResolvedValue({ ...snapshot, connected: true, dataSource: "live_cli" });
    const results = await pluginRegistry.collectAll([{ accountId: "oracle", accountEmail: "test@example.com", credentials: {} }]);
    const result = results.get("oracle:oracle");
    expect(result?.health.ok).toBe(true);
    expect(result?.resources).toHaveLength(4);
    expect(result?.samples).toEqual([]);
  });

  it("tests connection and collects resources for CLIProxyAPI plugin", async () => {
    const cliproxy = pluginRegistry.get("cliproxyapi");
    expect(cliproxy).toBeDefined();

    // Test connection with mock fetch
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const connSuccess = await cliproxy?.testConnection?.({ endpointUrl: "http://127.0.0.1:8318", managementKey: "secret" });
    expect(connSuccess?.ok).toBe(true);

    fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
    const connFailure = await cliproxy?.testConnection?.({ endpointUrl: "http://127.0.0.1:8318" });
    expect(connFailure?.ok).toBe(false);

    // Test collect
    const collectResult = await cliproxy?.collect({
      accountId: "acc-cliproxy",
      accountEmail: "operator@fleethub.dev",
      credentials: { endpointUrl: "http://127.0.0.1:8318" },
      isMock: true,
    });
    expect(collectResult?.resources).toHaveLength(1);
    expect(collectResult?.resources[0].id).toBe("cliproxy-acc-cliproxy");
    expect(collectResult?.health.ok).toBe(true);
    expect(collectResult?.resources[0].attributes.managementUrl).toBe("http://127.0.0.1:8318/management.html");
  });

  it("tests connection for Infisical plugin", async () => {
    const infisical = pluginRegistry.get("infisical");
    expect(infisical).toBeDefined();

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "token-123" }), { status: 200 }));

    const connSuccess = await infisical?.testConnection?.({ clientId: "id", clientSecret: "sec" });
    expect(connSuccess?.ok).toBe(true);

    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    const connFailure = await infisical?.testConnection?.({ clientId: "id", clientSecret: "sec" });
    expect(connFailure?.ok).toBe(false);

    // Test Infisical collect
    const infCollect = await infisical?.collect({
      accountId: "acc-inf",
      accountEmail: "operator@fleethub.dev",
      credentials: { baseUrl: "http://127.0.0.1:8088", projectSlug: "fleet" },
      isMock: true,
    });
    expect(infCollect?.resources).toHaveLength(1);
    expect(infCollect?.resources[0].id).toBe("infisical-vault-acc-inf");
  });

  it("tests connection and collects resources for Tailscale WireGuard plugin", async () => {
    const tailscale = pluginRegistry.get("tailscale");
    expect(tailscale).toBeDefined();

    // Presence of fields alone is not a verified connection.
    const connSuccess = await tailscale?.testConnection?.({
      tailnet: "my-tailnet.ts.net",
      authKey: "tskey-auth-12345",
    });
    expect(connSuccess?.ok).toBe(false);
    expect(connSuccess?.message).toContain("unavailable");

    // 2. Failure test connection (missing auth key and tailnet)
    const connFail = await tailscale?.testConnection?.({});
    expect(connFail?.ok).toBe(false);

    // 3. Collect
    const collectResult = await tailscale?.collect({
      accountId: "acc-tailscale-test",
      accountEmail: "operator@fleethub.dev",
      credentials: {
        tailnet: "my-tailnet.ts.net",
        tailscaleIp: "100.64.0.1",
        role: "mesh_backbone",
      },
      isMock: true,
    });
    expect(collectResult?.resources).toHaveLength(1);
    expect(collectResult?.resources[0].id).toBe("tailscale-mesh-acc-tailscale-test");
    expect(collectResult?.resources[0].category).toBe("network");
    expect(collectResult?.health.ok).toBe(true);
  });
});

describe("Provider placeholder hygiene", () => {
  it("keeps placeholders from resembling real credential payloads", () => {
    // GCP service-account JSON and private-key bodies trip image secret scanning even
    // when they are only UI hints. Keep placeholders recognizably incomplete.
    const credentialShapes = [/"type"\s*:\s*"service_account"/, /"private_key"\s*:\s*"-----BEGIN/];
    for (const plugin of pluginRegistry.list()) {
      // Test-only plugins may be registered without configuration fields.
      for (const field of plugin.configFields ?? []) {
        for (const shape of credentialShapes) {
          expect(field.placeholder ?? "", `${plugin.id}.${field.key}`).not.toMatch(shape);
        }
      }
    }
  });
});

