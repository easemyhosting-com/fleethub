import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSchemas, requestSchema } from "../src/lib/onboarding/model";
import { approvedApiUrl, requestJson } from "../src/lib/onboarding/transport";
import { vaultSession, verifyVault } from "../src/lib/onboarding/vault";
import { verifyStep } from "../src/lib/onboarding/verify";

const networkInterfaces = vi.hoisted(() => vi.fn());
const stat = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
vi.mock("node:os", () => ({ networkInterfaces }));
vi.mock("node:fs/promises", () => ({ stat, readFile }));

const infisical = {
  apiUrl: "https://vault.example.test",
  consoleUrl: "https://vault.example.test",
  projectId: "project_1",
  environment: "prod",
  secretPath: "/fleet",
};
const cliproxy = { apiUrl: "https://gateway.example.test", consoleUrl: "https://gateway.example.test" };
const tailscale = { tailnet: "example.ts.net", deviceId: "device_1" };
const freshDevice = () => ({ id: "device_1", nodeId: "node_1", authorized: true, addresses: ["100.101.102.103"], lastSeen: new Date().toISOString() });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.FLEETHUB_ONBOARDING_ALLOWED_ORIGINS = "https://vault.example.test, https://gateway.example.test";
  process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID = "client-id";
  process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET = "client-secret";
  process.env.TAILSCALE_API_TOKEN = "tailscale-token";
  process.env.CLIPROXY_API_KEY = "model-key";
  process.env.CLIPROXY_MANAGEMENT_KEY = "management-key";
  delete process.env.TAILSCALE_STATUS_FILE;
  delete process.env.TAILSCALE_API_AUTH;
  networkInterfaces.mockReturnValue({ en0: [{ address: "100.101.102.103" }] });
  fetchMock.mockReset(); stat.mockReset(); readFile.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ["FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "TAILSCALE_API_TOKEN", "CLIPROXY_API_KEY", "CLIPROXY_MANAGEMENT_KEY", "TAILSCALE_STATUS_FILE", "TAILSCALE_API_AUTH"]) delete process.env[name];
});

describe("onboarding input model", () => {
  it("accepts public configuration and exact save/verify requests", () => {
    expect(configSchemas.tailscale.parse(tailscale)).toEqual(tailscale);
    expect(configSchemas.infisical.parse(infisical)).toEqual(infisical);
    expect(configSchemas.cliproxy.parse(cliproxy)).toEqual(cliproxy);
    expect(requestSchema.safeParse({ action: "save", step: "tailscale", config: tailscale }).success).toBe(true);
    expect(requestSchema.safeParse({ action: "verify", step: "tailscale" }).success).toBe(true);
  });
  it("rejects secrets, malformed fields, and credentials in URLs", () => {
    expect(configSchemas.tailscale.safeParse({ ...tailscale, apiKey: "secret" }).success).toBe(false);
    expect(configSchemas.tailscale.safeParse({ ...tailscale, deviceId: "a/b" }).success).toBe(false);
    expect(configSchemas.infisical.safeParse({ ...infisical, secretPath: "relative" }).success).toBe(false);
    for (const secretPath of ["/", "/fleet/", "/a/b"]) expect(configSchemas.infisical.safeParse({ ...infisical, secretPath }).success).toBe(true);
    for (const secretPath of ["//", "/a//b", "/" + "a".repeat(500) + "!"]) expect(configSchemas.infisical.safeParse({ ...infisical, secretPath }).success).toBe(false);
    for (const apiUrl of ["https://user:pass@vault.example.test", "https://vault.example.test/?token=x", "https://vault.example.test/#secret", "file:///tmp/vault"]) {
      expect(configSchemas.infisical.safeParse({ ...infisical, apiUrl }).success).toBe(false);
    }
    expect(requestSchema.safeParse({ action: "verify", step: "tailscale", config: tailscale }).success).toBe(false);
    expect(requestSchema.safeParse({ action: "save", step: "tailscale", config: tailscale, token: "secret" }).success).toBe(false);
  });
});

describe("outbound transport", () => {
  it("allows only exact configured HTTP origins and strips terminal slash", () => {
    expect(approvedApiUrl("https://vault.example.test/")).toBe("https://vault.example.test");
    expect(approvedApiUrl("https://gateway.example.test/base/")).toBe("https://gateway.example.test/base");
    for (const url of ["https://evil.test", "https://vault.example.test.evil.test", "http://vault.example.test", "https://u:p@vault.example.test", "https://vault.example.test/?q=1", "https://vault.example.test/#x", "ftp://vault.example.test"]) {
      expect(() => approvedApiUrl(url)).toThrow("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS");
    }
  });
  it("enforces no redirect/cache and parses empty or JSON responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(json({ ok: true }));
    await expect(requestJson("https://vault.example.test/health")).resolves.toEqual({});
    await expect(requestJson("https://vault.example.test/health", { method: "POST" })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });
  it("rejects non-success and oversized or invalid responses", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "private" }, 401)).mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1))).mockResolvedValueOnce(new Response("not json"));
    await expect(requestJson("https://vault.example.test/health")).rejects.toThrow("Service rejected");
    await expect(requestJson("https://vault.example.test/health")).rejects.toThrow("too large");
    await expect(requestJson("https://vault.example.test/health")).rejects.toThrow();
  });
});

