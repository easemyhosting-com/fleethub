import type { Sql } from "postgres";
import { builtinKey, createBuiltinVault, secretRows } from "./builtin";

export class MasterKeyRotationError extends Error {
  constructor(readonly code: "maintenance_required" | "invalid_key" | "unchanged_key" | "empty_store" | "unreadable_store" | "interrupted" | "rotation_failed") {
    super(`Master-key rotation failed: ${code}`);
  }
}

/** Offline only. Stop all readers/writers first and retain both keys until restart verification. */
export async function rotateBuiltinMasterKey(sql: Sql, input: {
  oldKey: string; newKey: string; maintenanceConfirmed: true; signal?: AbortSignal;
}): Promise<{ rotatedCount: number }> {
  if (input.maintenanceConfirmed !== true) throw new MasterKeyRotationError("maintenance_required");
  const oldEnv = { FLEETHUB_SECRET_STORE_KEY: input.oldKey }, newEnv = { FLEETHUB_SECRET_STORE_KEY: input.newKey };
  let same: boolean;
  try {
    const oldDerived = builtinKey(oldEnv), newDerived = builtinKey(newEnv);
    try { same = oldDerived.equals(newDerived); }
    finally { oldDerived.fill(0); newDerived.fill(0); }
  } catch { throw new MasterKeyRotationError("invalid_key"); }
  if (same) throw new MasterKeyRotationError("unchanged_key");
  const checkInterrupted = () => { if (input.signal?.aborted) throw new MasterKeyRotationError("interrupted"); };
  checkInterrupted();
  try {
    return await sql.begin(async transaction => {
      await transaction`SET LOCAL lock_timeout = '5s'`;
      await transaction`SET LOCAL statement_timeout = '60s'`;
      await transaction`LOCK TABLE secret_store IN ACCESS EXCLUSIVE MODE`;
      const rows = secretRows(transaction), oldVault = createBuiltinVault(rows, oldEnv), newVault = createBuiltinVault(rows, newEnv);
      // Keyset pages include probes and empty names. Nothing encrypted is omitted.
      async function visit(action: (name: string) => Promise<void>): Promise<number> {
        let after: string | null = null, count = 0;
        for (;;) {
          checkInterrupted();
          const page: Array<{ name: string }> = await transaction`SELECT name FROM secret_store WHERE (${after}::text IS NULL OR name > ${after}) ORDER BY name LIMIT 100`;
          for (const row of page) { checkInterrupted(); await action(String(row.name)); count++; }
          if (page.length < 100) return count;
          after = String(page[page.length - 1].name);
        }
      }
      // Validate the entire old store before the first UPDATE, without retaining a plaintext batch.
      const count = await visit(async name => {
        try { await oldVault.read(name); } catch { throw new MasterKeyRotationError("unreadable_store"); }
      });
      if (count === 0) throw new MasterKeyRotationError("empty_store");
      const rotatedCount = await visit(async name => {
        const plaintext = await oldVault.read(name);
        await newVault.write(name, plaintext);
        if ((await newVault.read(name)) !== plaintext) throw new MasterKeyRotationError("rotation_failed");
      });
      checkInterrupted();
      return { rotatedCount };
    });
  } catch (error) {
    if (error instanceof MasterKeyRotationError) throw error;
    // Never expose driver statements, row names, ciphertext, keys or plaintext through this API.
    throw new MasterKeyRotationError("rotation_failed");
  }
}
