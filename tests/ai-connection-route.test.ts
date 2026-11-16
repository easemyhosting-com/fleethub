import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn(), key: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/ai/store", () => ({ readAiConnection: fixture.read, saveAiConnection: fixture.save, deleteAiConnection: fixture.remove, readAiKey: fixture.key }));
vi.mock("@/lib/ai/probe", () => ({ checkAiConnection: fixture.check }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
import { DELETE, GET, PUT } from "../src/app/api/ai-connection/route";
import { POST } from "../src/app/api/ai-connection/check/route";

const origin = "http://localhost:3060";
const settings = { endpoint: "https://ai.example.com/v1", protocol: "anthropic-messages", model: "fixture-model", secretRefId: null };
const request = (path: string, method: string, payload?: unknown, key = "ai-admin-fixture") => new Request(`${origin}${path}`, { method, headers: { authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
const connection = (method: string, payload?: unknown, key?: string) => request("/api/ai-connection", method, payload, key);
const check = (payload: unknown, key?: string) => request("/api/ai-connection/check", "POST", { expectedConnection: { ...settings, updatedAt: "2026-01-01T00:00:00.000Z" }, ...(typeof payload === "object" && payload !== null ? payload : {}) }, key);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
  vi.stubEnv("FLEETHUB_API_KEY", "ai-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "ai-read-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true });
  fixture.read.mockReset().mockResolvedValue({ connection: { ...settings, updatedAt: "2026-01-01T00:00:00.000Z" }, secretRefs: [], limited: false });
  fixture.save.mockReset().mockResolvedValue(true); fixture.remove.mockReset().mockResolvedValue(undefined);
  fixture.check.mockReset().mockResolvedValue({ schemaVersion: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("optional AI connection API", () => {
  it("denies anonymous and read-only callers on every method", async () => {
    for (const [key, status] of [["bad", 401], ["ai-read-fixture", 403]] as const) {
      expect((await GET(connection("GET", undefined, key))).status).toBe(status);
      expect((await PUT(connection("PUT", settings, key))).status).toBe(status);
      expect((await DELETE(connection("DELETE", undefined, key))).status).toBe(status);
      expect((await POST(check({ consentToBillableProbe: false }, key))).status).toBe(status);
    }
    for (const call of [fixture.read, fixture.save, fixture.remove, fixture.check]) expect(call).not.toHaveBeenCalled();
  });

  it("validates settings strictly and never accepts an inline key", async () => {
    for (const bad of [{ ...settings, apiKey: "inline-fixture" }, { ...settings, protocol: "any" }, { ...settings, endpoint: "not a url" }, ...["https://user:synthetic@ai.example.com/v1", "https://ai.example.com/v1?key=synthetic", "https://ai.example.com/v1#synthetic"].map(endpoint => ({ ...settings, endpoint }))]) {
      expect((await PUT(connection("PUT", bad))).status).toBe(400);
    }
    expect(fixture.save).not.toHaveBeenCalled();
    expect((await PUT(connection("PUT", settings))).status).toBe(200);
    expect(fixture.save).toHaveBeenCalledWith(settings);
    fixture.save.mockResolvedValueOnce(false);
    expect((await PUT(connection("PUT", { ...settings, secretRefId: "missing" }))).status).toBe(404);
    expect((await GET(connection("GET"))).headers.get("Cache-Control")).toBe("no-store");
  });

  it("requires an explicit consent decision before checking", async () => {
    for (const bad of [{}, { consentToBillableProbe: "yes" }, { consentToBillableProbe: true, extra: 1 }]) expect((await POST(check(bad))).status).toBe(400);
    expect(fixture.check).not.toHaveBeenCalled();
    expect((await POST(check({ consentToBillableProbe: false }))).status).toBe(200);
    expect(fixture.check.mock.calls[0][1]).toMatchObject({ consentToBillableProbe: false });
  });

  it("rejects stale consent before reading a key or probing", async () => {
    for (const changed of [{ model: "replacement" }, { updatedAt: "2026-01-02T00:00:00.000Z" }]) {
      fixture.read.mockResolvedValueOnce({ connection: { ...settings, updatedAt: "2026-01-01T00:00:00.000Z", ...changed }, secretRefs: [], limited: false });
      expect((await POST(check({ consentToBillableProbe: true }))).status).toBe(409);
    }
    expect(fixture.key).not.toHaveBeenCalled();
    expect(fixture.check).not.toHaveBeenCalled();
  });

  it("asks for settings first and hides check failure details", async () => {
    fixture.read.mockResolvedValueOnce({ connection: null, secretRefs: [], limited: false });
    expect((await POST(check({ consentToBillableProbe: false }))).status).toBe(409);
    fixture.check.mockRejectedValueOnce(new Error("private upstream detail"));
    const response = await POST(check({ consentToBillableProbe: false }));
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).not.toContain("private upstream detail");
  });

  it("reports database failures without internal detail", async () => {
    fixture.save.mockRejectedValueOnce(new Error("private database detail"));
    const response = await PUT(connection("PUT", settings));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    fixture.boot.mockResolvedValue({ success: false });
    for (const response of [await GET(connection("GET")), await DELETE(connection("DELETE")), await POST(check({ consentToBillableProbe: false }))]) expect(response.status).toBe(503);
  });
});
