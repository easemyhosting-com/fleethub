import { queryClient } from "@/lib/db/client";

export class AccountOwnerError extends Error {
  constructor() { super("Account not found"); }
}

/** Moves an account, and the resources already collected for it, to another owner email. The login email follows only when it matched the old owner. */
export async function setAccountOwner(accountId: string, ownerEmail: string, actor: string): Promise<void> {
  await queryClient.begin(async tx => {
    const row = (await tx`SELECT owner_email, login_email FROM provider_accounts WHERE id = ${accountId} FOR UPDATE`)[0];
    if (!row) throw new AccountOwnerError();
    await tx`UPDATE provider_accounts SET owner_email = ${ownerEmail}, login_email = CASE WHEN login_email IS NULL OR login_email = ${row.owner_email} THEN ${ownerEmail} ELSE login_email END, updated_at = NOW() WHERE id = ${accountId}`;
    await tx`UPDATE provider_accounts SET contact_id = (SELECT c.id FROM identity_contacts c WHERE c.kind = 'email' AND LOWER(TRIM(c.value)) = LOWER(TRIM(${ownerEmail})) ORDER BY c.is_primary DESC, c.created_at LIMIT 1) WHERE id = ${accountId}`;
    await tx`UPDATE resources SET account_email = ${ownerEmail} WHERE account_id = ${accountId}`;
    await tx`INSERT INTO capacity_events (subject, action, actor, detail) VALUES (${accountId}, 'owner_set', ${actor}, ${JSON.stringify({ from: row.owner_email, to: ownerEmail })}::jsonb)`;
  });
}

/** The identity's primary email contact, or its first email. Null when the identity does not exist or has none. */
export async function identityEmail(identityId: string): Promise<string | null> {
  const row = (await queryClient`SELECT value FROM identity_contacts WHERE identity_id = ${identityId} AND kind = 'email' ORDER BY is_primary DESC, created_at ASC LIMIT 1`)[0];
  return typeof row?.value === "string" ? row.value : null;
}

/** The stored spelling of this person's email, or null when the address is not one of theirs. */
async function identityEmailOf(identityId: string, email: string): Promise<string | null> {
  const row = (await queryClient`SELECT value FROM identity_contacts WHERE identity_id = ${identityId} AND kind = 'email' AND LOWER(TRIM(value)) = LOWER(TRIM(${email})) LIMIT 1`)[0];
  return typeof row?.value === "string" ? row.value : null;
}

/** Links an account to a person and makes one of that person's emails (the primary one unless given) the account owner. */
export async function setAccountIdentity(accountId: string, identityId: string, actor: string, chosenEmail?: string): Promise<void> {
  const email = chosenEmail ? await identityEmailOf(identityId, chosenEmail) : await identityEmail(identityId);
  if (!email) throw new AccountOwnerError();
  await setAccountOwner(accountId, email, actor);
  await queryClient`UPDATE provider_accounts SET identity_id = ${identityId} WHERE id = ${accountId}`;
}

const scopeKeys: Record<string, string> = { oracle: "tenancyId", cloudflare: "accountId", supabase: "organizationId", neon: "organizationId", upstash: "apiEmail" };

/** The non-secret value that says which provider account a credential belongs to (OCI tenancy, Cloudflare account id), or null when the provider has none. */
export function accountScope(kind: string, config: Record<string, unknown> | undefined): string | null {
  const value = config?.[scopeKeys[kind] ?? ""];
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

/** An active account of the same kind that already points at this provider account, if any. */
export async function findDuplicateAccount(kind: string, scope: string): Promise<{ id: string; label: string } | null> {
  const row = (await queryClient`SELECT id, label FROM provider_accounts WHERE kind = ${kind} AND scope_id = ${scope} AND archived_at IS NULL LIMIT 1`)[0];
  return row ? { id: String(row.id), label: String(row.label) } : null;
}

export async function recordAccountScope(accountId: string, scope: string): Promise<void> {
  await queryClient`UPDATE provider_accounts SET scope_id = ${scope} WHERE id = ${accountId}`;
}

/** Archiving stops scanning and expiry checks but keeps the account, its resources and its history. Unarchiving queues a fresh scan. */
export async function setAccountArchived(accountId: string, archived: boolean, actor: string): Promise<void> {
  await queryClient.begin(async tx => {
    const row = (await tx`SELECT id, secret_ref_id FROM provider_accounts WHERE id = ${accountId} FOR UPDATE`)[0];
    if (!row) throw new AccountOwnerError();
    await tx`UPDATE provider_accounts SET archived_at = ${archived ? new Date() : null}, updated_at = NOW() WHERE id = ${accountId}`;
    await tx`INSERT INTO capacity_events (subject, action, actor, detail) VALUES (${accountId}, ${archived ? "archived" : "unarchived"}, ${actor}, '{}'::jsonb)`;
  });
}

export const accountPlans = ["free", "paid", "unknown"] as const;
export type AccountPlan = (typeof accountPlans)[number];

/** The owner's own statement of whether an account is free or paid; detection never overwrites it. */
export async function setAccountPlan(accountId: string, plan: AccountPlan, actor: string): Promise<void> {
  await queryClient.begin(async tx => {
    const row = (await tx`SELECT plan FROM provider_accounts WHERE id = ${accountId} FOR UPDATE`)[0];
    if (!row) throw new AccountOwnerError();
    await tx`UPDATE provider_accounts SET plan = ${plan}, plan_source = 'manual', updated_at = NOW() WHERE id = ${accountId}`;
    await tx`INSERT INTO capacity_events (subject, action, actor, detail) VALUES (${accountId}, 'plan_set', ${actor}, ${JSON.stringify({ from: row.plan, to: plan })}::jsonb)`;
  });
}

/** Renames an account. The label is only a display name; scope, credentials and history are untouched. */
export async function setAccountLabel(accountId: string, label: string, actor: string): Promise<void> {
  await queryClient.begin(async tx => {
    const row = (await tx`SELECT label FROM provider_accounts WHERE id = ${accountId} FOR UPDATE`)[0];
    if (!row) throw new AccountOwnerError();
    await tx`UPDATE provider_accounts SET label = ${label}, updated_at = NOW() WHERE id = ${accountId}`;
    await tx`INSERT INTO capacity_events (subject, action, actor, detail) VALUES (${accountId}, 'label_set', ${actor}, ${JSON.stringify({ from: row.label, to: label })}::jsonb)`;
  });
}
