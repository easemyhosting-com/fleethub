import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { queryClient } from "../src/lib/db/client";
import { createBuiltinVault, secretRows } from "../src/lib/vault/builtin";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("encrypted secret restore on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
  });
  afterAll(async () => { await queryClient.end(); });
  it("recovers an encrypted-row backup only with the separately retained key, without secret output", async () => {
    const retainedKey = randomBytes(48).toString("base64"), plaintext = randomBytes(32).toString("base64");
    const env = { FLEETHUB_SECRET_STORE_KEY: retainedKey };
    const name = `restore-${randomUUID()}`;
    const logged: unknown[][] = [];
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    for (const spy of spies) spy.mockImplementation((...args: unknown[]) => { logged.push(args); });
    try {
      await queryClient.begin(async sql => {
        const rows = secretRows(sql), original = createBuiltinVault(rows, env);
        await original.write(name, plaintext);
        const backup = await rows.get(name);
        if (!backup) throw new Error("Encrypted backup missing");
        expect(backup.ciphertext.includes(Buffer.from(plaintext))).toBe(false);
        expect(backup.ciphertext.includes(Buffer.from(retainedKey))).toBe(false);
        await rows.del(name);
        await expect(original.read(name)).rejects.toThrow();
        await rows.put(name, Buffer.from(backup.nonce), Buffer.from(backup.ciphertext));
        const restored = createBuiltinVault(secretRows(sql), env);
        expect((await restored.read(name)) === plaintext).toBe(true);
        await expect(createBuiltinVault(rows, { FLEETHUB_SECRET_STORE_KEY: randomBytes(48).toString("base64") }).read(name)).rejects.toThrow();
        const tampered = Buffer.from(backup.ciphertext); tampered[0] ^= 1;
        await rows.put(name, backup.nonce, tampered);
        await expect(restored.read(name)).rejects.toThrow();
        await rows.del(name);
      });
      const output = JSON.stringify(logged);
      expect(output.includes(plaintext)).toBe(false);
      expect(output.includes(retainedKey)).toBe(false);
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});
