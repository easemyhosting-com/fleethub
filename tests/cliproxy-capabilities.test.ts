import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageQuota, inspectCliProxy, quotaObservationSchema } from "../src/lib/cliproxy/capabilities";

let server: Server;
let base: string;
let modelsStatus = 200;
let credentialsStatus = 200;
let models: unknown = { data: [{ id: "example-model" }] };
let credentials: unknown = { files: [] };
let requests: { path: string; authorization: string | undefined }[];
beforeEach(async () => {
  modelsStatus = credentialsStatus = 200;
  models = { data: [{ id: "example-model" }] };
  credentials = { files: [] };
  requests = [];
  server = createServer((req, res) => {
    requests.push({ path: req.url ?? "", authorization: req.headers.authorization });
    const isModels = req.url === "/v1/models";
    res.writeHead(isModels ? modelsStatus : credentialsStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify(isModels ? models : credentials));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server port");
  base = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", base);
  vi.stubEnv("CLIPROXY_API_KEY", "test-inference-key");
  vi.stubEnv("CLIPROXY_MANAGEMENT_KEY", "test-management-key");
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "fixture".repeat(8));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
const inspect = () => inspectCliProxy({ apiUrl: base, consoleUrl: base });

describe("CLIProxy v8 capability adapter over HTTP", () => {
  it("keeps authentication, enablement, reported availability and quota independent and redacts upstream metadata", async () => {
    credentials = { files: [
      { auth_index: "private-index", name: "private@example.test.json", provider: "codex", disabled: true, unavailable: false, status_message: "Bearer PRIVATE_TOKEN", access_token: "PRIVATE_TOKEN" },
      { id: "private@example.test", provider: "secret-plugin-name", unavailable: true },
    ] };
    const result = await inspect();
    expect(result).toMatchObject({ schemaVersion: 1, adapter: "cliproxy-v8", serverVersion: null, inference: { authentication: "authenticated", modelCount: 1, upstreamAvailability: "unknown" }, management: { authentication: "authenticated" }, quota: { state: "unsupported" } });
    expect(result.credentials[0]).toMatchObject({ enablement: "disabled", authentication: "unknown", upstreamAvailability: "reported_available" });
    expect(result.credentials[1]).toMatchObject({ provider: "unknown", enablement: "unknown", upstreamAvailability: "reported_unavailable" });
    const text = JSON.stringify(result);
    for (const privateValue of ["private-index", "private@example.test", "PRIVATE_TOKEN", "secret-plugin-name"]) expect(text).not.toContain(privateValue);
    expect(requests).toEqual(expect.arrayContaining([
      { path: "/v1/models", authorization: "Bearer test-inference-key" },
      { path: "/v8/management/credentials", authorization: "Bearer test-management-key" },
    ]));
    expect((await inspect()).credentials[0].id).toBe(result.credentials[0].id);
  });
  it("does not let rejected management credentials erase successful inference authentication", async () => {
    credentialsStatus = 401;
    credentials = { error: "private upstream details" };
    const result = await inspect();
    expect(result.inference.authentication).toBe("authenticated");
    expect(result.management).toEqual({ state: "failed", authentication: "rejected", reason: "access_denied" });
    expect(result.credentials).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private upstream details");
  });
  it("treats absent or disabled endpoints as unknown authentication rather than unsupported server versions", async () => {
    credentialsStatus = 404;
    modelsStatus = 503;
    const result = await inspect();
    expect(result.management).toEqual({ state: "failed", authentication: "unknown", reason: "unavailable" });
    expect(result.inference.modelCount).toBeNull();
    expect(result.serverVersion).toBeNull();
  });
  it("rejects malformed and partial responses without inventing empty successful inventory", async () => {
    models = { data: [{ id: 3 }] };
    credentials = { files: [{ disabled: "false" }] };
    const result = await inspect();
    expect(result.inference).toMatchObject({ state: "failed", reason: "invalid_response", modelCount: null });
    expect(result.management).toMatchObject({ state: "failed", reason: "invalid_response" });
    credentials = { unrelated: [] };
    expect((await inspect()).management.state).toBe("failed");
  });
  it("accepts partial credential metadata as unknown states", async () => {
    credentials = { files: [{}] };
    expect((await inspect()).credentials[0]).toMatchObject({ provider: "unknown", enablement: "unknown", authentication: "unknown", upstreamAvailability: "unknown" });
  });
  it("does not send keys when configuration or runtime credentials are missing", async () => {
    vi.stubEnv("CLIPROXY_API_KEY", "");
    vi.stubEnv("CLIPROXY_MANAGEMENT_KEY", "");
    expect((await inspect()).inference.authentication).toBe("not_configured");
    expect(requests).toEqual([]);
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "https://different.example.test");
    await expect(inspect()).rejects.toThrow("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS");
    expect(requests).toEqual([]);
  });
});

it("models all quota lifecycle states and ages observations without losing their values", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const observed = quotaObservationSchema.parse({ state: "observed", observedAt: at, used: 3, limit: 10, unit: "requests" });
  expect(ageQuota(observed, Date.parse(at) + 100, 1000)).toEqual(observed);
  expect(ageQuota(observed, Date.parse(at) + 1000, 1000)).toEqual({ ...observed, state: "stale" });
  expect(ageQuota(observed, Date.parse(at) - 1, 1000).state).toBe("stale");
  for (const value of [{ state: "not_loaded" }, { state: "loading", attemptedAt: at }, { state: "unsupported", reason: "adapter_has_no_quota_reader" }, { state: "failed", attemptedAt: at, reason: "access_denied" }]) {
    const parsed = quotaObservationSchema.parse(value);
    expect(ageQuota(parsed, Date.now(), 1000)).toEqual(parsed);
    expect(parsed).not.toHaveProperty("used");
  }
  expect(quotaObservationSchema.safeParse({ state: "observed", observedAt: at }).success).toBe(false);
  expect(quotaObservationSchema.safeParse({ ...observed, limit: 0 }).success).toBe(false);
});
