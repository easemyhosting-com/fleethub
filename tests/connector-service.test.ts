import { beforeEach, describe, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ calls: [] as unknown[][], state: vi.fn(), infisicalWrite: vi.fn(), builtinWrite: vi.fn(), session: vi.fn(), read: new Map<string, string>() }));
vi.mock("@/lib/db/client", () => ({ queryClient: (strings: TemplateStringsArray, ...values: unknown[]) => { fx.calls.push([strings.join("?"), ...values]); return Promise.resolve(strings.join("").includes("SELECT r.id, r.name") ? [{ id: "known", name: "borealis" }, { id: "sita", name: "atlas" }] : []); } }));
vi.mock("@/lib/onboarding/service", () => ({ refreshStaleVaultSteps: fx.state }));
vi.mock("@/lib/onboarding/vault", () => ({ vaultSession: fx.session }));
vi.mock("@/lib/vault/builtin", () => ({ builtinVaultUrl: "builtin:fleethub", createBuiltinVault: () => ({ write: async (n: string, v: string) => { fx.builtinWrite(n); fx.read.set(n, v); }, read: async (n: string) => fx.read.get(n) ?? "", remove: async () => undefined }) }));
import { createConnector, SecretStoreNotReady } from "../src/lib/connectors/service";
import { connectorConfig } from "../src/lib/connectors/clients";

const config = connectorConfig.parse({ kind: "kubernetes", label: "borealis", hostName: "borealis", url: "https://10.0.0.1:6443" });
const SECRET = "super-secret-token-value";
beforeEach(() => {
  fx.calls.length = 0; fx.read.clear(); fx.builtinWrite.mockReset(); fx.infisicalWrite.mockReset(); fx.state.mockReset(); fx.session.mockReset();
  fx.session.mockResolvedValue({ write: async (n: string, v: string) => { fx.infisicalWrite(n); fx.read.set(n, v); }, read: async (n: string) => fx.read.get(n) ?? "", remove: async () => undefined });
});

describe("connector credential storage", () => {
  it("uses Infisical when its setup step is verified, like provider accounts, and records only a reference", async () => {
    fx.state.mockResolvedValue({ ready: true, steps: [{ id: "infisical", status: "verified", config: { apiUrl: "http://localhost:8088", consoleUrl: "http://localhost:8088", projectId: "p1", environment: "prod", secretPath: "/fleethub" } }] });
    const result = await createConnector(config, SECRET, "me");
    expect(result.store).toBe("infisical");
    expect(fx.infisicalWrite).toHaveBeenCalledOnce(); expect(fx.builtinWrite).not.toHaveBeenCalled();
    expect(JSON.stringify(fx.calls)).not.toContain(SECRET);
    expect(fx.calls.some(call => String(call[0]).includes("INSERT INTO secret_refs") && call.includes("p1") && call.includes("/fleethub"))).toBe(true);
  });
  it("writes connector credentials to the configured connector folder and records that folder", async () => {
    fx.state.mockResolvedValue({ ready: true, steps: [{ id: "infisical", status: "verified", config: { apiUrl: "http://localhost:8088", consoleUrl: "http://localhost:8088", projectId: "p1", environment: "prod", secretPath: "/accounts", connectorSecretPath: "/connectors" } }] });
    await createConnector(config, SECRET, "me");
    expect(fx.session).toHaveBeenLastCalledWith(expect.objectContaining({ secretPath: "/connectors" }));
    expect(fx.calls.some(call => String(call[0]).includes("INSERT INTO secret_refs") && call.includes("/connectors") && !call.includes("/accounts"))).toBe(true);
  });
  it("falls back to the built-in encrypted store and never writes the value to the database", async () => {
    fx.state.mockResolvedValue({ ready: true, steps: [{ id: "infisical", status: "unconfigured" }] });
    const result = await createConnector(config, SECRET, "me");
    expect(result.store).toBe("builtin"); expect(fx.builtinWrite).toHaveBeenCalledOnce();
    expect(JSON.stringify(fx.calls)).not.toContain(SECRET);
  });
  it("refuses to store a credential when no secret store is verified, and needs none for credential-free connectors", async () => {
    fx.state.mockResolvedValue({ ready: false, steps: [] });
    await expect(createConnector(config, SECRET, "me")).rejects.toBeInstanceOf(SecretStoreNotReady);
    expect(fx.calls.filter(call => !String(call[0]).includes("SELECT r.id, r.name"))).toHaveLength(0);
    const docker = connectorConfig.parse({ kind: "docker", label: "d", hostName: "atlas", url: "https://10.0.0.2:2376" });
    expect((await createConnector(docker, undefined, "me")).store).toBe("none");
  });
});
