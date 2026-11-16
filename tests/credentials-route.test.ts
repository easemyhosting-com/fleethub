import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), store: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/vault/generic", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/vault/generic")>("../src/lib/vault/generic");
  return { ...actual, storeGenericCredential: fixture.store, removeGenericCredential: fixture.remove };
});
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
import { DELETE, POST } from "../src/app/api/credentials/route";
import { VaultNotReadyError } from "../src/lib/vault/generic";

const value = "synthetic-route-value";
const request = (method: string, payload: unknown, key = "cred-admin-fixture") => new Request("http://localhost:3060/api/credentials", { method, headers: { authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
  vi.stubEnv("FLEETHUB_API_KEY", "cred-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "cred-read-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true });
  fixture.store.mockReset().mockResolvedValue("ref-new"); fixture.remove.mockReset().mockResolvedValue("removed");
});
afterEach(() => vi.unstubAllEnvs());

describe("generic credential API", () => {
  it("denies anonymous and read-only callers", async () => {
    for (const [key, status] of [["bad", 401], ["cred-read-fixture", 403]] as const) {
      expect((await POST(request("POST", { label: "Key", value }, key))).status).toBe(status);
      expect((await DELETE(request("DELETE", { refId: "ref-new" }, key))).status).toBe(status);
    }
    expect(fixture.store).not.toHaveBeenCalled(); expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("stores with a strict schema and never echoes the value", async () => {
    for (const bad of [{ label: "Key" }, { label: "Key", value, purpose: "x" }, { label: "Key", value: "x".repeat(8193) }]) expect((await POST(request("POST", bad))).status).toBe(400);
    expect(fixture.store).not.toHaveBeenCalled();
    const response = await POST(request("POST", { label: "Key", value }));
    expect(response.status).toBe(201);
    const body = JSON.stringify(await response.json());
    expect(body).toBe(JSON.stringify({ id: "ref-new" })); expect(body).not.toContain(value);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("maps store failures without detail", async () => {
    fixture.store.mockRejectedValueOnce(new VaultNotReadyError());
    expect((await POST(request("POST", { label: "Key", value }))).status).toBe(409);
    fixture.store.mockRejectedValueOnce(new Error("private vault detail"));
    const failed = await POST(request("POST", { label: "Key", value }));
    expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("private");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await POST(request("POST", { label: "Key", value }))).status).toBe(503);
    expect((await DELETE(request("DELETE", { refId: "ref-new" }))).status).toBe(503);
  });

  it("states that removal is not revocation and refuses keys in use or not created here", async () => {
    const removed = await DELETE(request("DELETE", { refId: "ref-new" }));
    expect(await removed.json()).toEqual({ removed: true, revokedUpstream: false });
    for (const [outcome, status] of [["missing", 404], ["in_use", 409], ["not_generic", 409]] as const) {
      fixture.remove.mockResolvedValueOnce(outcome);
      expect((await DELETE(request("DELETE", { refId: "ref-new" }))).status).toBe(status);
    }
    expect((await DELETE(request("DELETE", { refId: "bad id" }))).status).toBe(400);
    fixture.remove.mockRejectedValueOnce(new Error("private"));
    expect((await DELETE(request("DELETE", { refId: "ref-new" }))).status).toBe(503);
  });
});