describe("Infisical vault probe", () => {
  it("logs in, writes, reads, and deletes a temporary secret with scoped requests", async () => {
    let value = "";
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/login")) return json({ accessToken: "access" });
      if (init?.method === "POST") { value = JSON.parse(String(init.body)).secretValue; return json({}); }
      if (init?.method === "DELETE") return json({});
      return json({ secret: { secretValue: value } });
    });
    await verifyVault(infisical);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const login = fetchMock.mock.calls[0];
    expect(JSON.parse(String(login[1]?.body))).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
    const write = fetchMock.mock.calls[1];
    expect(JSON.parse(String(write[1]?.body))).toEqual(expect.objectContaining({ projectId: "project_1", environment: "prod", secretPath: "/fleet", type: "shared", secretValue: expect.any(String) }));
    expect(String(fetchMock.mock.calls[2][0])).toContain("expandSecretReferences=false");
    expect(fetchMock.mock.calls[3][1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer access" }));
  });
  it("verifies a separate connector folder as well as the account folder", async () => {
    const values = new Map<string, string>();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/login")) return json({ accessToken: "access" });
      if (init?.method === "POST") { const body = JSON.parse(String(init.body)); values.set(body.secretPath, body.secretValue); return json({}); }
      if (init?.method === "DELETE") return json({});
      return json({ secret: { secretValue: values.get(new URL(url).searchParams.get("secretPath") ?? "") } });
    });
    await verifyVault({ ...infisical, connectorSecretPath: "/connectors" });
    expect([...values.keys()]).toEqual(["/fleet", "/connectors"]);
    fetchMock.mockClear();
    await verifyVault({ ...infisical, connectorSecretPath: "" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("cleans up a mismatched or malformed read", async () => {
    fetchMock.mockResolvedValueOnce(json({ accessToken: "access" })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ secret: { secretValue: "wrong" } })).mockResolvedValueOnce(json({}));
    await expect(verifyVault(infisical)).rejects.toThrow("round-trip did not match");
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    fetchMock.mockReset().mockResolvedValueOnce(json({ accessToken: "access" })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ invalid: true })).mockResolvedValueOnce(json({}));
    await expect(verifyVault(infisical)).rejects.toThrow();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });
  it("does not delete a probe whose creation failed", async () => {
    fetchMock.mockResolvedValueOnce(json({ accessToken: "access" })).mockResolvedValueOnce(json({}, 500));
    await expect(verifyVault(infisical)).rejects.toThrow("Service rejected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("reports cleanup failure after a successful vault round trip", async () => {
    let value = "";
    fetchMock.mockImplementation(async (_input, init) => {
      if (fetchMock.mock.calls.length === 1) return json({ accessToken: "access" });
      if (init?.method === "POST") { value = JSON.parse(String(init.body)).secretValue; return json({}); }
      if (init?.method === "DELETE") return json({}, 500);
      return json({ secret: { secretValue: value } });
    });
    await expect(verifyVault(infisical)).rejects.toThrow("grant delete permission");
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });
  it("keeps the round-trip error when cleanup also fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(json({ accessToken: "access" })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ secret: { secretValue: "wrong" } })).mockResolvedValueOnce(json({}, 500));
    await expect(verifyVault(infisical)).rejects.toThrow("round-trip did not match");
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).not.toContain("wrong");
    logged.mockRestore();
  });
  it("reports missing credentials and invalid login response", async () => {
    delete process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
    await expect(vaultSession(infisical)).rejects.toThrow("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET = "secret";
    fetchMock.mockResolvedValueOnce(json({ accessToken: "" }));
    await expect(vaultSession(infisical)).rejects.toThrow();
  });
});

