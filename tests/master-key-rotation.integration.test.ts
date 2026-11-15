import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { queryClient } from "../src/lib/db/client";
import { createBuiltinVault, databaseSecretRows } from "../src/lib/vault/builtin";
import { rotateBuiltinMasterKey } from "../src/lib/vault/master-key-rotation";

const names = ["rotation-a", "rotation-b", "FLEETHUB_PROBE_ROTATION_FIXTURE"];
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("transactional master-key rotation on disposable PostgreSQL", () => {
  const oldKey = randomBytes(48).toString("base64"), newKey = randomBytes(48).toString("base64");
  const oldVault = createBuiltinVault(databaseSecretRows, { FLEETHUB_SECRET_STORE_KEY: oldKey });
  const newVault = createBuiltinVault(databaseSecretRows, { FLEETHUB_SECRET_STORE_KEY: newKey });
  const input = { oldKey, newKey, maintenanceConfirmed: true as const };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
    const [row] = await queryClient`SELECT COUNT(*)::int AS count FROM secret_store`;
    if (row.count !== 0) throw new Error("Rotation fixture requires an empty disposable store");
  });
  beforeEach(async () => { for (const name of names) await oldVault.write(name, "synthetic value"); });
  afterEach(async () => {
    await queryClient`DROP TRIGGER IF EXISTS fixture_rotation_interrupt ON secret_store`;
    await queryClient`DROP FUNCTION IF EXISTS fixture_rotation_interrupt()`;
    await queryClient`DELETE FROM secret_store WHERE name = ANY(${names})`;
  });
  afterAll(async () => { await queryClient.end(); });
  const snapshot = async () => (await queryClient`SELECT name,nonce,ciphertext FROM secret_store ORDER BY name`).map(row => ({ name: row.name, nonce: Buffer.from(row.nonce).toString("hex"), ciphertext: Buffer.from(row.ciphertext).toString("hex") }));

  it("rotates every row including probes with fresh nonces and unchanged references", async () => {
    const before = await snapshot();
    expect(await rotateBuiltinMasterKey(queryClient, input)).toEqual({ rotatedCount: 3 });
    const after = await snapshot();
    expect(after.map(row => row.name)).toEqual(before.map(row => row.name));
    expect(after.every((row, index) => row.nonce !== before[index].nonce)).toBe(true);
    for (const name of names) {
      expect((await newVault.read(name)) === "synthetic value").toBe(true);
      await expect(oldVault.read(name)).rejects.toThrow();
    }
  });
  it("validates wrong, short and unchanged keys before any ciphertext changes", async () => {
    const before = await snapshot();
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, oldKey: randomBytes(48).toString("base64") })).rejects.toMatchObject({ code: "unreadable_store" });
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, newKey: "short" })).rejects.toMatchObject({ code: "invalid_key" });
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, newKey: oldKey })).rejects.toMatchObject({ code: "unchanged_key" });
    expect(JSON.stringify(await snapshot()) === JSON.stringify(before)).toBe(true);
  });
  it("rejects tampered ciphertext without rewriting any other row", async () => {
    const row = await databaseSecretRows.get(names[1]);
    if (!row) throw new Error("Fixture missing");
    const corrupted = Buffer.from(row.ciphertext); corrupted[0] ^= 1;
    await databaseSecretRows.put(names[1], row.nonce, corrupted);
    const before = await snapshot();
    await expect(rotateBuiltinMasterKey(queryClient, input)).rejects.toMatchObject({ code: "unreadable_store" });
    expect(JSON.stringify(await snapshot()) === JSON.stringify(before)).toBe(true);
  });
  it("rolls back earlier rewrites when the database interrupts a later UPDATE", async () => {
    const before = await snapshot();
    await queryClient`CREATE FUNCTION fixture_rotation_interrupt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = 'rotation-b' THEN RAISE EXCEPTION 'fixture interrupted'; END IF; RETURN NEW; END $$`;
    await queryClient`CREATE TRIGGER fixture_rotation_interrupt BEFORE UPDATE ON secret_store FOR EACH ROW EXECUTE FUNCTION fixture_rotation_interrupt()`;
    await expect(rotateBuiltinMasterKey(queryClient, input)).rejects.toMatchObject({ code: "rotation_failed" });
    expect(JSON.stringify(await snapshot()) === JSON.stringify(before)).toBe(true);
    for (const name of names) expect((await oldVault.read(name)) === "synthetic value").toBe(true);
  });
  it("runs the offline CLI using private files and prints only a count or generic failure", async () => {
    const build = spawnSync(process.execPath, ["scripts/build-master-key-rotation.mjs"], { encoding: "utf8" });
    expect(build.status === 0).toBe(true);
    const root = join(homedir(), ".cache", "fleethub-tests");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(root, "rotation-"));
    const oldFile = join(directory, "old-master"), newFile = join(directory, "new-master");
    try {
      await writeFile(oldFile, oldKey + "\n", { mode: 0o600 });
      await writeFile(newFile, newKey + "\n", { mode: 0o600 });
      const args = ["build/master-key-rotation.mjs", "--old-key-file", oldFile, "--new-key-file", newFile];
      const denied = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(denied.status).toBe(1);
      await chmod(newFile, 0o644);
      const exposed = spawnSync(process.execPath, [...args, "--offline-maintenance"], { encoding: "utf8" });
      expect(exposed.status).toBe(1);
      expect((await oldVault.read(names[0])) === "synthetic value").toBe(true);
      await chmod(newFile, 0o600);
      const completed = spawnSync(process.execPath, [...args, "--offline-maintenance"], { encoding: "utf8" });
      expect(completed.status).toBe(0);
      expect(JSON.parse(completed.stdout)).toEqual({ rotatedCount: 3 });
      expect(completed.stderr).toBe("");
      const output = [denied, exposed, completed].map(result => result.stdout + result.stderr).join("");
      expect(output.includes(oldKey) || output.includes(newKey)).toBe(false);
      expect((await newVault.read(names[0])) === "synthetic value").toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("does not start an aborted request and rejects empty stores", async () => {
    const controller = new AbortController(); controller.abort();
    const before = await snapshot();
    await expect(rotateBuiltinMasterKey(queryClient, { ...input, signal: controller.signal })).rejects.toMatchObject({ code: "interrupted" });
    expect(JSON.stringify(await snapshot()) === JSON.stringify(before)).toBe(true);
    await queryClient`DELETE FROM secret_store WHERE name = ANY(${names})`;
    await expect(rotateBuiltinMasterKey(queryClient, input)).rejects.toMatchObject({ code: "empty_store" });
  });
});
