import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  account: { id: "acc-existing", kind: "cloudflare", label: "Original", owner_email: "owner@example.test", login_email: "login@example.test", secret_ref_id: null as string | null, is_protected: true, enabled: false },
  vault: new Map<string, string>(),
  removed: [] as string[],
  sql: [] as string[],
  mutateAfterWrite: false,
}));
vi.mock("@/lib/onboarding/service", () => {
  const getSetupState = vi.fn(async () => ({ ready: true, steps: [
  { id: "tailscale", revision: 1, config: {} },
  { id: "infisical", status: "verified", revision: 1, config: { apiUrl: "http://infisical:8080", consoleUrl: "http://localhost:8088", projectId: "project_1", environment: "dev", secretPath: "/" } },
  { id: "cliproxy", revision: 1, config: {} },
] }));
  return { getSetupState, refreshStaleVaultSteps: () => getSetupState() };
});
vi.mock("@/lib/onboarding/vault", () => ({ vaultSession: vi.fn(async () => ({
  write: async (name: string, value: string) => {
    fixture.vault.set(name, value);
    if (fixture.mutateAfterWrite) fixture.account.secret_ref_id = "ref-racer";
  },
  read: async (name: string) => fixture.vault.get(name),
  remove: async (name: string) => { fixture.vault.delete(name); fixture.removed.push(name); },
})) }));
vi.mock("@/lib/db/client", () => {
  async function query(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    fixture.sql.push(sql);
    if (sql.startsWith("SELECT id, kind, label, owner_email, secret_ref_id")) return values[0] === fixture.account.id ? [{ ...fixture.account }] : [];
    if (sql.startsWith("UPDATE provider_accounts SET secret_ref_id")) {
      if (fixture.account.secret_ref_id !== null) return [];
      fixture.account.secret_ref_id = String(values[0]);
      fixture.account.enabled = false;
      return [{ id: fixture.account.id }];
    }
    if (sql.startsWith("SELECT kind, secret_ref_id")) return [{ kind: fixture.account.kind, secret_ref_id: fixture.account.secret_ref_id }];
    return [];
  }
  return { queryClient: Object.assign(query, { begin: async (callback: (tx: typeof query) => Promise<unknown>) => callback(query) }) };
});

import { AccountAttachmentError, registerVaultedAccount } from "../src/lib/onboarding/provider-credentials";
import type { ProviderOnboarding } from "../src/lib/providers/config-security";
const input = { accountId: "acc-existing", providerId: "cloudflare", label: "Attempted rename", ownerEmail: "owner@example.test", loginEmail: "other@example.test", role: "admin", isProtected: false,
  config: { accountId: "native-account", apiToken: "private-token" } } as ProviderOnboarding & { accountId: string };
const runtime = ["TAILSCALE_API_TOKEN", "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "CLIPROXY_API_KEY", "CLIPROXY_MANAGEMENT_KEY"] as const;

beforeEach(() => {
  fixture.account = { id: "acc-existing", kind: "cloudflare", label: "Original", owner_email: "owner@example.test", login_email: "login@example.test", secret_ref_id: null, is_protected: true, enabled: false };
  fixture.vault.clear(); fixture.removed.length = 0; fixture.sql.length = 0; fixture.mutateAfterWrite = false;
  for (const name of runtime) vi.stubEnv(name, `fixture-${name}`);
});
afterEach(() => vi.unstubAllEnvs());

describe("credential attachment", () => {
  it("binds a new reference to the existing account and queues collection without changing identity", async () => {
    const result = await registerVaultedAccount(input);
    expect(result.id).toBe("acc-existing");
    expect(fixture.account).toMatchObject({ label: "Original", owner_email: "owner@example.test", login_email: "login@example.test", is_protected: true, enabled: false });
    expect(fixture.account.secret_ref_id).toMatch(/^ref-/);
    expect(fixture.sql.some(sql => sql.startsWith("INSERT INTO provider_accounts"))).toBe(false);
    expect(fixture.sql.some(sql => sql.startsWith("UPDATE provider_accounts SET secret_ref_id"))).toBe(true);
    expect(fixture.sql.some(sql => sql.startsWith("INSERT INTO account_collections"))).toBe(true);
    expect(JSON.stringify(fixture.sql)).not.toContain("private-token");
    expect([...fixture.vault.values()]).toEqual([JSON.stringify(input.config)]);
  });

  it("rejects wrong owner, provider, and already bound accounts before creating a vault secret", async () => {
    for (const changed of [{ ownerEmail: "other@example.test" }, { providerId: "neon" }]) {
      await expect(registerVaultedAccount({ ...input, ...changed })).rejects.toBeInstanceOf(AccountAttachmentError);
    }
    fixture.account.secret_ref_id = "ref-existing";
    await expect(registerVaultedAccount(input)).rejects.toBeInstanceOf(AccountAttachmentError);
    expect(fixture.vault.size).toBe(0);
  });

  it("cleans the newly written secret if another attachment wins before the account lock", async () => {
    fixture.mutateAfterWrite = true;
    await expect(registerVaultedAccount(input)).rejects.toBeInstanceOf(AccountAttachmentError);
    expect(fixture.removed).toHaveLength(1);
    expect(fixture.vault.size).toBe(0);
    expect(fixture.sql.some(sql => sql.startsWith("INSERT INTO secret_refs"))).toBe(false);
  });
});
