import { createHash, randomUUID } from "node:crypto";
import { accountScope } from "@/lib/fleet/accounts";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";
import { openVaultForRef, refScope, type VaultRef } from "@/lib/onboarding/vault-ref";
import { builtinVaultUrl } from "@/lib/vault/builtin";
import { completeInventorySchema, collectionError, CollectionError } from "./model";
import { collectInventory, supportsInventory, validateInventoryConfig } from "./collectors";

const DEADLINE_MS = 60 * 1000;

export function credentialDigest(config: unknown) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === "object" ? Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    ) : value;
  return createHash("sha256").update(JSON.stringify(canonical(config))).digest("hex");
}

export function resourceId(provider: string, accountId: string, scope: string, nativeId: string) {
  return "inv-" + createHash("sha256").update(JSON.stringify([provider, accountId, scope, nativeId])).digest("hex");
}

function publicSourceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new CollectionError("invalid_response");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function enqueueInventory(accountId: string, tx: Sql | TransactionSql = queryClient, credentialHash?: string) {
  const rows = await tx`SELECT kind, secret_ref_id FROM provider_accounts WHERE id = ${accountId}`;
  const account = rows[0];
  if (!account) throw new Error("Account not found");
  if (!supportsInventory(account.kind)) throw new CollectionError("unsupported");
  if (!account.secret_ref_id) throw new CollectionError("credentials_unavailable");
  await tx`
    INSERT INTO account_collections(account_id, state, next_attempt_at, credential_hash)
    VALUES (${accountId}, 'queued', NOW(), ${credentialHash ?? null})
    ON CONFLICT(account_id) DO UPDATE SET
      state = 'queued', attempts = 0, next_attempt_at = NOW(),
      lease_token = NULL, lease_until = NULL, error_code = NULL
    WHERE account_collections.state <> 'running' OR account_collections.lease_until <= NOW()
  `;
}

const claimedSchema = z.object({
  account_id: z.string(), lease_token: z.string().uuid(), kind: z.string(), secret_ref_id: z.string(),
  credential_hash: z.string().nullable(),
});
type Claimed = z.infer<typeof claimedSchema>;

async function claim(): Promise<Claimed | null> {
  return queryClient.begin(async tx => {
    const rows = await tx`
      SELECT c.account_id, c.credential_hash, c.state, c.attempts, a.kind, a.secret_ref_id
      FROM account_collections c JOIN provider_accounts a ON a.id = c.account_id
      WHERE a.archived_at IS NULL AND ((c.state IN ('queued', 'ready') AND c.next_attempt_at <= NOW())
         OR (c.state = 'running' AND c.lease_until < NOW()))
      ORDER BY c.next_attempt_at NULLS FIRST, c.account_id
      LIMIT 1 FOR UPDATE OF c SKIP LOCKED
    `;
    if (!rows[0]) return null;
    if (rows[0].state === "running" && rows[0].attempts + 1 >= 3) {
      await tx`
        UPDATE account_collections SET state = 'error', attempts = attempts + 1,
          lease_token = NULL, lease_until = NULL, next_attempt_at = NULL, error_code = 'lease_lost'
        WHERE account_id = ${rows[0].account_id}
      `;
      await tx`UPDATE provider_accounts SET health = 'degraded', updated_at = NOW() WHERE id = ${rows[0].account_id}`;
      return null;
    }
    const token = randomUUID();
    await tx`
      UPDATE account_collections SET state = 'running', lease_token = ${token},
        lease_until = NOW() + INTERVAL '120 seconds', last_attempt_at = NOW(),
        attempts = attempts + CASE WHEN state = 'running' THEN 1 ELSE 0 END
      WHERE account_id = ${rows[0].account_id}
    `;
    return claimedSchema.parse({ ...rows[0], lease_token: token });
  });
}

async function loadCredential(job: Claimed) {
  const rows = await queryClient`
    SELECT a.kind, a.secret_ref_id, r.vault_url, r.infisical_project, r.environment, r.path, r.keys,
      s.config AS current_config
    FROM provider_accounts a JOIN secret_refs r ON r.id = a.secret_ref_id
      LEFT JOIN onboarding_steps s ON s.id = 'infisical'
    WHERE a.id = ${job.account_id} AND a.secret_ref_id = ${job.secret_ref_id}
  `;
  const row = rows[0];
  if (!row || row.kind !== job.kind || !Array.isArray(row.keys) || row.keys.length !== 1 || typeof row.keys[0] !== "string") {
    throw new CollectionError("credentials_unavailable");
  }
  let vault;
  try { vault = await openVaultForRef(row as VaultRef, row.current_config); }
  catch { throw new CollectionError("credentials_unavailable"); }
  let config: unknown;
  try { config = JSON.parse(await vault.read(row.keys[0])); }
  catch { throw new CollectionError("credentials_unavailable"); }
  validateInventoryConfig(job.kind, config);
  const digest = credentialDigest(config);
  if (job.credential_hash && job.credential_hash !== digest) throw new CollectionError("scope_changed");
  return { config, digest };
}

