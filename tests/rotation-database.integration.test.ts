import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { CollectionError } from "../src/lib/inventory/model";
import { credentialDigest } from "../src/lib/inventory/service";
import { configureRotation, listRotation, replaceCredentials, rotateNow, rotationTiming, runDueRotations } from "../src/lib/rotation/service";

const vault = vi.hoisted(() => ({ store: new Map<string, string>(), failWrites: false, removed: [] as string[] }));
vi.mock("../src/lib/onboarding/vault", () => ({
  vaultSession: async () => ({
    write: async (name: string, value: string) => { if (vault.failWrites) throw new Error("vault down"); vault.store.set(name, value); },
    read: async (name: string) => { const value = vault.store.get(name); if (value === undefined) throw new Error("missing"); return value; },
    remove: async (name: string) => { vault.removed.push(name); vault.store.delete(name); },
  }),
}));
vi.mock("../src/lib/inventory/collectors", () => ({
  supportsInventory: (provider: string) => provider === "cloudflare",
  validateInventoryConfig: (provider: string, config: unknown) => {
    const value = config as Record<string, unknown> | null;
    if (provider !== "cloudflare" || !value || typeof value.apiToken !== "string" || typeof value.accountId !== "string") throw new CollectionError("invalid_config", ["apiToken"]);
  },
  collectInventory: vi.fn(),
}));

const origin = "http://127.0.0.1:39424";
const id = "rot-test-" + randomUUID();
const first = { apiToken: "old-secret-token", accountId: "native-account" };
const rolled = "r".repeat(48);
const originalFetch = globalThis.fetch;

