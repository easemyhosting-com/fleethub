import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  ready: true,
  revision: [1, 1, 1],
  failDb: false,
  failWrite: false,
  failRead: false,
  badRead: false,
  failCleanup: false,
  writes: [] as Array<{ name: string; value: string }>,
  reads: [] as string[],
  removals: [] as string[],
  sql: [] as Array<{ text: string; values: unknown[] }>,
}));
vi.mock("@/lib/onboarding/service", () => {
  const getSetupState = vi.fn(async () => ({
  ready: fixture.ready,
  steps: [
    { id: "tailscale", revision: fixture.revision[0], config: {} },
    { id: "infisical", status: "verified", revision: fixture.revision[1], config: { apiUrl: "http://infisical:8080", consoleUrl: "http://localhost:8088", projectId: "project_1", environment: "dev", secretPath: "/" } },
    { id: "cliproxy", revision: fixture.revision[2], config: {} },
  ],
}));
  return { getSetupState, refreshStaleVaultSteps: () => getSetupState() };
});
vi.mock("@/lib/onboarding/vault", () => ({ vaultSession: vi.fn(async () => ({
  write: async (name: string, value: string) => {
    if (fixture.failWrite) throw new Error("private vault write error");
    fixture.writes.push({ name, value });
  },
  read: async (name: string) => {
    fixture.reads.push(name);
    if (fixture.failRead) throw new Error("private vault read error");
    return fixture.badRead ? "mismatch" : fixture.writes.find(item => item.name === name)?.value;
  },
  remove: async (name: string) => {
    fixture.removals.push(name);
    if (fixture.failCleanup) throw new Error("private vault cleanup error");
  },
})) }));
vi.mock("@/lib/db/client", () => {
  async function query(strings: TemplateStringsArray, ...values: unknown[]) {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    fixture.sql.push({ text, values });
    if (fixture.failDb && text.startsWith("INSERT")) throw new Error("private database error");
    return text.startsWith("SELECT kind, secret_ref_id") ? [{ kind: "cloudflare", secret_ref_id: "fixture-ref" }] : [];
  }
  return { queryClient: Object.assign(query, { begin: async (callback: (q: typeof query) => Promise<unknown>) => callback(query) }) };
});

import { registerVaultedAccount } from "../src/lib/onboarding/provider-credentials";
import type { ProviderOnboarding } from "../src/lib/providers/config-security";

const input: ProviderOnboarding = {
  providerId: "cloudflare", label: "Primary Cloudflare", ownerEmail: "owner@example.test",
  config: { apiToken: "provider-private-key", accountId: "native-account" },
};
const runtimeNames = ["TAILSCALE_API_TOKEN", "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "CLIPROXY_API_KEY", "CLIPROXY_MANAGEMENT_KEY"] as const;

beforeEach(() => {
  Object.assign(fixture, { ready: true, revision: [1, 1, 1], failDb: false, failWrite: false, failRead: false, badRead: false, failCleanup: false });
  fixture.writes.length = 0; fixture.reads.length = 0; fixture.removals.length = 0; fixture.sql.length = 0;
  for (const name of runtimeNames) vi.stubEnv(name, `fixture-${name}`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("vaulted provider registration", () => {
  it("requires persisted setup readiness before writing credentials", async () => {
    fixture.ready = false;
    await expect(registerVaultedAccount(input)).rejects.toThrow("Verify a secret store");
    expect(fixture.writes).toEqual([]);
  });

  it("writes and reads the vault value before persisting only a scoped reference", async () => {
    const result = await registerVaultedAccount(input);
    expect(result).toMatchObject({ provider: "cloudflare", onboardingStatus: "credentials_vaulted" });
    expect(result.id).toMatch(/^acc-/);
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0].name).toMatch(/^FLEETHUB_ACCOUNT_/);
    expect(JSON.parse(fixture.writes[0].value)).toEqual(input.config);
    expect(fixture.reads).toEqual([fixture.writes[0].name]);
    expect(fixture.removals).toEqual([]);
    expect(fixture.sql.some(item => item.text.includes("INSERT INTO secret_refs"))).toBe(true);
    expect(fixture.sql.some(item => item.text.includes("INSERT INTO provider_accounts"))).toBe(true);
    const persisted = JSON.stringify(fixture.sql);
    expect(persisted).toContain(fixture.writes[0].name);
    expect(persisted).toContain("project_1");
    expect(persisted).not.toContain("provider-private-key");
    expect(persisted).not.toContain("global");
    expect(persisted).not.toContain("_vaultBackend");
    expect(persisted).not.toContain("_infisicalRef");
  });

  it("uses safe defaults and marks Oracle accounts protected", async () => {
    await registerVaultedAccount({ providerId: "oracle", label: "OCI", config: { token: "secret" } });
    const account = fixture.sql.find(item => item.text.includes("INSERT INTO provider_accounts"));
    expect(account?.values).toContain("operator@fleethub.dev");
    expect(account?.values).toContain(true);
    expect(account?.text).toContain("false");
  });

  it("cleans up a written secret if round-trip read fails or mismatches", async () => {
    fixture.failRead = true;
    await expect(registerVaultedAccount(input)).rejects.toThrow("Credential registration failed");
    expect(fixture.removals).toEqual([fixture.writes[0].name]);
    expect(fixture.sql).toEqual([]);
    fixture.failRead = false; fixture.badRead = true;
    await expect(registerVaultedAccount(input)).rejects.toThrow("Credential registration failed");
    expect(fixture.removals).toHaveLength(2);
  });

  it("does not attempt cleanup when initial vault write fails", async () => {
    fixture.failWrite = true;
    await expect(registerVaultedAccount(input)).rejects.toThrow("Credential registration failed");
    expect(fixture.removals).toEqual([]);
    expect(fixture.sql).toEqual([]);
  });

  it("aborts on changed setup revision and removes the orphaned secret", async () => {
    const { getSetupState } = await import("../src/lib/onboarding/service");
    vi.mocked(getSetupState).mockImplementationOnce(async () => ({ ready: true, steps: [
      { id: "tailscale", revision: 1, config: {} },
      { id: "infisical", status: "verified", revision: 1, config: { apiUrl: "http://infisical:8080", consoleUrl: "http://localhost:8088", projectId: "project_1", environment: "dev", secretPath: "/" } },
      { id: "cliproxy", revision: 1, config: {} },
    ] } as never)).mockImplementationOnce(async () => ({ ready: true, steps: [
      { id: "tailscale", revision: 2, config: {} },
      { id: "infisical", status: "verified", revision: 1, config: {} },
      { id: "cliproxy", revision: 1, config: {} },
    ] } as never));
    await expect(registerVaultedAccount(input)).rejects.toThrow("Credential registration failed");
    expect(fixture.removals).toEqual([fixture.writes[0].name]);
    expect(fixture.sql.some(item => item.text.includes("INSERT"))).toBe(false);
  });

  it("cleans up after a database write failure and hides database errors", async () => {
    fixture.failDb = true;
    await expect(registerVaultedAccount(input)).rejects.toThrow("Credential registration failed");
    expect(fixture.removals).toEqual([fixture.writes[0].name]);
    expect(JSON.stringify(fixture.sql)).not.toContain("provider-private-key");
  });

  it("keeps a safe error if vault cleanup fails", async () => {
    fixture.badRead = true; fixture.failCleanup = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(registerVaultedAccount(input)).rejects.toThrow("Credential registration failed");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Vault cleanup failed"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private vault cleanup error");
  });
});
