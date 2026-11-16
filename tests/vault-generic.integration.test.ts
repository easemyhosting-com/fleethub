import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A verified built-in store needs a runtime fingerprint; stub only the setup state, keep the database and vault real.
vi.mock("@/lib/onboarding/service", () => {
  const state = { ready: true, steps: [{ id: "builtin", status: "verified", revision: 1, config: {} }] };
  return { refreshStaleVaultSteps: async () => state, getSetupState: async (read: () => Promise<unknown>) => { await read(); return state; } };
});
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { createBuiltinVault } from "../src/lib/vault/builtin";
import { removeGenericCredential, storeGenericCredential } from "../src/lib/vault/generic";
import { deleteAiConnection, readAiKey, saveAiConnection } from "../src/lib/ai/store";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("generic credentials (disposable PostgreSQL)", () => {
  const label = `generic-${randomUUID()}`;
  const value = "synthetic-generic-credential";
  const connector = `${label}-connector`;
  let guarded = false;
  let refId = "";
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local test database");
    guarded = true;
    expect((await bootstrapDatabase()).success).toBe(true);
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "fixture".repeat(8));
  });
  afterAll(async () => {
    try {
      if (!guarded) return;
      await deleteAiConnection();
      await queryClient`DELETE FROM connectors WHERE id = ${connector}`;
      const refs = await queryClient`SELECT id, keys FROM secret_refs WHERE label = ${label}`;
      for (const ref of refs) {
        await queryClient`DELETE FROM secret_refs WHERE id = ${String(ref.id)}`;
        for (const name of ref.keys as string[]) await queryClient`DELETE FROM secret_store WHERE name = ${name}`;
      }
    } finally {
      vi.unstubAllEnvs();
      await queryClient.end();
    }
  });

  it("stores the value encrypted under a single-key reference that the AI connection can use", async () => {
    refId = await storeGenericCredential({ label, value });
    const [ref] = await queryClient`SELECT vault_url, keys FROM secret_refs WHERE id = ${refId}`;
    expect(ref.vault_url).toBe("builtin:fleethub");
    expect(ref.keys).toHaveLength(1);
    const [row] = await queryClient`SELECT ciphertext FROM secret_store WHERE name = ${ref.keys[0]}`;
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain(value);
    expect(await createBuiltinVault().read(ref.keys[0])).toBe(value);
    expect(await saveAiConnection({ endpoint: "https://ai.example.com/v1", protocol: "anthropic-messages", model: "fixture", secretRefId: refId })).toBe(true);
    expect(await readAiKey(refId)).toBe(value);
  });

  it("keeps the stored copy while anything uses it, then removes only FleetHub's copy", async () => {
    expect(await removeGenericCredential(refId)).toBe("in_use");
    await deleteAiConnection();
    await queryClient`INSERT INTO connectors(id,kind,label,host_name,created_by,secret_ref_id) VALUES (${connector}, 'prometheus', 'Fixture', 'example.com', 'fixture', ${refId})`;
    expect(await removeGenericCredential(refId)).toBe("in_use");
    await queryClient`DELETE FROM connectors WHERE id = ${connector}`;
    const [ref] = await queryClient`SELECT keys FROM secret_refs WHERE id = ${refId}`;
    expect(await removeGenericCredential(refId)).toBe("removed");
    expect(await queryClient`SELECT id FROM secret_refs WHERE id = ${refId}`).toHaveLength(0);
    await expect(createBuiltinVault().read(ref.keys[0])).rejects.toThrow();
    expect(await removeGenericCredential(refId)).toBe("missing");
  });

  it("never removes a reference it did not create", async () => {
    const foreign = `FLEETHUB_GENERIC_${randomUUID().replaceAll("-", "")}`;
    await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys) VALUES (${foreign}, ${label}, 'builtin:fleethub', '/', ${JSON.stringify([foreign])}::jsonb)`;
    await createBuiltinVault().write(foreign, "synthetic-foreign-credential");
    expect(await removeGenericCredential(foreign)).toBe("not_generic");
    expect(await createBuiltinVault().read(foreign)).toBe("synthetic-foreign-credential");
  });
});
