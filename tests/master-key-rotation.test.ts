import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { queryClient } from "../src/lib/db/client";
import { MasterKeyRotationError, rotateBuiltinMasterKey } from "../src/lib/vault/master-key-rotation";

const oldKey = randomBytes(48).toString("base64"), newKey = randomBytes(48).toString("base64");
const input = { oldKey, newKey, maintenanceConfirmed: true as const };
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await queryClient.end(); });

describe("Master-key rotation preflight", () => {
  it("refuses invalid old/new keys before opening a database transaction", async () => {
    const begin = vi.spyOn(queryClient, "begin").mockRejectedValue(new Error("Must not execute"));
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, oldKey: "short" })).rejects.toMatchObject({ code: "invalid_key" });
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, newKey: "short" })).rejects.toMatchObject({ code: "invalid_key" });
    expect(begin).not.toHaveBeenCalled();
  });
  it("rejects unchanged keys without connecting", async () => {
    const begin = vi.spyOn(queryClient, "begin").mockRejectedValue(new Error("Must not execute"));
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, newKey: oldKey })).rejects.toMatchObject({ code: "unchanged_key" });
    expect(begin).not.toHaveBeenCalled();
  });
  it("rejects pre-cancelled requests without connecting", async () => {
    const begin = vi.spyOn(queryClient, "begin").mockRejectedValue(new Error("Must not execute"));
    const controller = new AbortController(); controller.abort();
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, signal: controller.signal })).rejects.toMatchObject({ code: "interrupted" });
    expect(begin).not.toHaveBeenCalled();
  });
  it("sanitizes connection failures rather than returning driver details or keys", async () => {
    vi.spyOn(queryClient, "begin").mockRejectedValue(new Error("synthetic driver detail " + oldKey));
    let failure: unknown;
    try { await rotateBuiltinMasterKey(queryClient, input); } catch (error) { failure = error; }
    expect(failure instanceof MasterKeyRotationError).toBe(true);
    expect(String(failure)).toBe("Error: Master-key rotation failed: rotation_failed");
    expect(String(failure).includes(oldKey)).toBe(false);
  });
});