async function seed() {
  const ref = `ref-${randomUUID()}`;
  vault.store.clear(); vault.removed = []; vault.failWrites = false;
  vault.store.set("OPAQUE_ONE", JSON.stringify(first));
  await queryClient`DELETE FROM credential_events WHERE account_id = ${id}`;
  await queryClient`DELETE FROM credential_rotation WHERE account_id = ${id}`;
  await queryClient`DELETE FROM account_collections WHERE account_id = ${id}`;
  await queryClient`UPDATE provider_accounts SET secret_ref_id = NULL WHERE id = ${id}`;
  await queryClient`DELETE FROM secret_refs WHERE label = 'rotation fixture' AND NOT EXISTS (SELECT 1 FROM provider_accounts WHERE secret_ref_id = secret_refs.id)`;
  await queryClient`INSERT INTO secret_refs(id,label,vault_url,infisical_project,environment,path,keys) VALUES (${ref}, 'rotation fixture', ${origin}, 'fixture-project', 'dev', '/providers', '["OPAQUE_ONE"]')`;
  await queryClient`UPDATE provider_accounts SET secret_ref_id = ${ref} WHERE id = ${id}`;
  await queryClient`INSERT INTO account_collections(account_id, state, credential_hash) VALUES (${id}, 'ready', ${credentialDigest(first)})`;
  return ref;
}
const currentSecret = async () => {
  const row = (await queryClient`SELECT r.keys FROM provider_accounts a JOIN secret_refs r ON r.id = a.secret_ref_id WHERE a.id = ${id}`)[0];
  return JSON.parse(vault.store.get(row.keys[0]) ?? "null");
};
function cloudflareFetch(options: { rollStatus?: number } = {}) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/verify")) return new Response(JSON.stringify({ success: true, result: { id: "tok-1", status: "active" } }));
    if (init?.method === "PUT") return new Response(JSON.stringify({ success: true, result: rolled }), { status: options.rollStatus ?? 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("credential replacement and rotation (PostgreSQL)", () => {
  let previousStep: Record<string, unknown> | undefined;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", origin);
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    previousStep = (await queryClient`SELECT * FROM onboarding_steps WHERE id = 'infisical'`)[0];
    await queryClient`INSERT INTO onboarding_steps(id, config, status)
      VALUES ('infisical', ${JSON.stringify({ apiUrl: origin, consoleUrl: origin, projectId: "fixture-project", environment: "dev", secretPath: "/providers" })}, 'verified')
      ON CONFLICT(id) DO UPDATE SET config = EXCLUDED.config, status = 'verified'`;
    await queryClient`INSERT INTO provider_accounts(id,kind,label,owner_email,enabled,is_protected) VALUES (${id}, 'cloudflare', 'Rotation fixture', 'owner@example.test', false, false)`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM credential_events WHERE account_id = ${id}`;
    await queryClient`DELETE FROM account_collections WHERE account_id = ${id}`;
    await queryClient`UPDATE provider_accounts SET secret_ref_id = NULL WHERE id = ${id}`;
    await queryClient`DELETE FROM provider_accounts WHERE id = ${id}`;
    await queryClient`DELETE FROM secret_refs WHERE label = 'rotation fixture' AND NOT EXISTS (SELECT 1 FROM provider_accounts WHERE secret_ref_id = secret_refs.id)`;
    if (previousStep) await queryClient`UPDATE onboarding_steps SET config = ${JSON.stringify(previousStep.config)}, status = ${previousStep.status as string} WHERE id = 'infisical'`;
    else await queryClient`DELETE FROM onboarding_steps WHERE id = 'infisical'`;
    globalThis.fetch = originalFetch; vi.unstubAllEnvs();
    await queryClient.end();
  });
  beforeEach(async () => { globalThis.fetch = originalFetch; await seed(); });

  it("replaces credentials: new secret stored and read back, reference swapped, old secret removed, scan queued with the new digest", async () => {
    const replacement = { apiToken: "brand-new-token", accountId: "native-account" };
    const oldRef = (await queryClient`SELECT secret_ref_id FROM provider_accounts WHERE id = ${id}`)[0].secret_ref_id;
    await replaceCredentials(id, replacement, "manual", "owner@example.test");
    expect(await currentSecret()).toEqual(replacement);
    expect(vault.store.has("OPAQUE_ONE")).toBe(false);
    const collection = (await queryClient`SELECT state, credential_hash, error_code FROM account_collections WHERE account_id = ${id}`)[0];
    expect(collection).toMatchObject({ state: "queued", credential_hash: credentialDigest(replacement), error_code: null });
    expect((await queryClient`SELECT count(*)::int AS n FROM secret_refs WHERE id = ${oldRef}`)[0].n).toBe(0);
    expect((await queryClient`SELECT action, outcome, actor FROM credential_events WHERE account_id = ${id}`)[0]).toEqual({ action: "replace", outcome: "ok", actor: "owner@example.test" });
  });

  it("rejects malformed credentials and a different account scope without touching the vault or reference", async () => {
    await expect(replaceCredentials(id, { apiToken: 5 }, "manual", "o")).rejects.toMatchObject({ code: "invalid_config", fields: ["apiToken"] });
    await expect(replaceCredentials(id, { apiToken: "x", accountId: "other-account" }, "manual", "o")).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(await currentSecret()).toEqual(first);
    expect([...vault.store.keys()]).toEqual(["OPAQUE_ONE"]);
  });

  it("refuses while a scan holds a live lease and removes the unused new secret", async () => {
    await queryClient`UPDATE account_collections SET state = 'running', lease_until = NOW() + INTERVAL '60 seconds' WHERE account_id = ${id}`;
    await expect(replaceCredentials(id, { apiToken: "t2", accountId: "native-account" }, "manual", "o")).rejects.toMatchObject({ code: "busy" });
    expect(await currentSecret()).toEqual(first);
    expect([...vault.store.keys()]).toEqual(["OPAQUE_ONE"]);
  });

  it("keeps the old credential when the vault cannot store the new one", async () => {
    vault.failWrites = true;
    await expect(replaceCredentials(id, { apiToken: "t3", accountId: "native-account" }, "manual", "o")).rejects.toMatchObject({ code: "vault_unavailable" });
    expect(await currentSecret()).toEqual(first);
  });

  it("configures a rotation credential in the vault, verifies it, and lists status without secrets", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value", scheduleDays: 30 }, "owner@example.test");
    const row = (await queryClient`SELECT rotator_secret_name, schedule_days, next_rotation_at FROM credential_rotation WHERE account_id = ${id}`)[0];
    expect(vault.store.get(row.rotator_secret_name)).toBe("rotator-secret-value");
    expect(row.schedule_days).toBe(30);
    expect(new Date(row.next_rotation_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const status = await listRotation();
    expect(JSON.stringify(status)).not.toContain("rotator-secret-value");
    expect(status.accounts.find(account => account.accountId === id)).toMatchObject({ rotatorConfigured: true, scheduleDays: 30 });
    await configureRotation(id, { rotatorSecret: "rotator-secret-value" }, "owner@example.test");
    const replaced = (await queryClient`SELECT rotator_secret_name, schedule_days, next_rotation_at FROM credential_rotation WHERE account_id = ${id}`)[0];
    expect(replaced.rotator_secret_name).not.toBe(row.rotator_secret_name);
    expect(replaced).toMatchObject({ schedule_days: 30, next_rotation_at: row.next_rotation_at });
    await configureRotation(id, { scheduleDays: null }, "owner@example.test");
    expect((await queryClient`SELECT schedule_days, next_rotation_at FROM credential_rotation WHERE account_id = ${id}`)[0]).toEqual({ schedule_days: null, next_rotation_at: null });
    await configureRotation(id, { removeRotator: true }, "owner@example.test");
    expect(vault.store.has(replaced.rotator_secret_name)).toBe(false);
    expect(vault.store.has(row.rotator_secret_name)).toBe(false);
    await expect(rotateNow(id, "rotate", "o")).rejects.toMatchObject({ code: "rotator_missing" });
  });

  it("removes the new rotation secret and keeps the old one when saving the settings fails", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value", scheduleDays: 30 }, "o");
    const before = (await queryClient`SELECT rotator_secret_name FROM credential_rotation WHERE account_id = ${id}`)[0].rotator_secret_name;
    await queryClient`ALTER TABLE credential_rotation ADD CONSTRAINT test_reject_schedule CHECK (schedule_days IS DISTINCT FROM 9999) NOT VALID`;
    try {
      vault.removed = [];
      await expect(configureRotation(id, { rotatorSecret: "rotator-secret-value", scheduleDays: 9999 }, "o")).rejects.toThrow();
    } finally {
      await queryClient`ALTER TABLE credential_rotation DROP CONSTRAINT test_reject_schedule`;
    }
    expect(vault.removed).toHaveLength(1);
    expect(vault.removed[0]).toMatch(/^FLEETHUB_ROTATOR_/);
    expect(vault.removed[0]).not.toBe(before);
    expect(vault.store.has(vault.removed[0])).toBe(false);
    expect(vault.store.get(before)).toBe("rotator-secret-value");
    expect((await queryClient`SELECT rotator_secret_name FROM credential_rotation WHERE account_id = ${id}`)[0].rotator_secret_name).toBe(before);
    await configureRotation(id, { removeRotator: true }, "o");
  });

  it("rotates in one click: provider rolls the scan token, the new value is stored before the swap, and a rescan is queued", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value", scheduleDays: 7 }, "o");
    await rotateNow(id, "rotate", "owner@example.test");
    expect(await currentSecret()).toEqual({ apiToken: rolled, accountId: "native-account" });
    expect(vault.store.has("OPAQUE_ONE")).toBe(false);
    expect((await queryClient`SELECT state, credential_hash FROM account_collections WHERE account_id = ${id}`)[0]).toMatchObject({ state: "queued", credential_hash: credentialDigest({ apiToken: rolled, accountId: "native-account" }) });
    const rotation = (await queryClient`SELECT last_status, last_error_code, last_rotated_at, lease_until FROM credential_rotation WHERE account_id = ${id}`)[0];
    expect(rotation).toMatchObject({ last_status: "ok", last_error_code: null, lease_until: null });
    expect(rotation.last_rotated_at).toBeTruthy();
  });

  it("does not roll the provider token when the vault cannot accept writes", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value" }, "o");
    const fetchSpy = vi.mocked(globalThis.fetch); fetchSpy.mockClear();
    vault.failWrites = true;
    await expect(rotateNow(id, "rotate", "o")).rejects.toMatchObject({ code: "vault_unavailable" });
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(await currentSecret()).toEqual(first);
    expect((await queryClient`SELECT last_status, last_error_code FROM credential_rotation WHERE account_id = ${id}`)[0]).toEqual({ last_status: "failed", last_error_code: "vault_unavailable" });
  });

  it("does not roll while a scan is running", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value" }, "o");
    await queryClient`UPDATE account_collections SET state = 'running', lease_until = NOW() + INTERVAL '60 seconds' WHERE account_id = ${id}`;
    const fetchSpy = vi.mocked(globalThis.fetch); fetchSpy.mockClear();
    await expect(rotateNow(id, "rotate", "o")).rejects.toMatchObject({ code: "busy" });
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("reports a provider rejection without changing the stored credential", async () => {
    cloudflareFetch({ rollStatus: 403 });
    await configureRotation(id, { rotatorSecret: "rotator-secret-value" }, "o");
    await expect(rotateNow(id, "rotate", "o")).rejects.toMatchObject({ code: "provider_rejected" });
    expect(await currentSecret()).toEqual(first);
    expect((await queryClient`SELECT action, outcome, error_code FROM credential_events WHERE account_id = ${id} ORDER BY id DESC LIMIT 1`)[0]).toEqual({ action: "rotate", outcome: "failed", error_code: "provider_rejected" });
  });

  it("flags a roll whose new secret could not be stored, after exhausting retries", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value" }, "o");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { const response = await realFetch(url, init); if (init?.method === "PUT") vault.failWrites = true; return response; }) as typeof fetch;
    const delays = rotationTiming.retryDelaysMs; rotationTiming.retryDelaysMs = [0, 1];
    await expect(rotateNow(id, "rotate", "o")).rejects.toMatchObject({ code: "store_failed_after_roll" });
    rotationTiming.retryDelaysMs = delays;
    expect((await queryClient`SELECT last_status, last_error_code FROM credential_rotation WHERE account_id = ${id}`)[0]).toEqual({ last_status: "failed", last_error_code: "store_failed_after_roll" });
  });

  it("runs a due scheduled rotation once and reschedules it", async () => {
    cloudflareFetch();
    await configureRotation(id, { rotatorSecret: "rotator-secret-value", scheduleDays: 30 }, "o");
    expect(await runDueRotations()).toBe(false);
    await queryClient`UPDATE credential_rotation SET next_rotation_at = NOW() - INTERVAL '1 minute' WHERE account_id = ${id}`;
    expect(await runDueRotations()).toBe(true);
    expect(await currentSecret()).toEqual({ apiToken: rolled, accountId: "native-account" });
    const row = (await queryClient`SELECT next_rotation_at FROM credential_rotation WHERE account_id = ${id}`)[0];
    expect(new Date(row.next_rotation_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await queryClient`SELECT actor FROM credential_events WHERE account_id = ${id} AND action = 'rotate'`)[0].actor).toBe("scheduler");
    expect(await runDueRotations()).toBe(false);
  });

  it("backs a failed scheduled rotation off instead of retrying immediately", async () => {
    cloudflareFetch({ rollStatus: 500 });
    await configureRotation(id, { rotatorSecret: "rotator-secret-value", scheduleDays: 30 }, "o");
    await queryClient`UPDATE credential_rotation SET next_rotation_at = NOW() - INTERVAL '1 minute' WHERE account_id = ${id}`;
    expect(await runDueRotations()).toBe(true);
    const row = (await queryClient`SELECT next_rotation_at, last_status FROM credential_rotation WHERE account_id = ${id}`)[0];
    expect(row.last_status).toBe("failed");
    expect(new Date(row.next_rotation_at).getTime()).toBeGreaterThan(Date.now() + 5 * 3_600_000);
  });
});
