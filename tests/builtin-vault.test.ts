import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinKey, builtinVaultUrl, countUnreadableSecrets, createBuiltinVault, type SecretRows } from "../src/lib/vault/builtin";
import { openVaultForRef, refScope } from "../src/lib/onboarding/vault-ref";

const env = { FLEETHUB_SECRET_STORE_KEY: "k".repeat(40) };
function memory() {
  const rows = new Map<string, { nonce: Buffer; ciphertext: Buffer }>();
  const adapter: SecretRows = {
    get: async name => rows.get(name),
    put: async (name, nonce, ciphertext) => { rows.set(name, { nonce, ciphertext }); },
    del: async name => { rows.delete(name); },
    names: async (limit: number, after?: string) => [...rows.keys()].filter(name => !name.startsWith("FLEETHUB_PROBE_") && name > (after ?? "")).sort().slice(0, limit),
  };
  return { rows, adapter };
}
afterEach(() => vi.unstubAllEnvs());

describe("built-in encrypted secret store", () => {
  it("counts secrets the current key cannot decrypt", async () => {
    const { adapter } = memory();
    await createBuiltinVault(adapter, env).write("A", "one");
    await createBuiltinVault(adapter, env).write("B", "two");
    expect(await countUnreadableSecrets(adapter, env)).toBe(0);
    expect(await countUnreadableSecrets(adapter, { FLEETHUB_SECRET_STORE_KEY: "z".repeat(40) })).toBe(2);
    expect(await countUnreadableSecrets({ ...adapter, names: undefined }, { FLEETHUB_SECRET_STORE_KEY: "z".repeat(40) })).toBe(0);
    // A secret beyond the first page is still checked.
    const other = { FLEETHUB_SECRET_STORE_KEY: "z".repeat(40) };
    for (const name of ["C", "D", "E"]) await createBuiltinVault(adapter, env).write(name, name);
    await createBuiltinVault(adapter, other).write("F", "written under another key");
    expect(await countUnreadableSecrets(adapter, env, 2)).toBe(1);
    expect(await countUnreadableSecrets(adapter, env, 3)).toBe(1);
  });
  it("round-trips values and never stores plaintext", async () => {
    const { rows, adapter } = memory();
    const vault = createBuiltinVault(adapter, env);
    await vault.write("S1", JSON.stringify({ apiToken: "super-secret-token" }));
    expect(await vault.read("S1")).toBe(JSON.stringify({ apiToken: "super-secret-token" }));
    const stored = rows.get("S1")!;
    expect(stored.ciphertext.toString("utf8")).not.toContain("super-secret-token");
    expect(stored.nonce).toHaveLength(12);
    await vault.write("S1", "again");
    expect(rows.get("S1")!.nonce.equals(stored.nonce)).toBe(false);
    await vault.remove("S1");
    await expect(vault.read("S1")).rejects.toThrow("not found");
  });

  it("rejects the wrong key, tampered data, and ciphertext moved to another name", async () => {
    const { rows, adapter } = memory();
    await createBuiltinVault(adapter, env).write("A", "value-a");
    await expect(createBuiltinVault(adapter, { FLEETHUB_SECRET_STORE_KEY: "z".repeat(40) }).read("A")).rejects.toThrow();
    rows.set("B", rows.get("A")!);
    await expect(createBuiltinVault(adapter, env).read("B")).rejects.toThrow();
    const tampered = Buffer.from(rows.get("A")!.ciphertext); tampered[0] ^= 1;
    rows.set("A", { nonce: rows.get("A")!.nonce, ciphertext: tampered });
    await expect(createBuiltinVault(adapter, env).read("A")).rejects.toThrow();
    rows.set("C", { nonce: Buffer.alloc(12), ciphertext: Buffer.alloc(4) });
    await expect(createBuiltinVault(adapter, env).read("C")).rejects.toThrow();
  });

  it("requires a long enough master key from the environment", async () => {
    expect(() => builtinKey({})).toThrow("FLEETHUB_SECRET_STORE_KEY");
    expect(() => builtinKey({ FLEETHUB_SECRET_STORE_KEY: "short" })).toThrow("at least 32");
    expect(builtinKey(env)).toHaveLength(32);
    await expect(createBuiltinVault(memory().adapter, {}).write("A", "v")).rejects.toThrow("FLEETHUB_SECRET_STORE_KEY");
  });
});

describe("vault reference resolver", () => {
  const ref = { vault_url: "http://infisical:8080", infisical_project: "p1", environment: "dev", path: "/" };
  const config = { apiUrl: "http://infisical:8080", consoleUrl: "http://localhost:8088", projectId: "p1", environment: "dev", secretPath: "/" };

  it("opens the built-in store for built-in references without any Infisical setup", async () => {
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "k".repeat(40));
    const vault = await openVaultForRef({ vault_url: builtinVaultUrl, infisical_project: "builtin", environment: "builtin", path: "/" }, null);
    expect(typeof vault.read).toBe("function");
  });

  it("refuses an Infisical reference that no longer matches the verified setup or approved origins", async () => {
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "http://infisical:8080,https://other.example");
    await expect(openVaultForRef({ ...ref, environment: "prod" }, config)).rejects.toThrow("does not match");
    await expect(openVaultForRef({ ...ref, infisical_project: "p2" }, config)).rejects.toThrow("does not match");
    // The client secret is only sent to the configured origin, even when another origin is allowlisted.
    await expect(openVaultForRef({ ...ref, vault_url: "https://other.example" }, config)).rejects.toThrow("does not match");
    await expect(openVaultForRef({ ...ref, path: "../other" }, config)).rejects.toThrow("does not match");
    await expect(openVaultForRef({ ...ref, path: "/a//b" }, config)).rejects.toThrow("does not match");
    await expect(openVaultForRef(ref, null)).rejects.toThrow();
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "");
    await expect(openVaultForRef(ref, config)).rejects.toThrow("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS");
  });

  it("reads a reference from the folder it was written to after the configured folder changes", () => {
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "http://infisical:8080");
    const moved = { ...config, secretPath: "/accounts", connectorSecretPath: "/connectors" };
    expect(refScope(ref, moved)).toEqual({ ...moved, secretPath: "/" });
    expect(refScope({ ...ref, path: "/connectors" }, moved).secretPath).toBe("/connectors");
  });
});
