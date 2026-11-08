import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { openVaultForRef, type Vault, type VaultRef } from "@/lib/onboarding/vault-ref";
import { credentialDigest } from "@/lib/inventory/service";
import { CollectionError } from "@/lib/inventory/model";
import { validateInventoryConfig } from "@/lib/inventory/collectors";
import "./defaults";
import { getRotator, listRotators } from "./registry";
import { scopeOf } from "./scope";
import { RotationError, type RotationTrigger } from "./types";
import { cloudflareTokenExpiry } from "./cloudflare";

type Context = { kind: string; refId: string; secretName: string; vault: Vault };

const rotationLeaseSeconds = 240;
// After the provider rolls a token the old value is dead, so storing the new one is retried, including past a running scan (up to 60s).
export const rotationTiming = { retryDelaysMs: [0, 1000, 3000, 10_000, 30_000, 60_000] };
const scheduleRetryHours = 6;

async function record(accountId: string, action: string, outcome: "ok" | "failed", actor: string, errorCode?: string) {
  try { await queryClient`INSERT INTO credential_events (account_id, action, outcome, error_code, actor) VALUES (${accountId}, ${action}, ${outcome}, ${errorCode ?? null}, ${actor})`; }
  catch { console.error("[Rotation] Could not record credential event"); }
}

/** Opens the vault (built-in or Infisical) pinned on the account's credential reference, using the same checks as inventory collection. */
async function openVault(accountId: string): Promise<Context> {
  const rows = await queryClient`
    SELECT a.kind, a.secret_ref_id, r.vault_url, r.infisical_project, r.environment, r.path, r.keys, s.config AS current_config
    FROM provider_accounts a JOIN secret_refs r ON r.id = a.secret_ref_id LEFT JOIN onboarding_steps s ON s.id = 'infisical'
    WHERE a.id = ${accountId}`;
  const row = rows[0];
  if (!row) throw new RotationError("not_found");
  if (!Array.isArray(row.keys) || row.keys.length !== 1 || typeof row.keys[0] !== "string") throw new RotationError("vault_unavailable");
  try {
    return { kind: row.kind, refId: row.secret_ref_id, secretName: row.keys[0], vault: await openVaultForRef(row as VaultRef, row.current_config) };
  } catch { throw new RotationError("vault_unavailable"); }
}

async function storeSecret(vault: Vault, name: string, value: string) {
  try {
    await vault.write(name, value);
    if (await vault.read(name) !== value) throw new Error("mismatch");
  } catch {
    try { await vault.remove(name); } catch { /* Nothing was confirmed stored. */ }
    throw new RotationError("vault_unavailable");
  }
}

async function readConfig(context: Context): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await context.vault.read(context.secretName));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* Fall through. */ }
  throw new RotationError("vault_unavailable");
}

