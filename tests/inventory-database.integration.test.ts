import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { confirmEmptyInventory, credentialDigest, enqueueInventory, resourceId, runNextInventoryJob } from "../src/lib/inventory/service";
import { readSnapshot } from "../src/lib/inventory/snapshot";
import { CollectionError } from "../src/lib/inventory/model";

const fixture = vi.hoisted(() => ({
  secret: { value: "" },
  collect: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("../src/lib/onboarding/vault", () => ({ vaultSession: async () => ({ read: async () => fixture.secret.value }) }));
vi.mock("../src/lib/inventory/collectors", () => ({
  supportsInventory: (provider: string) => provider === "cloudflare",
  validateInventoryConfig: (provider: string, config: unknown) => {
    if (provider !== "cloudflare" || !config || typeof config !== "object" || !("apiToken" in config)) throw new CollectionError("invalid_config");
  },
  collectInventory: fixture.collect,
}));

const ids = ["inv-test-" + randomUUID(), "inv-test-" + randomUUID()];
const oracleId = "inv-test-oracle-" + randomUUID();
const origin = "http://127.0.0.1:39423";
const config = { apiToken: "fixture-secret", accountId: "native-account" };
const scope = "cloudflare/account/native-account";
const fact = (nativeId: string) => ({ nativeId, name: nativeId, category: "network", region: null, state: "online", providerState: "active", sourceUrl: `https://dash.cloudflare.com/${nativeId}` });
const complete = (resources: ReturnType<typeof fact>[], selectedScope = scope) => ({ scope: selectedScope, resources });

async function due(id: string) {
  await queryClient`UPDATE account_collections SET state = 'ready', next_attempt_at = NOW() - INTERVAL '1 second' WHERE account_id = ${id}`;
}

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("inventory PostgreSQL collection", () => {
  let previousStep: {
    config: unknown; status: string; revision: number; verified_at: Date | string | null;
    fingerprint: string | null; verification_id: string | null;
  } | undefined;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", origin);
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    // The opt-in database is disposable; earlier integration fixtures may leave due jobs.
    await queryClient`TRUNCATE account_collections`;
    const prior = (await queryClient`SELECT * FROM onboarding_steps WHERE id = 'infisical'`)[0];
    previousStep = prior ? {
      config: prior.config, status: prior.status, revision: prior.revision,
      verified_at: prior.verified_at, fingerprint: prior.fingerprint, verification_id: prior.verification_id,
    } : undefined;
    await queryClient`INSERT INTO onboarding_steps(id, config, status)
      VALUES ('infisical', ${JSON.stringify({ apiUrl: origin, consoleUrl: origin, projectId: "fixture-project", environment: "dev", secretPath: "/providers" })}, 'verified')
      ON CONFLICT(id) DO UPDATE SET config = EXCLUDED.config, status = 'verified'`;
    fixture.secret.value = JSON.stringify(config);
    for (const [index, id] of ids.entries()) {
      const ref = `ref-${id}`;
      await queryClient`INSERT INTO secret_refs(id,label,vault_url,infisical_project,environment,path,keys)
        VALUES (${ref}, 'fixture', ${origin}, 'fixture-project', 'dev', '/providers', '["opaque"]')`;
      await queryClient`INSERT INTO provider_accounts(id,kind,label,owner_email,secret_ref_id,enabled,is_protected)
        VALUES (${id}, 'cloudflare', ${`Account ${index}`}, ${`owner${index}@example.test`}, ${ref}, false, ${index === 0})`;
    }
    await queryClient`INSERT INTO provider_accounts(id,kind,label,owner_email,enabled,is_protected)
      VALUES (${oracleId}, 'oracle', 'Oracle fixture', 'oracle@example.test', true, false)`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM resources WHERE account_id IN (${ids[0]}, ${ids[1]}, ${oracleId})`;
    for (const id of ids) {
      await queryClient`DELETE FROM account_collections WHERE account_id = ${id}`;
      await queryClient`DELETE FROM provider_accounts WHERE id = ${id}`;
      await queryClient`DELETE FROM secret_refs WHERE id = ${`ref-${id}`}`;
    }
    await queryClient`DELETE FROM provider_accounts WHERE id = ${oracleId}`;
    if (previousStep) await queryClient`UPDATE onboarding_steps SET config = ${JSON.stringify(previousStep.config)}, status = ${previousStep.status}, revision = ${previousStep.revision}, verified_at = ${previousStep.verified_at ?? null}, fingerprint = ${previousStep.fingerprint ?? null}, verification_id = ${previousStep.verification_id ?? null} WHERE id = 'infisical'`;
    else await queryClient`DELETE FROM onboarding_steps WHERE id = 'infisical'`;
    vi.unstubAllEnvs();
    await queryClient.end();
  });
  beforeEach(() => { fixture.collect.mockReset(); fixture.secret.value = JSON.stringify(config); });

  it("coalesces concurrent refreshes and holds a live lease", async () => {
    await Promise.all(Array.from({ length: 8 }, () => enqueueInventory(ids[0], queryClient, credentialDigest(config))));
    let release!: (value: unknown) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    fixture.collect.mockImplementationOnce(async () => { started(); return new Promise(resolve => { release = resolve; }); });
    const running = runNextInventoryJob();
    await entered;
    const before = (await queryClient`SELECT lease_token FROM account_collections WHERE account_id = ${ids[0]}`)[0].lease_token;
    await enqueueInventory(ids[0]);
    const after = (await queryClient`SELECT lease_token,state FROM account_collections WHERE account_id = ${ids[0]}`)[0];
    expect(after).toMatchObject({ lease_token: before, state: "running" });
    release(complete([fact("zone-a")]));
    await running;
    const account = (await queryClient`SELECT enabled,health FROM provider_accounts WHERE id = ${ids[0]}`)[0];
    expect(account).toEqual({ enabled: true, health: "ok" });
    expect((await readSnapshot({ accountId: ids[0] })).resources[0]).toMatchObject({ nativeId: "zone-a", isProtected: true, presence: "present" });
  });

  it("isolates account IDs, retires only absent provider rows, and preserves rows on failure", async () => {
    await enqueueInventory(ids[1], queryClient, credentialDigest(config));
    fixture.collect.mockResolvedValueOnce(complete([fact("zone-a"), fact("zone-b")]));
    await runNextInventoryJob();
    const shared = await queryClient`SELECT id, account_id FROM resources WHERE native_id = 'zone-a' AND account_id IN (${ids[0]}, ${ids[1]})`;
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map(row => row.id)).size).toBe(2);
    expect(shared.some(row => row.id === resourceId("cloudflare", ids[1], scope, "zone-a"))).toBe(true);
    const manualId = `manual-${randomUUID()}`;
    await queryClient`INSERT INTO resources(id,name,category,provider,account_id,account_email,state,is_protected,native_id,inventory_source)
      VALUES (${manualId}, 'manual', 'network', 'cloudflare', ${ids[1]}, 'owner1@example.test', 'unknown', true, 'manual-one', 'manual')`;
    await due(ids[1]);
    fixture.collect.mockRejectedValueOnce(new CollectionError("invalid_response"));
    await runNextInventoryJob();
    expect((await queryClient`SELECT COUNT(*)::int AS n FROM resources WHERE account_id = ${ids[1]} AND retired_at IS NOT NULL`)[0].n).toBe(0);
    expect((await queryClient`SELECT enabled,health FROM provider_accounts WHERE id = ${ids[1]}`)[0]).toEqual({ enabled: true, health: "degraded" });
    await enqueueInventory(ids[1]);
    fixture.collect.mockResolvedValueOnce(complete([]));
    await runNextInventoryJob();
    const preserved = await readSnapshot({ accountId: ids[1] });
    expect(preserved.accounts[0].collection).toMatchObject({ resourceCount: 2, errorCode: "unexpected_empty" });
    await enqueueInventory(ids[1]);
    fixture.collect.mockResolvedValueOnce(complete([fact("zone-a")]));
    await runNextInventoryJob();
    const rows = await queryClient`SELECT native_id,inventory_source,retired_at,is_protected FROM resources WHERE account_id = ${ids[1]}`;
    expect(rows.filter(row => row.inventory_source === "provider" && row.retired_at).map(row => row.native_id)).toEqual(["zone-b"]);
    expect(rows.find(row => row.native_id === "manual-one")).toMatchObject({ inventory_source: "manual", retired_at: null, is_protected: true });
    const snapshot = await readSnapshot({ accountId: ids[1] });
    expect(snapshot.accounts[0].collection.resourceCount).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain("fixture-secret");
    expect(JSON.stringify(snapshot)).not.toContain("opaque");
    const oracle = await readSnapshot({ accountId: oracleId });
    expect(oracle.accounts[0].isProtected).toBe(true);
  });

  it("consumes empty confirmation once and still preserves inventory if the confirmed scan fails", async () => {
    const accountId = ids[1];
    const scan = async () => {
      fixture.collect.mockResolvedValueOnce(complete([]));
      await runNextInventoryJob();
    };
    const collection = async () => (await readSnapshot({ accountId })).accounts[0].collection;
    expect(await confirmEmptyInventory(accountId)).toBe(false);
    await enqueueInventory(accountId);
    await scan();
    expect(await collection()).toMatchObject({ errorCode: "unexpected_empty", resourceCount: 1 });
    expect(await confirmEmptyInventory(accountId)).toBe(true);
    expect(await confirmEmptyInventory(accountId)).toBe(false);
    fixture.collect.mockRejectedValueOnce(new CollectionError("invalid_response"));
    await runNextInventoryJob();
    expect(await collection()).toMatchObject({ errorCode: "invalid_response", resourceCount: 1 });
    await due(accountId);
    await scan();
    expect(await collection()).toMatchObject({ errorCode: "unexpected_empty", resourceCount: 1 });
    expect(await confirmEmptyInventory(accountId)).toBe(true);
    await scan();
    expect(await collection()).toMatchObject({ state: "ready", errorCode: null, resourceCount: 0 });
  });

  it("stores a detected plan and per-resource billing, but never overrides the owner's choice", async () => {
    const billable = { ...fact("zone-paid"), billing: "billable" as const };
    await due(ids[1]);
    await enqueueInventory(ids[1]);
    fixture.collect.mockResolvedValueOnce({ ...complete([billable]), plan: "paid" });
    await runNextInventoryJob();
    expect((await queryClient`SELECT plan, plan_source FROM provider_accounts WHERE id = ${ids[1]}`)[0]).toEqual({ plan: "paid", plan_source: "detected" });
    // Both fixtures share one provider account: the first scanned keeps the scope, the second is not given a duplicate.
    expect((await queryClient`SELECT scope_id FROM provider_accounts WHERE id = ${ids[0]}`)[0].scope_id).toBe("native-account");
    expect((await queryClient`SELECT scope_id FROM provider_accounts WHERE id = ${ids[1]}`)[0].scope_id).toBeNull();
    const shown = await readSnapshot({ accountId: ids[1] });
    expect(shown.accounts[0].plan).toBe("paid");
    expect(shown.resources.find(item => item.nativeId === "zone-paid")?.billing).toBe("billable");
    await queryClient`UPDATE provider_accounts SET plan = 'free', plan_source = 'manual' WHERE id = ${ids[1]}`;
    await due(ids[1]);
    await enqueueInventory(ids[1]);
    fixture.collect.mockResolvedValueOnce({ ...complete([billable]), plan: "paid" });
    await runNextInventoryJob();
    expect((await queryClient`SELECT plan, plan_source FROM provider_accounts WHERE id = ${ids[1]}`)[0]).toEqual({ plan: "free", plan_source: "manual" });
    await queryClient`UPDATE provider_accounts SET plan = 'unknown' WHERE id = ${ids[1]}`;
    await due(ids[1]);
    await enqueueInventory(ids[1]);
    fixture.collect.mockResolvedValueOnce({ ...complete([billable]), plan: "free" });
    await runNextInventoryJob();
    expect((await queryClient`SELECT plan, plan_source FROM provider_accounts WHERE id = ${ids[1]}`)[0]).toEqual({ plan: "free", plan_source: "detected" });
  });

  it("rejects changed credentials before the remote collector and retains prior snapshot", async () => {
    fixture.secret.value = JSON.stringify({ ...config, apiToken: "changed" });
    await enqueueInventory(ids[0]);
    await runNextInventoryJob();
    expect(fixture.collect).not.toHaveBeenCalled();
    const row = (await queryClient`SELECT state,error_code,credential_hash FROM account_collections WHERE account_id = ${ids[0]}`)[0];
    expect(row.state).toBe("error");
    expect(row.error_code).toBe("scope_changed");
    expect(row.credential_hash).toBe(credentialDigest(config));
    expect((await readSnapshot({ accountId: ids[0] })).resources.some(r => r.nativeId === "zone-a" && r.presence === "present")).toBe(true);
  });

  it("rejects a changed returned provider scope without retiring old rows", async () => {
    await enqueueInventory(ids[0]);
    fixture.collect.mockResolvedValueOnce(complete([], "cloudflare/account/other-account"));
    await runNextInventoryJob();
    const row = (await queryClient`SELECT state,error_code,scope_hash FROM account_collections WHERE account_id = ${ids[0]}`)[0];
    expect(row).toMatchObject({ state: "error", error_code: "scope_changed" });
    expect((await readSnapshot({ accountId: ids[0] })).resources.some(r => r.nativeId === "zone-a" && r.presence === "present")).toBe(true);
  });

  it("fences an expired worker after another token publishes", async () => {
    await enqueueInventory(ids[0]);
    let release!: (value: unknown) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    fixture.collect.mockImplementationOnce(async () => { started(); return new Promise(resolve => { release = resolve; }); });
    const staleWorker = runNextInventoryJob();
    await entered;
    await queryClient`UPDATE account_collections SET lease_until = NOW() - INTERVAL '1 second' WHERE account_id = ${ids[0]}`;
    fixture.collect.mockResolvedValueOnce(complete([fact("zone-c")]));
    await runNextInventoryJob();
    release(complete([fact("zone-stale")]));
    await staleWorker;
    const snapshot = await readSnapshot({ accountId: ids[0] });
    expect(snapshot.resources.some(r => r.nativeId === "zone-c" && r.presence === "present")).toBe(true);
    expect(snapshot.resources.some(r => r.nativeId === "zone-stale")).toBe(false);
  });

  it("fails a changed vault environment without reading the secret or changing resources", async () => {
    await enqueueInventory(ids[0]);
    await queryClient`UPDATE secret_refs SET environment = 'other' WHERE id = ${`ref-${ids[0]}`}`;
    await runNextInventoryJob();
    expect(fixture.collect).not.toHaveBeenCalled();
    expect((await queryClient`SELECT error_code FROM account_collections WHERE account_id = ${ids[0]}`)[0].error_code).toBe("credentials_unavailable");
    await queryClient`UPDATE secret_refs SET environment = 'dev' WHERE id = ${`ref-${ids[0]}`}`;
  });

  it("still collects a credential saved in an earlier folder after the configured folder changes", async () => {
    await queryClient`UPDATE secret_refs SET path = '/earlier' WHERE id = ${`ref-${ids[1]}`}`;
    await enqueueInventory(ids[1], queryClient, credentialDigest(config));
    fixture.collect.mockResolvedValueOnce(complete([fact("zone-a")]));
    await runNextInventoryJob();
    expect(fixture.collect).toHaveBeenCalledOnce();
    expect((await queryClient`SELECT state, error_code FROM account_collections WHERE account_id = ${ids[1]}`)[0]).toMatchObject({ error_code: null });
    await queryClient`UPDATE secret_refs SET path = '/providers' WHERE id = ${`ref-${ids[1]}`}`;
  });

  it("stops reclaiming a repeatedly crashed lease until a deliberate refresh", async () => {
    await enqueueInventory(ids[0]);
    await queryClient`
      UPDATE account_collections SET state = 'running', attempts = 2,
        lease_token = ${randomUUID()}, lease_until = NOW() - INTERVAL '1 second'
      WHERE account_id = ${ids[0]}
    `;
    await runNextInventoryJob();
    const row = (await queryClient`SELECT state,attempts,error_code,lease_token FROM account_collections WHERE account_id = ${ids[0]}`)[0];
    expect(row).toMatchObject({ state: "error", attempts: 3, error_code: "lease_lost", lease_token: null });
    expect(fixture.collect).not.toHaveBeenCalled();
    await enqueueInventory(ids[0]);
    expect((await queryClient`SELECT state,attempts FROM account_collections WHERE account_id = ${ids[0]}`)[0]).toMatchObject({ state: "queued", attempts: 0 });
  });

  it("keeps rows of products a scan did not cover, and retires them only when their product was covered", async () => {
    const zone = { ...fact("zone-p"), product: "zone" };
    const worker = { ...fact("worker:w"), category: "serverless", product: "worker" };
    const run = async (payload: unknown) => { await enqueueInventory(ids[0], queryClient, credentialDigest(config)); fixture.collect.mockResolvedValueOnce(payload); await runNextInventoryJob(); };
    const retired = async () => (await queryClient`SELECT native_id, retired_at FROM resources WHERE account_id = ${ids[0]} AND native_id IN ('zone-p', 'worker:w') ORDER BY native_id`).map(row => [row.native_id, row.retired_at !== null]);
    await run(complete([zone, worker]));
    expect(await retired()).toEqual([["worker:w", false], ["zone-p", false]]);
    await run({ ...complete([zone]), covered: ["zone"] });
    expect(await retired()).toEqual([["worker:w", false], ["zone-p", false]]);
    const freshness = async () => Object.fromEntries((await readSnapshot({ accountId: ids[0] })).resources.filter(item => ["zone-p", "worker:w"].includes(item.nativeId ?? "")).map(item => [item.nativeId, item.freshness]));
    expect(await freshness()).toEqual({ "zone-p": "current", "worker:w": "stale" });
    await run({ ...complete([zone]), covered: ["zone", "worker"] });
    expect(await retired()).toEqual([["worker:w", true], ["zone-p", false]]);
    expect((await queryClient`SELECT attributes FROM resources WHERE account_id = ${ids[0]} AND native_id = 'zone-p'`)[0].attributes).toEqual({ product: "zone" });
  });
});
