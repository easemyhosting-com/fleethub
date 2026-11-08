import { approvedApiUrl } from "./transport";
import { configSchemas, SetupError, type VaultConfig } from "./model";
import { vaultSession } from "./vault";
import { builtinVaultUrl, createBuiltinVault, type Vault } from "@/lib/vault/builtin";

export type { Vault };
export type VaultRef = { vault_url: string | null; infisical_project: string; environment: string; path: string };

/**
 * The scope to read an Infisical reference from: the configured vault, at the folder the reference was written to.
 * Origin, project and environment must still match the verified setup, because the machine identity's client secret is
 * only ever sent to that origin. The folder may differ, so changing where new credentials go never strands older ones.
 */
export function refScope(ref: VaultRef, infisicalConfig: unknown): VaultConfig {
  const scope = configSchemas.infisical.parse(infisicalConfig);
  approvedApiUrl(scope.apiUrl);
  if (scope.apiUrl !== ref.vault_url || scope.projectId !== ref.infisical_project || scope.environment !== ref.environment) throw new SetupError("Vault reference does not match the verified setup");
  const parsed = configSchemas.infisical.safeParse({ ...scope, secretPath: ref.path });
  if (!parsed.success) throw new SetupError("Vault reference does not match the verified setup");
  return parsed.data;
}

/** Opens whichever backend a stored credential reference points at, refusing references outside the verified vault. */
export async function openVaultForRef(ref: VaultRef, infisicalConfig: unknown): Promise<Vault> {
  if (ref.vault_url === builtinVaultUrl) return createBuiltinVault();
  return vaultSession(refScope(ref, infisicalConfig));
}
