import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { queryClient } from "@/lib/db/client";
import { SetupError } from "@/lib/onboarding/model";

/** Reference marker stored in secret_refs.vault_url for secrets kept in FleetHub's own encrypted table. */
export const builtinVaultUrl = "builtin:fleethub";

export type Vault = {
  write(name: string, value: string): Promise<void>;
  read(name: string): Promise<string>;
  remove(name: string): Promise<void>;
};

export interface SecretRows {
  get(name: string): Promise<{ nonce: Buffer; ciphertext: Buffer } | undefined>;
  put(name: string, nonce: Buffer, ciphertext: Buffer): Promise<void>;
  del(name: string): Promise<void>;
  /** Names of stored secrets other than verification probes, in name order, after the given name. */
  names?(limit: number, after?: string): Promise<string[]>;
}

export function secretRows(sql: Sql | TransactionSql): SecretRows {
  return {
    async get(name) {
      const row = (await sql`SELECT nonce, ciphertext FROM secret_store WHERE name = ${name}`)[0];
      return row ? { nonce: Buffer.from(row.nonce), ciphertext: Buffer.from(row.ciphertext) } : undefined;
    },
    async put(name, nonce, ciphertext) {
      await sql`INSERT INTO secret_store (name, nonce, ciphertext) VALUES (${name}, ${nonce}, ${ciphertext})
        ON CONFLICT (name) DO UPDATE SET nonce = EXCLUDED.nonce, ciphertext = EXCLUDED.ciphertext`;
    },
    async del(name) { await sql`DELETE FROM secret_store WHERE name = ${name}`; },
    async names(limit, after) {
      return (await sql`SELECT name FROM secret_store WHERE name NOT LIKE 'FLEETHUB\\_PROBE\\_%' AND name > ${after ?? ""} ORDER BY name LIMIT ${limit}`).map(row => String(row.name));
    },
  };
}

export const databaseSecretRows = secretRows(queryClient);

/** The master key comes only from the environment and is never stored in the database, so a database leak alone reveals nothing. */
export function builtinKey(env: Record<string, string | undefined> = process.env): Buffer {
  const secret = env.FLEETHUB_SECRET_STORE_KEY;
  if (!secret || Buffer.byteLength(secret) < 32) throw new SetupError("Set FLEETHUB_SECRET_STORE_KEY (at least 32 characters) to use the built-in secret store");
  return Buffer.from(hkdfSync("sha256", secret, "fleethub-secret-store-v1", "aes-256-gcm", 32));
}

export function createBuiltinVault(rows: SecretRows = databaseSecretRows, env: Record<string, string | undefined> = process.env): Vault {
  return {
    async write(name, value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", builtinKey(env), nonce);
      cipher.setAAD(Buffer.from(name));
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
      await rows.put(name, nonce, encrypted);
    },
    async read(name) {
      const row = await rows.get(name);
      if (!row || row.ciphertext.length < 16) throw new Error("Secret not found");
      const decipher = createDecipheriv("aes-256-gcm", builtinKey(env), row.nonce);
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(row.ciphertext.subarray(row.ciphertext.length - 16));
      return Buffer.concat([decipher.update(row.ciphertext.subarray(0, row.ciphertext.length - 16)), decipher.final()]).toString("utf8");
    },
    async remove(name) { await rows.del(name); },
  };
}

/** Counts stored secrets the current key cannot decrypt, which means FLEETHUB_SECRET_STORE_KEY changed after they were written. */
export async function countUnreadableSecrets(rows: SecretRows = databaseSecretRows, env: Record<string, string | undefined> = process.env, pageSize = 500): Promise<number> {
  if (!rows.names) return 0;
  const vault = createBuiltinVault(rows, env);
  let unreadable = 0;
  let after: string | undefined;
  for (;;) {
    const page = await rows.names(pageSize, after);
    for (const name of page) {
      try { await vault.read(name); } catch { unreadable++; }
    }
    if (page.length < pageSize) return unreadable;
    after = page[page.length - 1];
  }
}