/** Shared write path for every credential change: manual replacement, one-click rotation and scheduled rotation. */
export async function replaceCredentials(accountId: string, config: unknown, trigger: RotationTrigger, actor: string): Promise<void> {
  const context = await openVault(accountId);
  try { validateInventoryConfig(context.kind, config); }
  catch (error) { throw new RotationError("invalid_config", error instanceof CollectionError ? error.fields : []); }
  const next = config as Record<string, unknown>;
  const current = await readConfig(context);
  if (scopeOf(context.kind, current) !== scopeOf(context.kind, next)) throw new RotationError("scope_mismatch");
  const newName = `FLEETHUB_ACCOUNT_${randomUUID().replaceAll("-", "")}`;
  const newRef = `ref-${randomUUID()}`;
  await storeSecret(context.vault, newName, JSON.stringify(next));
  try {
    await queryClient.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(76411213)`;
      const account = (await tx`SELECT secret_ref_id FROM provider_accounts WHERE id = ${accountId} FOR UPDATE`)[0];
      if (!account || account.secret_ref_id !== context.refId) throw new RotationError("busy");
      const active = (await tx`SELECT (state = 'running' AND lease_until > NOW()) AS active FROM account_collections WHERE account_id = ${accountId} FOR UPDATE`)[0];
      if (active?.active) throw new RotationError("busy");
      await tx`INSERT INTO secret_refs (id, label, vault_url, infisical_project, environment, path, keys, status, last_verified_at)
        SELECT ${newRef}, label, vault_url, infisical_project, environment, path, ${JSON.stringify([newName])}::jsonb, 'verified', NOW() FROM secret_refs WHERE id = ${context.refId}`;
      await tx`UPDATE provider_accounts SET secret_ref_id = ${newRef}, updated_at = NOW() WHERE id = ${accountId}`;
      await tx`INSERT INTO account_collections (account_id, state, next_attempt_at, credential_hash) VALUES (${accountId}, 'queued', NOW(), ${credentialDigest(next)})
        ON CONFLICT (account_id) DO UPDATE SET state = 'queued', attempts = 0, next_attempt_at = NOW(), lease_token = NULL, lease_until = NULL, error_code = NULL, credential_hash = EXCLUDED.credential_hash`;
    });
  } catch (error) {
    try { await context.vault.remove(newName); } catch { console.error("[Rotation] Could not remove an unused credential secret"); }
    throw error;
  }
  let cleaned = true;
  try {
    await context.vault.remove(context.secretName);
    await queryClient`DELETE FROM secret_refs WHERE id = ${context.refId} AND NOT EXISTS (SELECT 1 FROM provider_accounts WHERE secret_ref_id = ${context.refId})`;
  } catch { cleaned = false; console.error("[Rotation] Old credential secret was not removed; delete it in the vault"); }
  await record(accountId, trigger === "manual" ? "replace" : "rotate", "ok", actor, cleaned ? undefined : "old_secret_not_removed");
  await refreshCredentialExpiry(accountId, true).catch(() => undefined);
}

async function claimRotation(accountId: string): Promise<boolean> {
  const claimed = await queryClient`UPDATE credential_rotation SET lease_until = NOW() + ${`${rotationLeaseSeconds} seconds`}::interval, last_attempt_at = NOW()
    WHERE account_id = ${accountId} AND (lease_until IS NULL OR lease_until < NOW()) RETURNING account_id`;
  return claimed.length === 1;
}

async function finishRotation(accountId: string, error?: RotationError) {
  await queryClient`UPDATE credential_rotation SET lease_until = NULL,
    last_status = ${error ? "failed" : "ok"}, last_error_code = ${error?.code ?? null},
    last_rotated_at = CASE WHEN ${!error} THEN NOW() ELSE last_rotated_at END,
    next_rotation_at = CASE WHEN schedule_days IS NULL THEN NULL
      WHEN ${!error} THEN NOW() + (schedule_days || ' days')::interval ELSE NOW() + ${`${scheduleRetryHours} hours`}::interval END
    WHERE account_id = ${accountId}`;
}

/** One-click or scheduled rotation: obtain a fresh credential from the provider, then store it, verify the store and swap. */
export async function rotateNow(accountId: string, trigger: Exclude<RotationTrigger, "manual">, actor: string): Promise<void> {
  const rotation = (await queryClient`SELECT rotator_secret_name FROM credential_rotation WHERE account_id = ${accountId}`)[0];
  if (!rotation) throw new RotationError("rotator_missing");
  if (!(await claimRotation(accountId))) throw new RotationError("busy");
  let failure: RotationError | undefined;
  try {
    const context = await openVault(accountId);
    const rotator = getRotator(context.kind);
    if (!rotator) throw new RotationError("not_supported");
    const scanning = (await queryClient`SELECT 1 FROM account_collections WHERE account_id = ${accountId} AND state = 'running' AND lease_until > NOW()`).length > 0;
    if (scanning) throw new RotationError("busy");
    // Prove the vault accepts writes before the provider invalidates the old secret.
    const probe = `FLEETHUB_PROBE_${randomUUID().replaceAll("-", "")}`;
    await storeSecret(context.vault, probe, "probe");
    try { await context.vault.remove(probe); } catch { /* A leftover probe is harmless. */ }
    let rotatorSecret: string;
    try { rotatorSecret = await context.vault.read(rotation.rotator_secret_name); } catch { throw new RotationError("vault_unavailable"); }
    const current = await readConfig(context);
    const signal = AbortSignal.timeout(30_000);
    const next = await rotator.rotate({ current, rotatorSecret, signal });
    let stored: unknown;
    for (const delay of rotationTiming.retryDelaysMs) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try { await replaceCredentials(accountId, next, trigger, actor); stored = undefined; break; } catch (error) { stored = error; }
    }
    if (stored) throw new RotationError("store_failed_after_roll");
  } catch (error) {
    failure = error instanceof RotationError ? error : new RotationError("provider_rejected");
  }
  await finishRotation(accountId, failure);
  if (failure) { await record(accountId, "rotate", "failed", actor, failure.code); throw failure; }
}

export async function configureRotation(accountId: string, options: { rotatorSecret?: string; scheduleDays?: number | null; removeRotator?: boolean }, actor: string): Promise<void> {
  const context = await openVault(accountId);
  const rotator = getRotator(context.kind);
  if (!rotator) throw new RotationError("not_supported");
  const existing = (await queryClient`SELECT rotator_secret_name FROM credential_rotation WHERE account_id = ${accountId}`)[0];
  if (options.removeRotator) {
    if (existing) {
      await queryClient`DELETE FROM credential_rotation WHERE account_id = ${accountId}`;
      try { await context.vault.remove(existing.rotator_secret_name); } catch { console.error("[Rotation] Old rotation secret was not removed; delete it in the vault"); }
    }
    await record(accountId, "rotation_removed", "ok", actor);
    return;
  }
  let name = existing?.rotator_secret_name as string | undefined;
  const replaced = name;
  if (options.rotatorSecret) {
    const current = await readConfig(context);
    try { await rotator.checkRotatorSecret(options.rotatorSecret, AbortSignal.timeout(15_000), current); }
    catch (error) { throw error instanceof RotationError ? error : new RotationError("provider_rejected"); }
    name = `FLEETHUB_ROTATOR_${randomUUID().replaceAll("-", "")}`;
    await storeSecret(context.vault, name, options.rotatorSecret);
  }
  if (!name) throw new RotationError("rotator_missing");
  const days = options.scheduleDays === undefined ? null : options.scheduleDays;
  await queryClient`
    INSERT INTO credential_rotation (account_id, rotator_secret_name, schedule_days, next_rotation_at)
    VALUES (${accountId}, ${name}, ${days}, ${days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString()}::timestamptz)
    ON CONFLICT (account_id) DO UPDATE SET rotator_secret_name = EXCLUDED.rotator_secret_name, schedule_days = EXCLUDED.schedule_days,
      next_rotation_at = EXCLUDED.next_rotation_at`;
  if (replaced && replaced !== name) { try { await context.vault.remove(replaced); } catch { console.error("[Rotation] Old rotation secret was not removed; delete it in the vault"); } }
  await record(accountId, "rotation_configured", "ok", actor);
}

/** Worker hook: rotates at most one due account per pass. Returns whether it did any work. */
export async function runDueRotations(): Promise<boolean> {
  const due = (await queryClient`
    SELECT account_id FROM credential_rotation
    WHERE schedule_days IS NOT NULL AND next_rotation_at <= NOW() AND (lease_until IS NULL OR lease_until < NOW())
    ORDER BY next_rotation_at LIMIT 1`)[0];
  if (!due) return false;
  try { await rotateNow(due.account_id, "schedule", "scheduler"); } catch { /* The failure is recorded and retried later. */ }
  return true;
}

export async function listRotation() {
  const accounts = await queryClient`
    SELECT a.id AS "accountId", a.kind, (r.account_id IS NOT NULL) AS "rotatorConfigured", r.schedule_days AS "scheduleDays",
      r.next_rotation_at AS "nextRotationAt", r.last_rotated_at AS "lastRotatedAt", r.last_attempt_at AS "lastAttemptAt",
      r.last_status AS "lastStatus", r.last_error_code AS "lastErrorCode"
    FROM provider_accounts a LEFT JOIN credential_rotation r ON r.account_id = a.id
    WHERE a.secret_ref_id IS NOT NULL ORDER BY a.created_at`;
  const events = await queryClient`SELECT account_id AS "accountId", action, outcome, error_code AS "errorCode", created_at AS "at" FROM credential_events ORDER BY id DESC LIMIT 20`;
  return {
    rotators: listRotators().map(({ providerId, label, rotatorHint }) => ({ providerId, label, rotatorHint })),
    accounts, events,
  };
}

const expiryRecheckHours = 12;

/** Reads the token expiry from the provider where it exposes one (Cloudflare). A date the owner entered is kept unless `force` is set. */
export async function refreshCredentialExpiry(accountId: string, force = false): Promise<void> {
  const context = await openVault(accountId);
  if (context.kind !== "cloudflare") { await queryClient`UPDATE provider_accounts SET credential_expiry_checked_at = NOW() WHERE id = ${accountId}`; return; }
  const config = await readConfig(context);
  const token = typeof config.apiToken === "string" ? config.apiToken : "";
  const owner = typeof config.accountId === "string" ? config.accountId : "";
  const at = await cloudflareTokenExpiry(token, owner, AbortSignal.timeout(15_000));
  await queryClient`UPDATE provider_accounts SET credential_expires_at = ${at ? at.toISOString() : null}::timestamptz,
      credential_expiry_source = ${at ? "provider" : null}, credential_expiry_checked_at = NOW()
    WHERE id = ${accountId} AND (${force} OR credential_expiry_source IS DISTINCT FROM 'manual')`;
}

/** The owner's own date, for providers that do not report one. Null clears it. */
export async function setManualExpiry(accountId: string, date: string | null, actor: string): Promise<void> {
  const updated = await queryClient`UPDATE provider_accounts SET credential_expires_at = ${date}::timestamptz,
      credential_expiry_source = ${date ? "manual" : null}, credential_expiry_checked_at = NOW()
    WHERE id = ${accountId} AND secret_ref_id IS NOT NULL RETURNING id`;
  if (updated.length !== 1) throw new RotationError("not_found");
  await record(accountId, "set_expiry", "ok", actor);
}

/** Worker pass: re-reads one Cloudflare token's expiry at most every twelve hours. */
export async function runDueExpiryChecks(): Promise<boolean> {
  const due = (await queryClient`
    SELECT id FROM provider_accounts WHERE kind = 'cloudflare' AND secret_ref_id IS NOT NULL AND archived_at IS NULL
      AND credential_expiry_source IS DISTINCT FROM 'manual'
      AND (credential_expiry_checked_at IS NULL OR credential_expiry_checked_at < NOW() - ${`${expiryRecheckHours} hours`}::interval)
    ORDER BY credential_expiry_checked_at NULLS FIRST LIMIT 1`)[0];
  if (!due) return false;
  try { await refreshCredentialExpiry(due.id); }
  catch { await queryClient`UPDATE provider_accounts SET credential_expiry_checked_at = NOW() WHERE id = ${due.id}`; }
  return true;
}
