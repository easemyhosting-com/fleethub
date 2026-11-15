import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase, demoSeedIds, legacyDemoSeedIds } from "../src/lib/db/bootstrap";
import { DELETE, POST } from "../src/app/api/demo/seed/route";

const origin = "http://localhost:3060";
const call = (handler: typeof POST, token?: string) => handler(new Request(`${origin}/api/demo/seed`, { method: handler === POST ? "POST" : "DELETE", headers: token ? { authorization: `Bearer ${token}` } : {} }));

const count = async (table: "identities" | "provider_accounts" | "resources" | "network_gateways", ids: string[]) =>
  (await queryClient`SELECT COUNT(*)::int AS count FROM ${queryClient(table)} WHERE id IN ${queryClient(ids)}`)[0].count as number;
/** Rows exactly as the seed wrote them before the `demo-` prefix (until 2026-11-09). */
async function insertLegacySeedRows() {
  await queryClient`INSERT INTO identities (id, display_name) VALUES ('ident-primary-operator', 'Fleet Operator')`;
  await queryClient`INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, is_verified, label) VALUES ('ct-operator-email-1', 'ident-primary-operator', 'email', 'operator@fleethub.dev', true, true, 'Primary Infrastructure')`;
  await queryClient`INSERT INTO provider_accounts (id, identity_id, kind, label, owner_email) VALUES ('acc-operator-main', 'ident-primary-operator', 'oracle', 'Oracle Cloud Tenancy 1', 'operator@fleethub.dev')`;
  await queryClient`INSERT INTO resources (id, name, category, provider, account_id, account_email, state, is_protected, tags, attributes) VALUES ('borealis', 'borealis (K3s Cluster 1)', 'compute', 'Oracle Cloud', 'acc-operator-main', 'operator@fleethub.dev', 'online', true, '["arm64", "k3s", "protected"]', '{"ip": "100.64.0.2", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 4, "version": "v1.33.0+k3s1"}')`;
  await queryClient`INSERT INTO network_gateways (id, name, kind, tailscale_ip, port, state, latency_ms) VALUES ('gw-office', 'Office Tailscale exit node', 'tailscale_exit_node', '100.64.0.4', 8888, 'online', 8)`;
}
const legacyLeft = async () => ({
  identities: await count("identities", legacyDemoSeedIds.identities), accounts: await count("provider_accounts", legacyDemoSeedIds.accounts),
  resources: await count("resources", legacyDemoSeedIds.resources), gateways: await count("network_gateways", legacyDemoSeedIds.gateways),
});
const noLegacy = { identities: 0, accounts: 0, resources: 0, gateways: 0 };

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("demo seed reset", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
  });
  beforeEach(async () => {
    const old = legacyDemoSeedIds;
    await queryClient`DELETE FROM resources WHERE id IN ${queryClient(old.resources)}`;
    await queryClient`DELETE FROM network_gateways WHERE id IN ${queryClient(old.gateways)}`;
    await queryClient`DELETE FROM provider_accounts WHERE id IN ${queryClient(old.accounts)}`;
    await queryClient`DELETE FROM identities WHERE id IN ${queryClient(old.identities)}`;
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_API_KEY", "demo-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "demo-reader-fixture");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await queryClient`DELETE FROM resources WHERE id = 'demo-real-resource'`;
    await queryClient`DELETE FROM provider_accounts WHERE id = 'demo-real-account'`;
    await queryClient`DELETE FROM identities WHERE id = 'demo-real-identity'`;
    await queryClient.end();
  });

  it("is operator-only", async () => {
    expect((await call(DELETE)).status).toBe(401);
    expect((await call(DELETE, "demo-reader-fixture")).status).toBe(403);
    expect((await call(POST, "demo-reader-fixture")).status).toBe(403);
  });

  it("removes only the fixed demo rows and keeps real inventory", async () => {
    await queryClient`INSERT INTO identities (id, display_name) VALUES ('demo-real-identity', 'Real person') ON CONFLICT (id) DO NOTHING`;
    await queryClient`INSERT INTO provider_accounts (id, identity_id, kind, label, owner_email) VALUES ('demo-real-account', 'demo-real-identity', 'neon', 'Real account', 'real@example.test') ON CONFLICT (id) DO NOTHING`;
    await queryClient`INSERT INTO resources (id, name, category, provider, account_id, account_email, state) VALUES ('demo-real-resource', 'Real DB', 'database', 'neon', 'demo-real-account', 'real@example.test', 'online') ON CONFLICT (id) DO NOTHING`;
    expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
    expect((await queryClient`SELECT COUNT(*)::int AS count FROM resources WHERE id IN ${queryClient(demoSeedIds.resources)}`)[0].count).toBe(demoSeedIds.resources.length);

    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
    expect((await queryClient`SELECT COUNT(*)::int AS count FROM resources WHERE id IN ${queryClient(demoSeedIds.resources)}`)[0].count).toBe(0);
    expect((await queryClient`SELECT COUNT(*)::int AS count FROM provider_accounts WHERE id IN ${queryClient(demoSeedIds.accounts)}`)[0].count).toBe(0);
    expect((await queryClient`SELECT COUNT(*)::int AS count FROM identities WHERE id IN ${queryClient(demoSeedIds.identities)}`)[0].count).toBe(0);
    expect(await queryClient`SELECT id FROM resources WHERE id = 'demo-real-resource'`).toHaveLength(1);
    expect(await queryClient`SELECT id FROM provider_accounts WHERE id = 'demo-real-account'`).toHaveLength(1);
    expect(await queryClient`SELECT id FROM identities WHERE id = 'demo-real-identity'`).toHaveLength(1);
  });

  it("rolls back the entire reset when another account references a demo identity", async () => {
    expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
    await queryClient`INSERT INTO provider_accounts (id, identity_id, kind, label, owner_email) VALUES ('demo-linked-account', ${demoSeedIds.identities[0]}, 'neon', 'Linked account', 'linked@example.test')`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(500);
      expect((await queryClient`SELECT COUNT(*)::int AS count FROM resources WHERE id IN ${queryClient(demoSeedIds.resources)}`)[0].count).toBe(demoSeedIds.resources.length);
      expect((await queryClient`SELECT COUNT(*)::int AS count FROM provider_accounts WHERE id IN ${queryClient(demoSeedIds.accounts)}`)[0].count).toBe(demoSeedIds.accounts.length);
      expect((await queryClient`SELECT COUNT(*)::int AS count FROM identities WHERE id IN ${queryClient(demoSeedIds.identities)}`)[0].count).toBe(demoSeedIds.identities.length);
      expect(await queryClient`SELECT id FROM provider_accounts WHERE id = 'demo-linked-account'`).toHaveLength(1);
    } finally {
      await queryClient`DELETE FROM provider_accounts WHERE id = 'demo-linked-account'`;
    }
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
  });

  it("preserves a current demo resource and profile when real data references it", async () => {
    expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
    await queryClient`INSERT INTO resource_profiles (resource_id, updated_by) VALUES ('demo-borealis', 'operator')`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(500);
      expect(await queryClient`SELECT id FROM resources WHERE id = 'demo-borealis'`).toHaveLength(1);
      expect(await queryClient`SELECT resource_id FROM resource_profiles WHERE resource_id = 'demo-borealis'`).toHaveLength(1);
      expect(await count("provider_accounts", demoSeedIds.accounts)).toBe(demoSeedIds.accounts.length);
      expect(await count("identities", demoSeedIds.identities)).toBe(demoSeedIds.identities.length);
    } finally {
      await queryClient`DELETE FROM resource_profiles WHERE resource_id = 'demo-borealis'`;
    }
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
  });

  it("removes rows an older install seeded without the demo- prefix, and keeps real rows that reuse those IDs", async () => {
    await insertLegacySeedRows();
    await queryClient`INSERT INTO identities (id, display_name) VALUES ('ident-alex-chen', 'Someone real')`;
    await queryClient`INSERT INTO provider_accounts (id, identity_id, kind, label, owner_email) VALUES ('acc-gcp-prod', 'ident-alex-chen', 'google', 'Real GCP', 'real@example.test')`;
    await queryClient`INSERT INTO resources (id, name, category, provider, account_id, account_email, state) VALUES ('atlas', 'Real atlas', 'compute', 'google', 'acc-gcp-prod', 'real@example.test', 'online')`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
      expect(await queryClient`SELECT id FROM identities WHERE id = 'ident-primary-operator'`).toHaveLength(0);
      expect(await queryClient`SELECT id FROM identity_contacts WHERE id = 'ct-operator-email-1'`).toHaveLength(0);
      expect(await queryClient`SELECT id FROM provider_accounts WHERE id = 'acc-operator-main'`).toHaveLength(0);
      expect(await queryClient`SELECT id FROM resources WHERE id = 'borealis'`).toHaveLength(0);
      expect(await queryClient`SELECT id FROM network_gateways WHERE id = 'gw-office'`).toHaveLength(0);
      expect(await queryClient`SELECT id FROM resources WHERE id = 'atlas' AND account_id = 'acc-gcp-prod'`).toHaveLength(1);
      expect(await queryClient`SELECT id FROM provider_accounts WHERE id = 'acc-gcp-prod'`).toHaveLength(1);
      expect(await queryClient`SELECT id FROM identities WHERE id = 'ident-alex-chen'`).toHaveLength(1);
    } finally {
      await queryClient`DELETE FROM resources WHERE id = 'atlas'`;
      await queryClient`DELETE FROM provider_accounts WHERE id = 'acc-gcp-prod'`;
      await queryClient`DELETE FROM identities WHERE id = 'ident-alex-chen'`;
    }
  });

  it("keeps legacy accounts and identities that real data has touched, and still resets the rest", async () => {
    await insertLegacySeedRows();
    await queryClient`INSERT INTO identities (id, display_name) VALUES ('ident-alex-chen', 'Alex Chen')`;
    await queryClient`INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, is_verified, label) VALUES ('ct-alex-email-1', 'ident-alex-chen', 'email', 'alex.chen@example.org', true, false, 'Partner Org Email (Pending Verification)'), ('demo-real-contact', 'ident-alex-chen', 'email', 'real@example.test', false, true, 'Added by the operator')`;
    await queryClient`INSERT INTO provider_accounts (id, identity_id, kind, label, owner_email) VALUES ('acc-cloudflare-main', 'ident-primary-operator', 'cloudflare', 'Cloudflare Primary DNS', 'operator@fleethub.dev')`;
    await queryClient`INSERT INTO account_collections (account_id) VALUES ('acc-cloudflare-main')`;
    await queryClient`INSERT INTO resources (id, name, category, provider, account_id, account_email, state) VALUES ('r2-artifacts', 'fleet-artifacts', 'storage', 'Cloudflare R2', 'acc-cloudflare-main', 'operator@fleethub.dev', 'online')`;
    await queryClient`INSERT INTO resource_profiles (resource_id, updated_by) VALUES ('borealis', 'operator')`;
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
    expect(await queryClient`SELECT account_id FROM account_collections WHERE account_id = 'acc-cloudflare-main'`).toHaveLength(1);
    expect(await queryClient`SELECT id FROM resources WHERE id IN ('r2-artifacts', 'borealis') ORDER BY id`).toEqual([{ id: "borealis" }, { id: "r2-artifacts" }]);
    expect(await queryClient`SELECT id FROM provider_accounts WHERE id IN ('acc-cloudflare-main', 'acc-operator-main') ORDER BY id`).toEqual([{ id: "acc-cloudflare-main" }, { id: "acc-operator-main" }]);
    expect(await queryClient`SELECT id FROM identities WHERE id IN ('ident-primary-operator', 'ident-alex-chen') ORDER BY id`).toEqual([{ id: "ident-alex-chen" }, { id: "ident-primary-operator" }]);
    expect(await queryClient`SELECT id FROM identity_contacts WHERE id = 'demo-real-contact'`).toHaveLength(1);
    expect(await queryClient`SELECT id FROM network_gateways WHERE id = 'gw-office'`).toHaveLength(0);
    await queryClient`DELETE FROM identity_contacts WHERE id = 'demo-real-contact'`;
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
    expect(await queryClient`SELECT id FROM identities WHERE id = 'ident-alex-chen'`).toHaveLength(0);
  });

  it("does not seed, and reports failure, when the legacy cleanup cannot run", async () => {
    await insertLegacySeedRows();
    await queryClient`ALTER TABLE account_collections RENAME TO account_collections_hidden`;
    try {
      expect((await call(POST, "demo-admin-fixture")).status).toBe(500);
    } finally {
      await queryClient`ALTER TABLE account_collections_hidden RENAME TO account_collections`;
    }
    expect(await count("resources", demoSeedIds.resources)).toBe(0);
    expect(await queryClient`SELECT id FROM resources WHERE id = 'borealis'`).toHaveLength(1);
  });

  it("keeps a legacy-ID gateway that is not the seeded one", async () => {
    await queryClient`INSERT INTO network_gateways (id, name, kind, tailscale_ip, port, state, latency_ms) VALUES ('gw-office', 'Real office node', 'tailscale_exit_node', '100.64.9.9', 8888, 'online', 8)`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
      expect(await queryClient`SELECT id FROM network_gateways WHERE id = 'gw-office'`).toHaveLength(1);
    } finally {
      await queryClient`DELETE FROM network_gateways WHERE id = 'gw-office'`;
    }
  });

  it("replaces legacy rows when seeding again, so an upgraded install has no duplicates", async () => {
    await insertLegacySeedRows();
    expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
    expect(await legacyLeft()).toEqual(noLegacy);
    expect(await count("resources", demoSeedIds.resources)).toBe(demoSeedIds.resources.length);
    expect((await queryClient`SELECT COUNT(*)::int AS count FROM provider_accounts WHERE label = 'Oracle Cloud Tenancy 1'`)[0].count).toBe(1);
    expect((await queryClient`SELECT COUNT(*)::int AS count FROM network_gateways WHERE tailscale_ip = '100.64.0.4'`)[0].count).toBe(1);
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
    expect(await count("resources", demoSeedIds.resources)).toBe(0);
  });
  it("keeps a legacy identity when a real account references one of its contacts", async () => {
    await insertLegacySeedRows();
    await queryClient`INSERT INTO provider_accounts (id, contact_id, kind, label, owner_email) VALUES ('demo-contact-reference', 'ct-operator-email-1', 'neon', 'Real', 'real@example.test')`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
      expect((await queryClient`SELECT contact_id FROM provider_accounts WHERE id = 'demo-contact-reference'`)[0].contact_id).toBe('ct-operator-email-1');
      expect(await queryClient`SELECT id FROM identities WHERE id = 'ident-primary-operator'`).toHaveLength(1);
    } finally { await queryClient`DELETE FROM provider_accounts WHERE id = 'demo-contact-reference'`; }
  });

  it("preserves an operator edit outside the legacy resource's name and account", async () => {
    await insertLegacySeedRows();
    await queryClient`UPDATE resources SET region = 'operator-region' WHERE id = 'borealis'`;
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
    expect((await queryClient`SELECT region FROM resources WHERE id = 'borealis'`)[0].region).toBe('operator-region');
  });

  it("keeps project owners during both current and legacy cleanup", async () => {
    expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
    await queryClient`INSERT INTO projects (id, slug, name, owner_identity_id) VALUES ('demo-owner-project', 'demo-owner-project', 'Owner fixture', ${demoSeedIds.identities[0]})`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(500);
      expect(await queryClient`SELECT id FROM identities WHERE id = ${demoSeedIds.identities[0]}`).toHaveLength(1);
      await insertLegacySeedRows();
      await queryClient`UPDATE projects SET owner_identity_id = 'ident-primary-operator' WHERE id = 'demo-owner-project'`;
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
      expect(await queryClient`SELECT id FROM identities WHERE id = 'ident-primary-operator'`).toHaveLength(1);
    } finally { await queryClient`DELETE FROM projects WHERE id = 'demo-owner-project'`; }
  });

});
