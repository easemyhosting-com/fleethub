import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { createBuiltinVault } from "../src/lib/vault/builtin";
import { verifyStep } from "../src/lib/onboarding/verify";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("built-in secret store (PostgreSQL)", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "integration-master-key-at-least-32-chars");
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
  });
  afterAll(async () => { await queryClient`DELETE FROM secret_store WHERE name LIKE 'IT_%'`; vi.unstubAllEnvs(); await queryClient.end(); });

  it("stores only ciphertext, overwrites, reads back and removes", async () => {
    const vault = createBuiltinVault();
    await vault.write("IT_ONE", "plain-secret-value");
    const row = (await queryClient`SELECT nonce, ciphertext FROM secret_store WHERE name = 'IT_ONE'`)[0];
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain("plain-secret-value");
    expect(await vault.read("IT_ONE")).toBe("plain-secret-value");
    await vault.write("IT_ONE", "second");
    expect(await vault.read("IT_ONE")).toBe("second");
    await vault.remove("IT_ONE");
    await expect(vault.read("IT_ONE")).rejects.toThrow("not found");
  });

  it("passes setup verification and leaves no probe secret behind", async () => {
    await expect(verifyStep("builtin", {})).resolves.toBeUndefined();
    expect((await queryClient`SELECT count(*)::int AS n FROM secret_store WHERE name LIKE 'FLEETHUB_PROBE_%'`)[0].n).toBe(0);
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "");
    await expect(verifyStep("builtin", {})).rejects.toThrow("FLEETHUB_SECRET_STORE_KEY");
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "integration-master-key-at-least-32-chars");
  });
});
