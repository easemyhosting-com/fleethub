import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase, demoSeedIds } from "../src/lib/db/bootstrap";
import { DELETE, POST } from "../src/app/api/demo/seed/route";

const origin = "http://localhost:3060";
const call = (handler: typeof POST, token?: string) => handler(new Request(`${origin}/api/demo/seed`, { method: handler === POST ? "POST" : "DELETE", headers: token ? { authorization: `Bearer ${token}` } : {} }));

const count = async (table: "identities" | "provider_accounts" | "resources" | "network_gateways", ids: string[]) =>
  (await queryClient`SELECT COUNT(*)::int AS count FROM ${queryClient(table)} WHERE id IN ${queryClient(ids)}`)[0].count as number;
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("demo seed reset", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
  });
  beforeEach(async () => {
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

  it("bootstraps and reseeds the current demo without legacy matching", async () => {
    // A fresh bootstrap/reseed must not run an implicit cleanup DELETE.
    await queryClient`CREATE FUNCTION reject_demo_cleanup_fixture() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''unexpected cleanup during seed''; END'`;
    await queryClient`CREATE TRIGGER reject_demo_cleanup_fixture BEFORE DELETE ON network_gateways FOR EACH STATEMENT EXECUTE FUNCTION reject_demo_cleanup_fixture()`;
    try {
      expect((await bootstrapDatabase()).success).toBe(true);
      expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
      expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
      expect(await count("resources", demoSeedIds.resources)).toBe(demoSeedIds.resources.length);
      expect(await count("provider_accounts", demoSeedIds.accounts)).toBe(demoSeedIds.accounts.length);
    } finally {
      await queryClient`DROP TRIGGER reject_demo_cleanup_fixture ON network_gateways`;
      await queryClient`DROP FUNCTION reject_demo_cleanup_fixture()`;
    }
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
    expect(await count("resources", demoSeedIds.resources)).toBe(0);
  });

  it("keeps project owners during current demo cleanup", async () => {
    expect((await call(POST, "demo-admin-fixture")).status).toBe(200);
    await queryClient`INSERT INTO projects (id, slug, name, owner_identity_id) VALUES ('demo-owner-project', 'demo-owner-project', 'Owner fixture', ${demoSeedIds.identities[0]})`;
    try {
      expect((await call(DELETE, "demo-admin-fixture")).status).toBe(500);
      expect(await queryClient`SELECT id FROM identities WHERE id = ${demoSeedIds.identities[0]}`).toHaveLength(1);
    } finally { await queryClient`DELETE FROM projects WHERE id = 'demo-owner-project'`; }
    expect((await call(DELETE, "demo-admin-fixture")).status).toBe(200);
  });

});
