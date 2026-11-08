import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import type { ProviderOnboarding } from "@/lib/providers/config-security";
import { configSchemas } from "./model";
import { getSetupState, refreshStaleVaultSteps } from "./service";
import { vaultSession } from "./vault";
import { builtinVaultUrl, createBuiltinVault } from "@/lib/vault/builtin";
import { credentialDigest, enqueueInventory } from "@/lib/inventory/service";
import { supportsInventory } from "@/lib/inventory/collectors";

export class AccountAttachmentError extends Error {
  constructor() { super("Account cannot accept credentials; refresh the account list and try again"); }
}

export async function registerVaultedAccount(input: ProviderOnboarding) {
  const state = await refreshStaleVaultSteps();
  if (!state.ready) throw new Error("Verify a secret store (Infisical or the built-in store) in setup first");
  // Infisical is preferred when both are verified; otherwise the built-in encrypted store holds the credential.
  const infisical = state.steps.find(step => step.id === "infisical");
  const useInfisical = infisical?.status === "verified";
  const scope = useInfisical
    ? configSchemas.infisical.parse(infisical?.config)
    : { apiUrl: builtinVaultUrl, projectId: "builtin", environment: "builtin", secretPath: "/" };
  const attachId = input.accountId;
  const existing = attachId ? (await queryClient`
    SELECT id, kind, label, owner_email, secret_ref_id
    FROM provider_accounts WHERE id = ${attachId}
  `)[0] : null;
  if (attachId && (!existing || existing.kind !== input.providerId ||
      existing.secret_ref_id !== null || existing.owner_email !== input.ownerEmail)) {
    throw new AccountAttachmentError();
  }
  const vault = useInfisical ? await vaultSession(scope as Parameters<typeof vaultSession>[0]) : createBuiltinVault();
  const id = attachId ?? `acc-${randomUUID()}`;
  const refId = `ref-${randomUUID()}`;
  const secretName = `FLEETHUB_ACCOUNT_${randomUUID().replaceAll("-", "")}`;
  const serialized = JSON.stringify(input.config ?? {});
  let created = false;
  try {
    await vault.write(secretName, serialized);
    created = true;
    if (await vault.read(secretName) !== serialized) throw new Error("Credential persistence could not be verified");
    await queryClient.begin(async transaction => {
      // Serializes with setup saves, so a changed prerequisite cannot authorize this write.
      await transaction`SELECT pg_advisory_xact_lock(76411213)`;
      const current = await getSetupState(async () => await transaction`SELECT id, config, revision, status, verified_at AS "verifiedAt", fingerprint FROM onboarding_steps`);
      if (!current.ready || current.steps.some((step, index) => step.revision !== state.steps[index].revision)) throw new Error("Setup changed during provider registration");
      if (existing) {
        const locked = (await transaction`
          SELECT id, kind, label, owner_email, secret_ref_id
          FROM provider_accounts WHERE id = ${id} FOR UPDATE
        `)[0];
        if (!locked || locked.kind !== existing.kind || locked.label !== existing.label ||
            locked.owner_email !== existing.owner_email || locked.secret_ref_id !== null) throw new AccountAttachmentError();
      }
      await transaction`INSERT INTO secret_refs (id, label, vault_url, infisical_project, environment, path, keys, status, last_verified_at)
        VALUES (${refId}, ${`${input.providerId} account credentials`}, ${scope.apiUrl}, ${scope.projectId}, ${scope.environment}, ${scope.secretPath}, ${JSON.stringify([secretName])}, 'verified', NOW())`;
      if (existing) {
        const attached = await transaction`
          UPDATE provider_accounts SET secret_ref_id = ${refId},
            meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{onboardingStatus}', '"credentials_vaulted"'::jsonb, true),
            identity_id = COALESCE(${input.identityId ?? null}, identity_id),
            health = 'unknown', enabled = false,
            is_protected = is_protected OR kind = 'oracle' OR ${input.isProtected === true},
            updated_at = NOW()
          WHERE id = ${id} AND secret_ref_id IS NULL
          RETURNING id
        `;
        if (attached.length !== 1) throw new AccountAttachmentError();
      } else {
        await transaction`INSERT INTO provider_accounts (id, kind, label, identity_id, contact_id, owner_email, login_email, role, is_protected, secret_ref_id, health, meta, enabled)
          VALUES (${id}, ${input.providerId}, ${input.label}, ${input.identityId ?? null}, (SELECT c.id FROM identity_contacts c WHERE c.kind = 'email' AND LOWER(TRIM(c.value)) = LOWER(TRIM(${input.ownerEmail ?? "operator@fleethub.dev"})) ORDER BY c.is_primary DESC, c.created_at LIMIT 1), ${input.ownerEmail ?? "operator@fleethub.dev"}, ${input.loginEmail ?? input.ownerEmail ?? "operator@fleethub.dev"}, ${input.role ?? "general"}, ${input.providerId === "oracle" || input.isProtected === true}, ${refId}, 'unknown', ${JSON.stringify({ onboardingStatus: "credentials_vaulted" })}, false)`;
      }
      if (supportsInventory(input.providerId)) await enqueueInventory(id, transaction, credentialDigest(input.config ?? {}));
    });
    return { id, provider: input.providerId, onboardingStatus: "credentials_vaulted" };
  } catch (error) {
    if (created) {
      try { await vault.remove(secretName); } catch { console.error("[Onboarding] Vault cleanup failed; inspect unused FLEETHUB_ACCOUNT references"); }
    }
    if (error instanceof AccountAttachmentError) throw error;
    throw new Error("Credential registration failed; check setup, vault scope, and database availability");
  }
}
