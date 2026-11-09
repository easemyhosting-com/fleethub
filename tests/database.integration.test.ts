import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase, backfillProviderAccountIdentities } from "../src/lib/db/bootstrap";
import { POST } from "../src/app/api/identities/route";

// Run only against a disposable database, never the operator's database.
describe.skipIf(process.env.DATABASE_INTEGRATION !== "true")("PostgreSQL identity behavior", () => {
  let safeDatabase = false;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    safeDatabase = true;
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "true");
    if (!(await bootstrapDatabase()).success) throw new Error("Fixture bootstrap failed");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FLEETHUB_API_KEY", "integration-key");
    await queryClient`DELETE FROM provider_accounts WHERE id IN ('integration-one', 'integration-two')`;
    await queryClient`DELETE FROM identities WHERE id IN ('integration-contact', 'ident-test-one-example', 'ident-test-two-example')`;
    const result = await bootstrapDatabase();
    if (!result.success) throw new Error("Database bootstrap failed");
  });
  afterAll(async () => {
    if (!safeDatabase) { await queryClient.end(); return; }
    try {
      await queryClient`DELETE FROM provider_accounts WHERE id IN ('integration-one', 'integration-two')`;
      await queryClient`DELETE FROM identities WHERE id IN ('integration-contact', 'ident-test-one-example', 'ident-test-two-example')`;
    } finally {
      vi.unstubAllEnvs();
      await queryClient.end();
    }
  });
  const request = (body: unknown) => new Request("http://localhost/api/identities", {
    method: "POST", headers: { "x-api-key": "integration-key", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  it("preserves protection when linking and reports missing accounts", async () => {
    const body = { action: "link_account", accountId: "demo-acc-cloudflare-main", identityId: "demo-ident-primary-operator", provider: "cloudflare", label: "Cloudflare" };
    expect((await POST(request(body))).status).toBe(200);
    const [account] = await queryClient`SELECT role, is_protected FROM provider_accounts WHERE id = 'demo-acc-cloudflare-main'`;
    expect(account).toMatchObject({ role: "dns_control", is_protected: true });
    expect((await POST(request({ ...body, accountId: "missing" }))).status).toBe(404);
    expect((await POST(request({ action: "update_protection", accountId: "missing", isProtected: true }))).status).toBe(404);
  });

  it("backfills full normalized emails without local-part collisions", async () => {
    await queryClient`INSERT INTO provider_accounts (id, kind, label, owner_email) VALUES
      ('integration-one', 'cloudflare', 'One', ' Test@one.example '),
      ('integration-two', 'cloudflare', 'Two', 'test@two.example')`;
    expect(await backfillProviderAccountIdentities()).toEqual({ backfilledCount: 2 });
    const rows = await queryClient`SELECT identity_id FROM provider_accounts WHERE id IN ('integration-one', 'integration-two')`;
    expect(rows.every(row => typeof row.identity_id === "string")).toBe(true);
    expect(new Set(rows.map(row => row.identity_id)).size).toBe(2);
    expect(await backfillProviderAccountIdentities()).toEqual({ backfilledCount: 0 });
  });

  it("rolls back primary-contact changes when the insert fails", async () => {
    await queryClient`INSERT INTO identities (id, display_name) VALUES ('integration-contact', 'Contact test')`;
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
    try {
      const body = { action: "add_contact", identityId: "integration-contact", kind: "email", value: "first@example.com", isPrimary: true };
      expect((await POST(request(body))).status).toBe(200);
      const failed = await POST(request({ ...body, value: "second@example.com" }));
      expect(failed.status).toBe(500);
      expect((await failed.json()).error).toBe("Identity request failed");
      const contacts = await queryClient`SELECT value, is_primary FROM identity_contacts WHERE identity_id = 'integration-contact'`;
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ value: "first@example.com", is_primary: true });
    } finally { clock.mockRestore(); }
  });
});