describe("service verification", () => {
  it("uses distinct credentials and validates both CLIProxy routes", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: "model" }] })).mockResolvedValueOnce(json({ files: [] }));
    await verifyStep("cliproxy", cliproxy);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://gateway.example.test/v1/models");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer model-key" });
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://gateway.example.test/v8/management/credentials");
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer management-key" });
  });
  it("rejects CLIProxy missing env and malformed route responses", async () => {
    delete process.env.CLIPROXY_MANAGEMENT_KEY;
    await expect(verifyStep("cliproxy", cliproxy)).rejects.toThrow("CLIPROXY_MANAGEMENT_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.CLIPROXY_MANAGEMENT_KEY = "management-key";
    fetchMock.mockResolvedValueOnce(json({ data: [3] }));
    await expect(verifyStep("cliproxy", cliproxy)).rejects.toThrow();
    fetchMock.mockReset().mockResolvedValueOnce(json({ data: [] })).mockResolvedValueOnce(json({ files: "invalid" }));
    await expect(verifyStep("cliproxy", cliproxy)).rejects.toThrow();
  });
  it("verifies an authorized recent selected Tailscale device on a local interface", async () => {
    fetchMock.mockResolvedValueOnce(json({ devices: [freshDevice()] }));
    await verifyStep("tailscale", tailscale);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/tailnet/example.ts.net/devices");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: `Basic ${Buffer.from("tailscale-token:").toString("base64")}` });
  });
  it("rejects missing token, malformed devices, unauthorized or stale selection", async () => {
    delete process.env.TAILSCALE_API_TOKEN;
    await expect(verifyStep("tailscale", tailscale)).rejects.toThrow("TAILSCALE_API_TOKEN");
    process.env.TAILSCALE_API_TOKEN = "token";
    fetchMock.mockResolvedValueOnce(json({ devices: [{}] }));
    await expect(verifyStep("tailscale", tailscale)).rejects.toThrow();
    for (const device of [{ ...freshDevice(), authorized: false }, { ...freshDevice(), lastSeen: new Date(Date.now() - 10 * 60 * 1000).toISOString() }, { ...freshDevice(), lastSeen: "invalid" }, { ...freshDevice(), id: "other", nodeId: "other" }]) {
      fetchMock.mockResolvedValueOnce(json({ devices: [device] }));
      await expect(verifyStep("tailscale", tailscale)).rejects.toThrow("authorized, recently online");
    }
  });
  it("does not accept a different local interface without status-file proof", async () => {
    networkInterfaces.mockReturnValue({ eth0: [{ address: "172.18.0.2" }] });
    fetchMock.mockResolvedValueOnce(json({ devices: [freshDevice()] }));
    await expect(verifyStep("tailscale", tailscale)).rejects.toThrow("FleetHub host enrollment is unverified");
  });
  it("accepts fresh host status-file proof when the container lacks the interface", async () => {
    networkInterfaces.mockReturnValue({ eth0: [{ address: "172.18.0.2" }] });
    process.env.TAILSCALE_STATUS_FILE = "/status/tailscale.json";
    fetchMock.mockResolvedValueOnce(json({ devices: [freshDevice()] }));
    stat.mockResolvedValueOnce({ size: 150, mtimeMs: Date.now() });
    readFile.mockResolvedValueOnce(JSON.stringify({ BackendState: "Running", Self: { ID: "node_1", TailscaleIPs: ["100.101.102.103"] } }));
    await verifyStep("tailscale", tailscale);
    expect(stat).toHaveBeenCalledWith("/status/tailscale.json");
    expect(readFile).toHaveBeenCalledWith("/status/tailscale.json", "utf8");
  });
  it("rejects stale, oversized, mismatched, and malformed status-file proof", async () => {
    networkInterfaces.mockReturnValue({ eth0: [{ address: "172.18.0.2" }] });
    process.env.TAILSCALE_STATUS_FILE = "/status/tailscale.json";
    for (const metadata of [{ size: 1024 * 1024 + 1, mtimeMs: Date.now() }, { size: 100, mtimeMs: Date.now() - 10 * 60 * 1000 }]) {
      fetchMock.mockResolvedValueOnce(json({ devices: [freshDevice()] })); stat.mockResolvedValueOnce(metadata);
      await expect(verifyStep("tailscale", tailscale)).rejects.toThrow("Refresh the host");
    }
    for (const status of [{ BackendState: "Running", Self: { ID: "other", TailscaleIPs: ["100.101.102.103"] } }, { BackendState: "Running", Self: { ID: "node_1", TailscaleIPs: ["100.0.0.1"] } }, { BackendState: "Stopped", Self: { ID: "node_1", TailscaleIPs: ["100.101.102.103"] } }]) {
      fetchMock.mockResolvedValueOnce(json({ devices: [freshDevice()] })); stat.mockResolvedValueOnce({ size: 100, mtimeMs: Date.now() }); readFile.mockResolvedValueOnce(JSON.stringify(status));
      await expect(verifyStep("tailscale", tailscale)).rejects.toThrow();
    }
  });
  it("rejects invalid public config before contacting services", async () => {
    await expect(verifyStep("tailscale", { ...tailscale, token: "secret" })).rejects.toThrow();
    await expect(verifyStep("infisical", { ...infisical, clientSecret: "secret" })).rejects.toThrow();
    await expect(verifyStep("cliproxy", { ...cliproxy, key: "secret" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


it("supports scoped OAuth access tokens for Tailscale and rejects unknown auth modes", async () => {
 process.env.TAILSCALE_API_AUTH = "bearer";
 fetchMock.mockResolvedValue(json({ devices: [freshDevice()] }));
 await verifyStep("tailscale", tailscale);
 expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer tailscale-token" });
 process.env.TAILSCALE_API_AUTH = "unsupported";
 await expect(verifyStep("tailscale", tailscale)).rejects.toThrow("TAILSCALE_API_AUTH must be basic or bearer");
});
