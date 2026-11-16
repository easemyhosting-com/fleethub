import { queryClient } from "@/lib/db/client";
import { openVaultForRef, type VaultRef } from "@/lib/onboarding/vault-ref";
import { aiConnectionSnapshot, type AiConnectionInput } from "./model";

/** One optional connection. Nothing else in FleetHub reads it, so its absence blocks no feature. */
export async function saveAiConnection(input: AiConnectionInput): Promise<boolean> {
  const rows = await queryClient`INSERT INTO ai_connections (id, endpoint, protocol, model, secret_ref_id, updated_at)
    SELECT 'default', ${input.endpoint}, ${input.protocol}, ${input.model}, ${input.secretRefId}, NOW()
    WHERE ${input.secretRefId}::text IS NULL OR EXISTS (SELECT 1 FROM secret_refs WHERE id = ${input.secretRefId})
    ON CONFLICT (id) DO UPDATE SET endpoint = EXCLUDED.endpoint, protocol = EXCLUDED.protocol, model = EXCLUDED.model,
      secret_ref_id = EXCLUDED.secret_ref_id, updated_at = EXCLUDED.updated_at
    RETURNING id`;
  return rows.length > 0;
}

/** Disconnecting forgets the connection only. The stored key and the upstream credential are untouched. */
export async function deleteAiConnection(): Promise<void> {
  await queryClient`DELETE FROM ai_connections WHERE id = 'default'`;
}

export async function readAiConnection() {
  const [[row], refs] = await Promise.all([
    queryClient`SELECT endpoint, protocol, model, secret_ref_id AS "secretRefId", updated_at AS "updatedAt"
      FROM ai_connections WHERE id = 'default'`,
    queryClient`SELECT id, label FROM secret_refs ORDER BY id LIMIT 1001`,
  ]);
  return aiConnectionSnapshot.parse({
    connection: row ? { ...row, updatedAt: new Date(row.updatedAt).toISOString() } : null,
    secretRefs: refs.slice(0, 1000), limited: refs.length > 1000,
  });
}

/** The key is read only for an operator-requested check and is never returned. */
export async function readAiKey(secretRefId: string): Promise<string> {
  const [ref] = await queryClient`SELECT r.vault_url, r.infisical_project, r.environment, r.path, r.keys, s.config AS current_config
    FROM secret_refs r LEFT JOIN onboarding_steps s ON s.id = 'infisical' WHERE r.id = ${secretRefId}`;
  if (!ref || !Array.isArray(ref.keys) || typeof ref.keys[0] !== "string") throw new Error("credential_unavailable");
  return (await openVaultForRef(ref as unknown as VaultRef, ref.current_config)).read(ref.keys[0]);
}
