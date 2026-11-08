import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { setManualExpiry, runDueExpiryChecks } from "../src/lib/rotation/service";
import { readSnapshot } from "../src/lib/inventory/snapshot";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("credential expiry (PostgreSQL)", () => {
  const manualId = `exp-manual-${randomUUID()}`;
  const accountId = `exp-acc-${randomUUID()}`, bareId = `exp-bare-${randomUUID()}`, refId = `exp-ref-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`INSERT INTO secret_refs (id, label, vault_url, infisical_project, environment, path, keys, status) VALUES (${refId}, 'x', 'builtin:fleethub', 'builtin', 'builtin', '/', '["N"]'::jsonb, 'verified')`;
    await queryClient`INSERT INTO provider_accounts(id,kind,label,owner_email,enabled,is_protected,secret_ref_id) VALUES (${accountId}, 'neon', 'Expiry fixture', 'o@example.test', true, false, ${refId}), (${bareId}, 'neon', 'No creds', 'o@example.test', true, false, NULL), (${manualId}, 'cloudflare', 'Manual expiry', 'o@example.test', true, false, ${refId})`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM credential_events WHERE account_id IN (${accountId}, ${manualId})`;
    await queryClient`DELETE FROM provider_accounts WHERE id IN (${accountId}, ${bareId}, ${manualId})`;
    await queryClient`DELETE FROM secret_refs WHERE id = ${refId}`;
    vi.unstubAllEnvs(); await queryClient.end();
  });

  it("stores a manual date, reports it in the snapshot, clears it, and refuses accounts without credentials", async () => {
    await setManualExpiry(accountId, "2027-02-01", "owner@example.test");
    let account = (await readSnapshot({ accountId })).accounts[0];
    expect(account.credentialExpiresAt).toBe("2027-02-01T00:00:00.000Z");
    await setManualExpiry(accountId, null, "owner@example.test");
    account = (await readSnapshot({ accountId })).accounts[0];
    expect(account.credentialExpiresAt).toBeNull();
    await expect(setManualExpiry(bareId, "2027-02-01", "o")).rejects.toMatchObject({ code: "not_found" });
    const events = await queryClient`SELECT action FROM credential_events WHERE account_id = ${accountId} AND action = 'set_expiry'`;
    expect(events).toHaveLength(2);
  });

  it("leaves non-Cloudflare and manual accounts alone in the background check", async () => {
    await setManualExpiry(accountId, null, "o");
    await setManualExpiry(manualId, "2027-02-01", "o");
    await queryClient`UPDATE provider_accounts SET credential_expiry_checked_at = NULL WHERE id IN (${accountId}, ${manualId})`;
    // Other suites may leave due Cloudflare accounts in this shared disposable DB.
    // Check our fixtures, rather than assuming the global queue is empty.
    await runDueExpiryChecks();
    const rows = await queryClient`SELECT id, credential_expiry_checked_at FROM provider_accounts WHERE id IN (${accountId}, ${manualId})`;
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.credential_expiry_checked_at === null)).toBe(true);
    expect((await readSnapshot({ accountId: manualId })).accounts[0].credentialExpiresAt).toBe("2027-02-01T00:00:00.000Z");
  });
});
