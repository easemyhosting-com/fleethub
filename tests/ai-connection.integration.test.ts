import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { createBuiltinVault } from "../src/lib/vault/builtin";
import { removeUnusedSecretRef } from "../src/lib/vault/cleanup";
import { deleteAiConnection, readAiConnection, readAiKey, saveAiConnection } from "../src/lib/ai/store";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("optional AI connection (disposable PostgreSQL)", () => {
  const ref = `ai-${randomUUID()}-ref`;
  let guarded = false;
  const settings = { endpoint: "https://ai.example.com/v1", protocol: "openai-responses" as const, model: "fixture-model", secretRefId: ref };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local test database");
    guarded = true;
    expect((await bootstrapDatabase()).success).toBe(true);
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "fixture".repeat(8));
    await createBuiltinVault().write(ref, "synthetic-ai-credential");
    await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys) VALUES (${ref}, 'AI key', 'builtin:fleethub', '/', ${JSON.stringify([ref])}::jsonb)`;
  });
  afterAll(async () => {
    try {
      // Never touch a database that failed the disposable-database guard.
      if (!guarded) return;
      await deleteAiConnection();
      await queryClient`DELETE FROM secret_refs WHERE id = ${ref}`;
      await queryClient`DELETE FROM secret_store WHERE name = ${ref}`;
    } finally {
      vi.unstubAllEnvs();
      await queryClient.end();
    }
  });

  it("starts with no connection, so AI stays optional", async () => {
    await deleteAiConnection();
    expect((await readAiConnection()).connection).toBeNull();
  });

  it("saves, replaces and forgets one connection without returning the key", async () => {
    expect(await saveAiConnection(settings)).toBe(true);
    expect(await saveAiConnection({ ...settings, model: "second-model" })).toBe(true);
    const snapshot = await readAiConnection();
    expect(snapshot.connection).toMatchObject({ ...settings, model: "second-model" });
    expect(snapshot.secretRefs).toContainEqual({ id: ref, label: "AI key" });
    expect(JSON.stringify(snapshot)).not.toContain("synthetic-ai-credential");
    expect(await readAiKey(ref)).toBe("synthetic-ai-credential");
    expect(await saveAiConnection({ ...settings, secretRefId: `${ref}-missing` })).toBe(false);
    expect((await readAiConnection()).connection?.model).toBe("second-model");
  });

  it("keeps a key in use by the AI connection during cleanup, and disconnecting does not delete it", async () => {
    expect(await saveAiConnection(settings)).toBe(true);
    await removeUnusedSecretRef(ref);
    expect(await createBuiltinVault().read(ref)).toBe("synthetic-ai-credential");
    await deleteAiConnection();
    expect((await queryClient`SELECT id FROM secret_refs WHERE id = ${ref}`)).toHaveLength(1);
    expect((await readAiConnection()).connection).toBeNull();
  });

  it("refuses a multi-key reference because it does not identify the AI key", async () => {
    const multi = `${ref}-multi`;
    await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys) VALUES (${multi}, 'Several keys', 'builtin:fleethub', '/', ${JSON.stringify([`${multi}-a`, `${multi}-b`])}::jsonb)`;
    try {
      expect(await saveAiConnection({ ...settings, secretRefId: multi })).toBe(false);
      expect((await readAiConnection()).secretRefs.map(item => item.id)).not.toContain(multi);
      await expect(readAiKey(multi)).rejects.toThrow("credential_unavailable");
    } finally {
      await queryClient`DELETE FROM secret_refs WHERE id = ${multi}`;
    }
  });

  it("enforces one row and known protocols in the database", async () => {
    await expect(queryClient`INSERT INTO ai_connections(id,endpoint,protocol,model) VALUES ('second','https://ai.example.com/v1','openai-responses','m')`).rejects.toMatchObject({ code: "23514" });
    await expect(queryClient`INSERT INTO ai_connections(id,endpoint,protocol,model) VALUES ('default','https://ai.example.com/v1','openai-compatible','m')`).rejects.toMatchObject({ code: "23514" });
  });
});
