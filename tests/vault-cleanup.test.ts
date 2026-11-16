import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const fx = vi.hoisted(() => ({
  calls: [] as string[],
  ref: undefined as Row | undefined,
  used: false,
  remove: vi.fn(async (_name: string) => undefined),
  open: vi.fn(),
}));
const tx = (strings: TemplateStringsArray) => {
  const sql = strings.join("?").replace(/\s+/g, " ");
  fx.calls.push(sql);
  if (sql.includes("FROM secret_refs WHERE id = ? FOR UPDATE")) return Promise.resolve(fx.ref ? [fx.ref] : []);
  if (sql.includes("AS used")) return Promise.resolve([{ used: fx.used }]);
  if (sql.includes("FROM onboarding_steps")) return Promise.resolve([{ config: { apiUrl: "https://vault.example.com" } }]);
  return Promise.resolve([]);
};
vi.mock("@/lib/db/client", () => ({ queryClient: Object.assign(() => Promise.resolve([]), { begin: async (fn: (sql: typeof tx) => Promise<void>) => fn(tx) }) }));
vi.mock("@/lib/onboarding/vault-ref", () => ({ openVaultForRef: fx.open }));
import { removeUnusedSecretRef } from "../src/lib/vault/cleanup";

const builtin = { vault_url: "builtin:fleethub", infisical_project: "fleet", environment: "prod", path: "/", keys: ["first", "second"] };
const external = { ...builtin, vault_url: "https://vault.example.com", keys: ["only"] };

beforeEach(() => {
  fx.calls = []; fx.ref = undefined; fx.used = false;
  fx.remove.mockClear(); fx.open.mockReset().mockResolvedValue({ remove: fx.remove });
});

describe("removeUnusedSecretRef", () => {
  it("does nothing for a reference that is already gone", async () => {
    expect(await removeUnusedSecretRef("missing")).toBe("missing");
    expect(fx.calls).toHaveLength(1);
  });

  it("locks first, then checks every dependent in a separate statement and keeps a used secret", async () => {
    fx.ref = builtin; fx.used = true;
    expect(await removeUnusedSecretRef("shared")).toBe("in_use");
    expect(fx.calls[0]).toContain("FOR UPDATE");
    for (const table of ["app_credential_links", "provider_accounts", "connectors", "ai_connections"]) expect(fx.calls[1]).toContain(`FROM ${table} WHERE secret_ref_id`);
    expect(fx.calls.some(sql => sql.startsWith("DELETE"))).toBe(false);
    expect(fx.open).not.toHaveBeenCalled();
  });

  it("deletes builtin secrets and the reference on the cleanup transaction", async () => {
    fx.ref = builtin;
    expect(await removeUnusedSecretRef("unused")).toBe("removed");
    expect(fx.open).not.toHaveBeenCalled();
    const deletes = fx.calls.filter(sql => sql.startsWith("DELETE"));
    expect(deletes).toEqual(["DELETE FROM secret_store WHERE name = ?", "DELETE FROM secret_store WHERE name = ?", "DELETE FROM secret_refs WHERE id = ?"]);
  });

  it("opens the verified external vault for other references and removes each key before the reference", async () => {
    fx.ref = external;
    await removeUnusedSecretRef("external");
    expect(fx.open).toHaveBeenCalledWith(expect.objectContaining({ vault_url: "https://vault.example.com", keys: ["only"] }), { apiUrl: "https://vault.example.com" });
    expect(fx.remove).toHaveBeenCalledWith("only");
    expect(fx.calls.at(-1)).toBe("DELETE FROM secret_refs WHERE id = ?");
  });

  it("keeps the reference when the vault removal fails", async () => {
    fx.ref = external; fx.remove.mockRejectedValueOnce(new Error("vault unavailable"));
    await expect(removeUnusedSecretRef("external")).rejects.toThrow("vault unavailable");
    expect(fx.calls.some(sql => sql.startsWith("DELETE FROM secret_refs"))).toBe(false);
  });

  it("refuses malformed reference metadata before touching any vault", async () => {
    fx.ref = { ...builtin, keys: [] };
    await expect(removeUnusedSecretRef("bad")).rejects.toThrow();
    expect(fx.calls.some(sql => sql.startsWith("DELETE"))).toBe(false);
  });
});
