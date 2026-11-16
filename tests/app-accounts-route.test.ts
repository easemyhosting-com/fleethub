import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/app-accounts/store", () => ({ readAppAccounts: fixture.read, saveAppAccountCommand: fixture.save }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
import { GET, POST } from "../src/app/api/app-accounts/route";
import { appAccountCommand } from "../src/lib/app-accounts/model";
const origin = "http://localhost:3060";
const body = { action: "account", label: "App", service: "Example", ownerContactId: "contact-1" };
const request = (method: string, payload?: unknown, key = "ledger-admin-fixture") => new Request(`${origin}/api/app-accounts`, { method, headers: { authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
  vi.stubEnv("FLEETHUB_API_KEY", "ledger-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "ledger-read-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true }); fixture.read.mockReset().mockResolvedValue({ accounts: [] }); fixture.save.mockReset().mockResolvedValue("app-1");
});
afterEach(() => vi.unstubAllEnvs());
describe("operator-only app-account API", () => {
  it("denies anonymous and read-only access to contacts and mutations", async () => {
    for (const [key, status] of [["bad", 401], ["ledger-read-fixture", 403]] as const) {
      expect((await GET(request("GET", undefined, key))).status).toBe(status);
      expect((await POST(request("POST", body, key))).status).toBe(status);
    }
    expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.save).not.toHaveBeenCalled();
  });
  it("validates strict metadata before database access", async () => {
    for (const bad of [{ ...body, apiKey: "not-a-real-secret" }, { ...body, ownerContactId: "" }, { action: "account" }]) expect((await POST(request("POST", bad))).status).toBe(400);
    expect(fixture.save).not.toHaveBeenCalled();
    expect((await POST(request("POST", body))).status).toBe(200);
    expect(fixture.save).toHaveBeenCalledWith(body);
    expect((await GET(request("GET"))).headers.get("Cache-Control")).toBe("no-store");
  });
  it("maps missing relations and failures without disclosing internal data", async () => {
    fixture.save.mockResolvedValueOnce(null);
    expect((await POST(request("POST", body))).status).toBe(404);
    fixture.save.mockRejectedValueOnce(new Error("private database detail"));
    const response = await POST(request("POST", body));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await GET(request("GET"))).status).toBe(503);
    expect((await POST(request("POST", body))).status).toBe(503);
  });
  it("requires explicit validity and rejects secret payload fields and excessive scopes", () => {
    const credential = { action: "credential", workspaceId: "w", secretRefId: "s", label: "Key", issuer: "Issuer", purpose: "Read", environment: "dev", scopes: [], expiresAt: null, validity: "unknown" };
    expect(appAccountCommand.safeParse(credential).success).toBe(true);
    for (const bad of [{ ...credential, value: "no" }, { ...credential, validity: "verified" }, { ...credential, scopes: Array(41).fill("read") }, { ...credential, expiresAt: "not-a-date" }]) expect(appAccountCommand.safeParse(bad).success).toBe(false);
  });
});
