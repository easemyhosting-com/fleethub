import { builtinVaultUrl, createBuiltinVault, secretRows } from "./builtin";
import { queryClient } from "@/lib/db/client";
import { z } from "zod";
import { openVaultForRef } from "@/lib/onboarding/vault-ref";

/** Keep shared credentials. The row lock also serializes cleanup with new FK dependents. */
export async function removeUnusedSecretRef(refId: string): Promise<void> {
  await queryClient.begin(async tx => {
    const [ref] = await tx`SELECT vault_url, infisical_project, environment, path, keys
      FROM secret_refs WHERE id = ${refId} FOR UPDATE`;
    if (!ref) return;
    // Separate statement after acquiring the lock: a waiting cleanup must see newly committed links.
    const [usage] = await tx`SELECT
      EXISTS (SELECT 1 FROM app_credential_links WHERE secret_ref_id = ${refId}) OR
      EXISTS (SELECT 1 FROM provider_accounts WHERE secret_ref_id = ${refId}) OR
      EXISTS (SELECT 1 FROM connectors WHERE secret_ref_id = ${refId}) AS used`;
    if (usage.used) return;
    const [step] = await tx`SELECT config FROM onboarding_steps WHERE id = 'infisical'`;
    const metadata = z.object({ vault_url: z.string().nullable(), infisical_project: z.string(), environment: z.string(), path: z.string(), keys: z.array(z.string().min(1)).min(1) }).parse(ref);
    const vault = metadata.vault_url === builtinVaultUrl
      ? createBuiltinVault(secretRows(tx))
      : await openVaultForRef(metadata, step?.config);
    for (const name of metadata.keys) await vault.remove(name);
    await tx`DELETE FROM secret_refs WHERE id = ${refId}`;
  });
}
