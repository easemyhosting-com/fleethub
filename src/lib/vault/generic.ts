import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";
import { configSchemas } from "@/lib/onboarding/model";
import { getSetupState, refreshStaleVaultSteps } from "@/lib/onboarding/service";
import { vaultSession } from "@/lib/onboarding/vault";
import { builtinVaultUrl, createBuiltinVault } from "./builtin";
import { removeUnusedSecretRef, type CleanupOutcome } from "./cleanup";

export const genericCredentialInput = z.strictObject({
  label: z.string().trim().min(1).max(120),
  // Opaque value: API keys, tokens or a small JSON blob. Never logged, returned or stored outside the vault.
  value: z.string().min(1).max(8192),
});
export type GenericCredentialInput = z.infer<typeof genericCredentialInput>;

export class VaultNotReadyError extends Error {
  constructor() { super("Verify a secret store (Infisical or the built-in store) in setup first"); }
}

/**
 * Stores one key in the verified secret store and returns only its reference ID. Purpose, scopes, environment,
 * expiry and validity are recorded separately as ledger metadata, so they can change without touching the secret.
 */
export async function storeGenericCredential(input: GenericCredentialInput): Promise<string> {
  const state = await refreshStaleVaultSteps();
  if (!state.ready) throw new VaultNotReadyError();
  // Same choice as provider credentials: Infisical when verified, otherwise the built-in encrypted store.
  const infisical = state.steps.find(step => step.id === "infisical");
  const useInfisical = infisical?.status === "verified";
  const scope = useInfisical
    ? configSchemas.infisical.parse(infisical?.config)
    : { apiUrl: builtinVaultUrl, projectId: "builtin", environment: "builtin", secretPath: "/" };
  const vault = useInfisical ? await vaultSession(scope as Parameters<typeof vaultSession>[0]) : createBuiltinVault();
  const refId = `ref-${randomUUID()}`;
  const secretName = `FLEETHUB_GENERIC_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  try {
    await vault.write(secretName, input.value);
    created = true;
    if (await vault.read(secretName) !== input.value) throw new Error("Credential persistence could not be verified");
    await queryClient.begin(async transaction => {
      // Serializes with setup saves, so a changed prerequisite cannot authorize this write.
      await transaction`SELECT pg_advisory_xact_lock(76411213)`;
      const current = await getSetupState(async () => await transaction`SELECT id, config, revision, status, verified_at AS "verifiedAt", fingerprint FROM onboarding_steps`);
      if (!current.ready || current.steps.find(step => step.id === (useInfisical ? "infisical" : "builtin"))?.status !== "verified" || current.steps.some((step, index) => step.revision !== state.steps[index].revision)) throw new Error("Setup changed while storing the credential");
      await transaction`INSERT INTO secret_refs (id, label, vault_url, infisical_project, environment, path, keys, status, last_verified_at, generic_owned)
        VALUES (${refId}, ${input.label}, ${scope.apiUrl}, ${scope.projectId}, ${scope.environment}, ${scope.secretPath}, ${JSON.stringify([secretName])}, 'verified', NOW(), TRUE)`;
    });
    return refId;
  } catch {
    if (created) {
      try { await vault.remove(secretName); } catch { console.error("[Vault] Cleanup of an unsaved generic credential failed; inspect unused FLEETHUB_GENERIC entries"); }
    }
    throw new Error("Credential could not be stored; check setup, vault scope and database availability");
  }
}

const genericKey = /^FLEETHUB_GENERIC_[0-9a-f]{32}$/;

/**
 * Deletes FleetHub's stored copy only when nothing uses it. This is not revocation: the key stays valid at its
 * issuer until the operator revokes it there. Only references created here qualify; imported or provider
 * references can point at secrets FleetHub does not own.
 */
export async function removeGenericCredential(refId: string): Promise<CleanupOutcome | "not_generic"> {
  // Reference keys are never updated after insert, so checking them before the locked cleanup is stable.
  const [ref] = await queryClient`SELECT keys, generic_owned FROM secret_refs WHERE id = ${refId}`;
  if (!ref) return "missing";
  const keys = z.array(z.string()).safeParse(ref.keys);
  if (ref.generic_owned !== true || !keys.success || keys.data.length !== 1 || !genericKey.test(keys.data[0])) return "not_generic";
  return removeUnusedSecretRef(refId);
}