async function publish(job: Claimed, result: unknown, credentialHash: string, signal: AbortSignal) {
  if (signal.aborted) throw new CollectionError("scan_timeout");
  const parsed = completeInventorySchema.safeParse(result);
  if (!parsed.success) throw new CollectionError("invalid_response");
  const inventory = parsed.data;
  const scopeHash = createHash("sha256").update(JSON.stringify([job.kind, inventory.scope])).digest("hex");
  const credential = await loadCredential(job);
  const currentHash = credential.digest;
  const scopeId = accountScope(job.kind, credential.config as Record<string, unknown>);
  if (currentHash !== credentialHash) throw new CollectionError("scope_changed");
  await queryClient.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(76411213)`;
    const locked = await tx`
      SELECT c.*, a.kind, a.secret_ref_id, a.owner_email, a.is_protected,
        clock_timestamp() AS db_now
      FROM account_collections c JOIN provider_accounts a ON a.id = c.account_id
      WHERE c.account_id = ${job.account_id} FOR UPDATE OF c, a
    `;
    const row = locked[0];
    if (!row || row.lease_token !== job.lease_token || new Date(row.lease_until).getTime() <= new Date(row.db_now).getTime()) throw new CollectionError("lease_lost");
    if (row.kind !== job.kind || row.secret_ref_id !== job.secret_ref_id) throw new CollectionError("credentials_unavailable");
    const ref = await tx`
      SELECT r.vault_url, r.infisical_project, r.environment, r.path, s.config
      FROM secret_refs r LEFT JOIN onboarding_steps s ON s.id = 'infisical' WHERE r.id = ${job.secret_ref_id}
    `;
    if (!ref[0]) throw new CollectionError("credentials_unavailable");
    if (ref[0].vault_url !== builtinVaultUrl) {
      try { refScope(ref[0] as unknown as VaultRef, ref[0].config); }
      catch { throw new CollectionError("credentials_unavailable"); }
    }
    if (row.scope_hash && row.scope_hash !== scopeHash) throw new CollectionError("scope_changed");
    if (row.credential_hash && row.credential_hash !== credentialHash) throw new CollectionError("scope_changed");
    const generation = row.generation + 1;
    const seen = new Set<string>();
    for (const fact of inventory.resources) {
      const id = resourceId(job.kind, job.account_id, inventory.scope, fact.nativeId);
      if (seen.has(id)) throw new CollectionError("invalid_response");
      seen.add(id);
      await tx`
        INSERT INTO resources(id, name, category, provider, account_id, account_email, state,
          is_protected, tags, attributes, native_id, region, source_url, inventory_source,
          scan_generation, retired_at, provider_state, last_seen_at)
        VALUES (${id}, ${fact.name}, ${fact.category}, ${job.kind}, ${job.account_id}, ${row.owner_email},
          ${fact.state}, ${row.is_protected || job.kind === "oracle"}, '[]', ${JSON.stringify({ ...(fact.attributes ?? {}), ...(fact.product ? { product: fact.product } : {}), ...(fact.billing ? { billing: fact.billing } : {}) })}::jsonb,
          ${fact.nativeId}, ${fact.region}, ${publicSourceUrl(fact.sourceUrl)}, 'provider', ${generation}, NULL,
          ${fact.providerState}, NOW())
        ON CONFLICT(id) DO UPDATE SET
          name = EXCLUDED.name, category = EXCLUDED.category, state = EXCLUDED.state, attributes = EXCLUDED.attributes,
          is_protected = resources.is_protected OR EXCLUDED.is_protected,
          region = EXCLUDED.region, source_url = EXCLUDED.source_url,
          provider_state = EXCLUDED.provider_state, scan_generation = EXCLUDED.scan_generation,
          retired_at = NULL, last_seen_at = NOW()
        WHERE resources.account_id = EXCLUDED.account_id AND resources.inventory_source = 'provider'
      `;
    }
    const covered = inventory.covered;
    await tx`
      UPDATE resources SET retired_at = NOW()
      WHERE account_id = ${job.account_id} AND inventory_source = 'provider'
        AND provider = ${job.kind} AND scan_generation IS DISTINCT FROM ${generation}
        AND retired_at IS NULL
        ${covered ? tx`AND COALESCE(attributes->>'product', 'zone') IN ${tx(covered)}` : tx``}
    `;
    if (signal.aborted) throw new CollectionError("scan_timeout");
    const updated = await tx`
      UPDATE account_collections SET state = 'ready', scope_hash = COALESCE(scope_hash, ${scopeHash}),
        credential_hash = COALESCE(credential_hash, ${credentialHash}),
        generation = ${generation}, attempts = 0, lease_token = NULL, lease_until = NULL,
        next_attempt_at = NOW() + INTERVAL '15 minutes', last_success_at = NOW(), error_code = NULL
      WHERE account_id = ${job.account_id} AND lease_token = ${job.lease_token}
        AND lease_until > clock_timestamp()
    `;
    if (updated.count !== 1) throw new CollectionError("lease_lost");
    await tx`
      UPDATE provider_accounts SET enabled = true, health = 'ok', updated_at = NOW()
      WHERE id = ${job.account_id}
    `;
    // Accounts connected before duplicate detection get their provider scope from the credential they already scan with.
    if (scopeId) await tx`
      UPDATE provider_accounts SET scope_id = ${scopeId}
      WHERE id = ${job.account_id} AND scope_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM provider_accounts o WHERE o.kind = ${job.kind} AND o.scope_id = ${scopeId} AND o.archived_at IS NULL AND o.id <> ${job.account_id})
    `;
    // Detection never overrides a plan the owner set by hand.
    if (inventory.plan) await tx`
      UPDATE provider_accounts SET plan = ${inventory.plan}, plan_source = 'detected'
      WHERE id = ${job.account_id} AND (plan_source <> 'manual' OR plan = 'unknown')
    `;
    if (signal.aborted) throw new CollectionError("scan_timeout");
  });
}

async function fail(job: Claimed, error: unknown) {
  const code = collectionError(error).code;
  await queryClient.begin(async tx => {
    const failed = await tx`
    UPDATE account_collections SET
      attempts = attempts + 1,
      state = CASE WHEN attempts + 1 >= 3 OR ${code} IN ('scope_changed', 'unsupported', 'invalid_config', 'credentials_unavailable')
        THEN 'error' ELSE 'queued' END,
      next_attempt_at = CASE WHEN attempts + 1 >= 3 OR ${code} IN ('scope_changed', 'unsupported', 'invalid_config', 'credentials_unavailable')
        THEN NULL ELSE NOW() + (INTERVAL '1 minute' * POWER(2, attempts)) END,
      lease_token = NULL, lease_until = NULL, error_code = ${code}
    WHERE account_id = ${job.account_id} AND lease_token = ${job.lease_token}
    RETURNING account_id
    `;
    if (failed.length) await tx`
      UPDATE provider_accounts SET health = 'degraded', updated_at = NOW()
      WHERE id = ${job.account_id}
    `;
  });
}

export async function runNextInventoryJob(shutdownSignal?: AbortSignal): Promise<boolean> {
  if (shutdownSignal?.aborted) return false;
  const job = await claim();
  if (!job) return false;
  const controller = new AbortController();
  const onShutdown = () => controller.abort();
  shutdownSignal?.addEventListener("abort", onShutdown, { once: true });
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const { config, digest: credentialHash } = await loadCredential(job);
    const bound = await queryClient`
      UPDATE account_collections SET credential_hash = COALESCE(credential_hash, ${credentialHash})
      WHERE account_id = ${job.account_id} AND lease_token = ${job.lease_token}
        AND lease_until > clock_timestamp() AND (credential_hash IS NULL OR credential_hash = ${credentialHash})
    `;
    if (bound.count !== 1) throw new CollectionError("lease_lost");
    if (controller.signal.aborted) throw new CollectionError("scan_timeout");
    const inventory = await Promise.race([
      collectInventory(job.kind, config, controller.signal),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new CollectionError("scan_timeout"));
        else controller.signal.addEventListener("abort", () => reject(new CollectionError("scan_timeout")), { once: true });
      }),
    ]);
    if (controller.signal.aborted) throw new CollectionError("scan_timeout");
    await publish(job, inventory, credentialHash, controller.signal);
  } catch (error) {
    await fail(job, controller.signal.aborted ? new CollectionError("scan_timeout") : error);
  } finally {
    clearTimeout(timer);
    shutdownSignal?.removeEventListener("abort", onShutdown);
  }
  return true;
}

export async function beatInventoryWorker(processId: string) {
  await queryClient`
    INSERT INTO inventory_worker(id, process_id, last_seen_at) VALUES (1, ${processId}, NOW())
    ON CONFLICT(id) DO UPDATE SET process_id = EXCLUDED.process_id, last_seen_at = NOW()
  `;
}
