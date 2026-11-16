import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  sql: [] as string[],
  values: [] as unknown[][],
  keys: undefined as unknown,
  owned: true,
  state: { ready: true, steps: [{ id: "infisical", status: "unconfigured", revision: 0, config: {} }, { id: "builtin", status: "verified", revision: 2, config: {} }] } as { ready: boolean; steps: { id: string; status: string; revision: number; config: unknown }[] },
  current: undefined as unknown,
  stored: new Map<string, string>(),
  readOverride: undefined as string | undefined,
  removed: [] as string[],
  session: vi.fn(),
  cleanup: vi.fn(async (_id: string) => "removed"),
}));
const { vault, sql } = vi.hoisted(() => {
  const vault = {
  write: async (name: string, value: string) => { fx.stored.set(name, value); },
  read: async (name: string) => fx.readOverride ?? fx.stored.get(name) ?? "",
  remove: async (name: string) => { fx.removed.push(name); fx.stored.delete(name); },
};
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join("?").replace(/\s+/g, " ").trim();
  fx.sql.push(text); fx.values.push(values);
  if (text.startsWith("SELECT keys, generic_owned FROM secret_refs")) return Promise.resolve(fx.keys === undefined ? [] : [{ keys: fx.keys, generic_owned: fx.owned }]);
  return Promise.resolve([]);
};
  return { vault, sql };
});
vi.mock("@/lib/db/client", () => ({ queryClient: Object.assign(sql, { begin: async (fn: (tx: typeof sql) => Promise<unknown>) => fn(sql) }) }));
vi.mock("@/lib/onboarding/service", () => ({
  refreshStaleVaultSteps: async () => fx.state,
  getSetupState: async (read: () => Promise<unknown>) => { await read(); return fx.current ?? fx.state; },
}));
vi.mock("@/lib/onboarding/vault", () => ({ vaultSession: fx.session }));
vi.mock("@/lib/vault/builtin", () => ({ builtinVaultUrl: "builtin:fleethub", createBuiltinVault: () => vault }));
vi.mock("@/lib/vault/cleanup", () => ({ removeUnusedSecretRef: fx.cleanup }));
import { genericCredentialInput, removeGenericCredential, storeGenericCredential, VaultNotReadyError } from "../src/lib/vault/generic";

const value = "synthetic-generic-value";
beforeEach(() => {
  fx.owned = true; fx.sql = []; fx.values = []; fx.keys = undefined; fx.current = undefined; fx.readOverride = undefined; fx.removed = []; fx.stored.clear();
  fx.state.ready = true; fx.state.steps[0].status = "unconfigured";
  fx.session.mockReset().mockResolvedValue(vault); fx.cleanup.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("generic credential storage", () => {
  it("refuses to store anything until a secret store is verified", async () => {
    fx.state.ready = false;
    await expect(storeGenericCredential({ label: "Key", value })).rejects.toBeInstanceOf(VaultNotReadyError);
    expect(fx.stored.size).toBe(0);
  });

  it("writes to the built-in store, verifies the write and records a single-key reference without the value", async () => {
    const id = await storeGenericCredential({ label: "Key", value });
    expect(id).toMatch(/^ref-/);
    const [name] = [...fx.stored.keys()];
    expect(name).toMatch(/^FLEETHUB_GENERIC_[0-9a-f]{32}$/);
    expect(fx.sql.some(text => text.includes("pg_advisory_xact_lock"))).toBe(true);
    const insert = fx.values[fx.sql.findIndex(text => text.startsWith("INSERT INTO secret_refs"))];
    expect(insert).toEqual([id, "Key", "builtin:fleethub", "builtin", "builtin", "/", JSON.stringify([name])]);
    expect(JSON.stringify(fx.values)).not.toContain(value);
    expect(fx.session).not.toHaveBeenCalled();
  });

  it("prefers a verified Infisical store", async () => {
    fx.state.steps[0] = { id: "infisical", status: "verified", revision: 1, config: { apiUrl: "https://vault.example.com", consoleUrl: "https://vault.example.com", projectId: "project", environment: "dev", secretPath: "/generic" } };
    await storeGenericCredential({ label: "Key", value });
    expect(fx.session).toHaveBeenCalledWith(expect.objectContaining({ apiUrl: "https://vault.example.com", secretPath: "/generic" }));
    fx.state.steps[0] = { id: "infisical", status: "unconfigured", revision: 0, config: {} };
  });

  it("removes the written secret when verification fails or setup changes, and hides the cause", async () => {
    fx.readOverride = "different";
    await expect(storeGenericCredential({ label: "Key", value })).rejects.toThrow("Credential could not be stored");
    expect(fx.removed).toHaveLength(1);
    fx.readOverride = undefined; fx.removed = [];
    fx.current = { ready: true, steps: fx.state.steps.map(step => ({ ...step, revision: step.revision + 1 })) };
    await expect(storeGenericCredential({ label: "Key", value })).rejects.toThrow("Credential could not be stored");
    expect(fx.removed).toHaveLength(1);
    expect(fx.sql.some(text => text.startsWith("INSERT INTO secret_refs"))).toBe(false);
  });

  it("removes only FleetHub-created generic references and reports why others stay", async () => {
    expect(await removeGenericCredential("missing")).toBe("missing");
    for (const keys of [["opaque"], ["FLEETHUB_ACCOUNT_0123456789abcdef0123456789abcdef"], ["FLEETHUB_GENERIC_0123456789abcdef0123456789abcdef", "other"], "not-a-list"]) {
      fx.keys = keys;
      expect(await removeGenericCredential("ref")).toBe("not_generic");
    }
    expect(fx.cleanup).not.toHaveBeenCalled();
    fx.keys = ["FLEETHUB_GENERIC_0123456789abcdef0123456789abcdef"];
    fx.owned = false;
    expect(await removeGenericCredential("ref")).toBe("not_generic");
    expect(fx.cleanup).not.toHaveBeenCalled();
    fx.owned = true;
    expect(await removeGenericCredential("ref")).toBe("removed");
    expect(fx.cleanup).toHaveBeenCalledWith("ref");
  });

  it("accepts only a label and a bounded value", () => {
    expect(genericCredentialInput.safeParse({ label: "Key", value }).success).toBe(true);
    for (const bad of [{ label: "Key" }, { label: "", value }, { label: "Key", value: "x".repeat(8193) }, { label: "Key", value, scopes: [] }]) {
      expect(genericCredentialInput.safeParse(bad).success).toBe(false);
    }
  });
});
