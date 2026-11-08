import { SetupError } from "./model";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { writeScope, type VaultConfig } from "./model";
import { approvedApiUrl, requestJson } from "./transport";
import type { Vault } from "@/lib/vault/builtin";

export type { Vault };

export async function vaultSession(config: VaultConfig) {
  const base = approvedApiUrl(config.apiUrl);
  const clientId = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new SetupError("Configure INFISICAL_UNIVERSAL_AUTH_CLIENT_ID and INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET on the server");
  const token = z.object({ accessToken: z.string().min(1) }).parse(await requestJson(`${base}/api/v1/auth/universal-auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }),
  }));
  const headers = { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" };
  const scope = { projectId: config.projectId, environment: config.environment, secretPath: config.secretPath, type: "shared" };
  return {
    async write(name: string, value: string) {
      await requestJson(`${base}/api/v4/secrets/${encodeURIComponent(name)}`, { method: "POST", headers, body: JSON.stringify({ ...scope, secretValue: value }) });
    },
    async read(name: string): Promise<string> {
      const query = new URLSearchParams(scope);
      query.set("expandSecretReferences", "false");
      const result = z.object({ secret: z.object({ secretValue: z.string() }) }).parse(await requestJson(`${base}/api/v4/secrets/${encodeURIComponent(name)}?${query}`, { headers }));
      return result.secret.secretValue;
    },
    async remove(name: string) {
      await requestJson(`${base}/api/v4/secrets/${encodeURIComponent(name)}`, { method: "DELETE", headers, body: JSON.stringify(scope) });
    },
  };
}

/** Round-trips a temporary secret through every folder FleetHub will write to. */
export async function verifyVault(config: VaultConfig): Promise<void> {
  await verifyFolder(config);
  const connectors = writeScope(config, "connector");
  if (connectors.secretPath !== config.secretPath) await verifyFolder(connectors);
}

async function verifyFolder(config: VaultConfig): Promise<void> {
  const vault = await vaultSession(config);
  const name = `FLEETHUB_PROBE_${randomUUID().replaceAll("-", "")}`;
  const value = randomBytes(32).toString("hex");
  await vault.write(name, value);
  try {
    if (await vault.read(name) !== value) throw new SetupError("Vault round-trip did not match");
  } catch (error) {
    // Keep the original failure; a cleanup error must not replace it.
    await vault.remove(name).catch(() => console.error("[Setup] Could not remove a vault verification probe; delete FLEETHUB_PROBE_* secrets in the vault"));
    throw error;
  }
  try { await vault.remove(name); }
  catch { throw new SetupError("The vault accepted a write but refused to delete it; grant delete permission on the secret path"); }
}
