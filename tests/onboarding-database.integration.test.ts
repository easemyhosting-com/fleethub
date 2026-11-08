import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { getSetupState, saveSetupStep, skipSetupStep, verifySetupStep } from "../src/lib/onboarding/service";
import { registerVaultedAccount } from "../src/lib/onboarding/provider-credentials";

// Explicitly opt in and use only a disposable local database.
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("onboarding with PostgreSQL and local service simulators", () => {
  let server: Server;
  let directory: string;
  let origin: string;
  const secrets = new Map<string, string>();
  const realFetch = global.fetch;
  const credential = "fixture-provider-secret-not-for-postgres";
  const accountIds: string[] = [];
  const registerAccount = async (input: Parameters<typeof registerVaultedAccount>[0]) => {
    const account = await registerVaultedAccount(input);
    accountIds.push(account.id);
    return account;
  };

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL ?? "");
    if (db.hostname !== "127.0.0.1" || db.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_AUTH_SECRET", "disposable-onboarding-integration-secret-min32");
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`TRUNCATE onboarding_steps`;
    directory = await mkdtemp(join(tmpdir(), "fleethub-tailscale-fixture-"));
    const statusFile = join(directory, "status.json");
    await writeFile(statusFile, JSON.stringify({ BackendState: "Running", Self: { ID: "fixture-node", TailscaleIPs: ["100.99.99.99"] } }));
    vi.stubEnv("TAILSCALE_STATUS_FILE", statusFile);
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      let body = "";
      for await (const chunk of req) body += chunk;
      res.setHeader("Content-Type", "application/json");
      if (url.pathname.endsWith("/universal-auth/login")) { res.end(JSON.stringify({ accessToken: "fixture-vault-token" })); return; }
      if (url.pathname.startsWith("/api/v4/secrets/")) {
        const name = url.pathname.split("/").at(-1) ?? "";
        if (req.method === "POST") { secrets.set(name, JSON.parse(body).secretValue); res.end("{}"); return; }
        if (req.method === "DELETE") { secrets.delete(name); res.end("{}"); return; }
        res.end(JSON.stringify({ secret: { secretValue: secrets.get(name) } })); return;
      }
      if (url.pathname === "/v1/models" && req.headers.authorization === "Bearer fixture-inference") { res.end(JSON.stringify({ data: [{ id: "fixture-model" }] })); return; }
      if (url.pathname === "/v8/management/credentials" && req.headers.authorization === "Bearer fixture-management") { res.end(JSON.stringify({ files: [] })); return; }
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture listener failed");
    origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", origin);
    vi.stubEnv("TAILSCALE_API_TOKEN", "fixture-tailscale");
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "fixture-client");
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "fixture-client-secret");
    vi.stubEnv("CLIPROXY_API_KEY", "fixture-inference");
    vi.stubEnv("CLIPROXY_MANAGEMENT_KEY", "fixture-management");
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.tailscale.com/")) return Promise.resolve(Response.json({ devices: [{ id: "fixture-device", nodeId: "fixture-node", authorized: true, addresses: ["100.99.99.99"], lastSeen: new Date().toISOString() }] }));
      return realFetch(input, init);
    });
  });
  afterAll(async () => {
    try {
      if (accountIds.length) await queryClient.begin(async tx => {
        const refs = await tx`SELECT s.id, s.keys, s.vault_url FROM secret_refs s JOIN provider_accounts a ON a.secret_ref_id = s.id WHERE a.id IN ${tx(accountIds)}`;
        await tx`DELETE FROM provider_accounts WHERE id IN ${tx(accountIds)}`;
        for (const ref of refs) {
          await tx`DELETE FROM secret_refs WHERE id = ${ref.id}`;
          if (ref.vault_url === "builtin:fleethub") {
            for (const name of ref.keys) await tx`DELETE FROM secret_store WHERE name = ${name}`;
          }
        }
      });
    } finally {
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
      if (server) await new Promise<void>(resolve => server.close(() => resolve()));
      if (directory) await rm(directory, { recursive: true, force: true });
      await queryClient.end();
    }
  });

  it("persists readiness and vault references while provider credentials stay outside PostgreSQL", async () => {
    expect((await getSetupState()).ready).toBe(false);
    await saveSetupStep("tailscale", { tailnet: "fixture.ts.net", deviceId: "fixture-device" });
    await verifySetupStep("tailscale");
    await saveSetupStep("infisical", { apiUrl: origin, consoleUrl: origin, projectId: "fixture-project", environment: "dev", secretPath: "/providers" });
    await verifySetupStep("infisical");
    expect(secrets.size).toBe(0); // Probe was removed after successful readback.
    await saveSetupStep("cliproxy", { apiUrl: origin, consoleUrl: `${origin}/management.html` });
    expect((await verifySetupStep("cliproxy")).ready).toBe(true);
    const account = await registerAccount({ providerId: "cloudflare", label: "Fixture account", ownerEmail: "fixture@example.test", config: { apiToken: credential } });
    expect(account.onboardingStatus).toBe("credentials_vaulted");
    expect([...secrets.values()]).toEqual([JSON.stringify({ apiToken: credential })]);
    const rows = await queryClient`SELECT a.meta, a.health, a.enabled, s.vault_url, s.path, s.keys FROM provider_accounts a JOIN secret_refs s ON s.id = a.secret_ref_id WHERE a.id = ${account.id}`;
    expect(rows[0]).toMatchObject({ health: "unknown", enabled: false, vault_url: origin, path: "/providers" });
    expect(JSON.stringify(rows)).not.toContain(credential);
    const resumed = await getSetupState();
    expect(resumed.ready).toBe(true);
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => registerAccount({ providerId: "cloudflare", label: `Concurrent ${index}`, config: { apiToken: credential } })));
    expect(new Set(concurrent.map(account => account.id)).size).toBe(12);
    await saveSetupStep("tailscale", { tailnet: "changed.ts.net", deviceId: "fixture-device" });
    expect((await getSetupState()).steps.map(step => step.status)).toEqual(["configured", "verified", "verified", "unconfigured"]);
    expect((await getSetupState()).ready).toBe(true);
    await saveSetupStep("infisical", { apiUrl: origin, consoleUrl: origin, projectId: "fixture-project", environment: "dev", secretPath: "/changed" });
    expect((await getSetupState()).ready).toBe(false);
    await expect(registerVaultedAccount({ providerId: "cloudflare", label: "Blocked", config: { apiToken: credential } })).rejects.toThrow("Verify a secret store");
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "integration-master-key-at-least-32-chars");
    await saveSetupStep("builtin", {});
    expect((await verifySetupStep("builtin")).ready).toBe(true);
    const local = await registerAccount({ providerId: "cloudflare", label: "Built-in", config: { apiToken: credential, accountId: "a1" } });
    const stored = (await queryClient`SELECT s.vault_url, s.keys FROM provider_accounts a JOIN secret_refs s ON s.id = a.secret_ref_id WHERE a.id = ${local.id}`)[0];
    expect(stored.vault_url).toBe("builtin:fleethub");
    const row = (await queryClient`SELECT ciphertext FROM secret_store WHERE name = ${stored.keys[0]}`)[0];
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain(credential);
    expect(secrets.size).toBe(13); // Infisical simulator received nothing for the built-in account.
  });

  it("retains connection settings and verification when an optional integration is skipped", async () => {
    const before = (await getSetupState()).steps.find(step => step.id === "cliproxy");
    await skipSetupStep("cliproxy");
    const after = (await getSetupState()).steps.find(step => step.id === "cliproxy");
    expect(after).toMatchObject({ skipped: true, config: before?.config, status: before?.status, verifiedAt: before?.verifiedAt });
    await verifySetupStep("cliproxy");
    expect((await getSetupState()).steps.find(step => step.id === "cliproxy")?.skipped).toBe(false);
    await queryClient`DELETE FROM onboarding_steps WHERE id = 'tailscale'`;
    await skipSetupStep("tailscale");
    expect((await getSetupState()).steps[0]).toMatchObject({ skipped: true, status: "unconfigured", config: {} });
  });
});
