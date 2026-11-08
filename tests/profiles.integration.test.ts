import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { identityEmail, setAccountIdentity, setAccountLabel, setAccountOwner } from "../src/lib/fleet/accounts";
import { setProfile } from "../src/lib/fleet/profiles";
import { readSnapshot } from "../src/lib/inventory/snapshot";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("resource profiles (PostgreSQL)", () => {
  const accountId = `prof-acc-${randomUUID()}`, plainId = `prof-res-${randomUUID()}`, oracleId = `prof-ora-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`INSERT INTO provider_accounts(id,kind,label,owner_email,enabled,is_protected) VALUES (${accountId}, 'cloudflare', 'Profile fixture', 'o@example.test', true, false)`;
    await queryClient`INSERT INTO resources(id,name,category,provider,account_id,account_email,state,is_protected,native_id,inventory_source,attributes)
      VALUES (${plainId}, 'plain', 'compute', 'cloudflare', ${accountId}, 'o@example.test', 'online', false, 'n1', 'provider', '{"product":"worker","shape":"S","ocpus":2,"privateKey":"hidden"}'::jsonb),
             (${oracleId}, 'vm', 'compute', 'oracle', ${accountId}, 'o@example.test', 'online', true, 'n2', 'provider', '{}'::jsonb)`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM capacity_events WHERE subject IN (${plainId}, ${oracleId})`;
    await queryClient`DELETE FROM resources WHERE account_id = ${accountId}`;
    await queryClient`DELETE FROM provider_accounts WHERE id = ${accountId}`;
    vi.unstubAllEnvs(); await queryClient.end();
  });

  it("starts unlabelled with safe defaults and exposes only public specs", async () => {
    const snapshot = await readSnapshot({ accountId });
    const res = snapshot.resources.find(item => item.id === plainId)!;
    expect(res.profile).toEqual({ set: false, role: "general", lifecycle: "always_on", backupClass: "none", criticality: "normal", autoStop: "off", labels: {}, notes: null });
    expect(res.specs).toEqual({ product: "worker", shape: "S", ocpus: 2 });
    expect(JSON.stringify(snapshot)).not.toContain("hidden");
  });

  it("saves labels, merges partial updates, replaces labels only when given, and records an audit event", async () => {
    await setProfile(plainId, { role: "ci_runner", lifecycle: "on_demand", labels: { site: "main", env: "ci" }, notes: "temp" }, "owner@example.test");
    await setProfile(plainId, { criticality: "low" }, "owner@example.test");
    let res = (await readSnapshot({ accountId })).resources.find(item => item.id === plainId)!;
    expect(res.profile).toMatchObject({ set: true, role: "ci_runner", lifecycle: "on_demand", criticality: "low", labels: { site: "main", env: "ci" }, notes: "temp" });
    await setProfile(plainId, { labels: { only: "one" }, notes: null }, "owner@example.test");
    res = (await readSnapshot({ accountId })).resources.find(item => item.id === plainId)!;
    expect(res.profile).toMatchObject({ role: "ci_runner", labels: { only: "one" }, notes: null });
    await setProfile(plainId, { autoStop: "recommend" }, "owner@example.test");
    const events = await queryClient`SELECT actor, detail FROM capacity_events WHERE subject = ${plainId} AND action = 'profile_set'`;
    expect(events).toHaveLength(4);
    expect(events.every(event => event.actor === "owner@example.test")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("main"); // label values are not copied into the audit log
  });

  it("never lets a protected resource be set to approve or auto stop, and rejects unknown resources", async () => {
    await expect(setProfile(oracleId, { autoStop: "auto" }, "o")).rejects.toMatchObject({ code: "protected_auto_stop" });
    await expect(setProfile(oracleId, { autoStop: "approve" }, "o")).rejects.toMatchObject({ code: "protected_auto_stop" });
    await expect(setProfile(oracleId, { autoStop: "recommend", lifecycle: "always_on" }, "o")).resolves.toBeUndefined();
    await expect(setProfile("missing-resource", {}, "o")).rejects.toMatchObject({ code: "not_found" });
  });

  it("moves an account and its collected resources to another owner, keeping a different login email", async () => {
    await setAccountOwner(accountId, "alex@example.com", "owner@example.test");
    const account = (await readSnapshot({ accountId })).accounts[0];
    expect(account).toMatchObject({ ownerEmail: "alex@example.com", loginEmail: "alex@example.com" });
    const [row] = await queryClient`SELECT account_email FROM resources WHERE id = ${plainId}`;
    expect(row.account_email).toBe("alex@example.com");
    await queryClient`UPDATE provider_accounts SET login_email = 'sso@example.test' WHERE id = ${accountId}`;
    await setAccountOwner(accountId, "other@example.com", "owner@example.test");
    expect((await readSnapshot({ accountId })).accounts[0]).toMatchObject({ ownerEmail: "other@example.com", loginEmail: "sso@example.test" });
    await expect(setAccountOwner("missing-account", "a@b.co", "o")).rejects.toMatchObject({ message: "Account not found" });
    await queryClient`DELETE FROM capacity_events WHERE subject = ${accountId}`;
  });

  it("renames an account and records the change", async () => {
    await setAccountLabel(accountId, "Renamed fixture", "o");
    expect((await readSnapshot({ accountId })).accounts[0].label).toBe("Renamed fixture");
    expect((await queryClient`SELECT detail FROM capacity_events WHERE subject = ${accountId} AND action = 'label_set'`)[0].detail).toMatchObject({ from: "Profile fixture", to: "Renamed fixture" });
    await expect(setAccountLabel("missing-account", "x", "o")).rejects.toMatchObject({ message: "Account not found" });
    await queryClient`DELETE FROM capacity_events WHERE subject = ${accountId}`;
  });

  it("rolls back ownership, resource email and audit when the identity update fails", async () => {
    const identityId = `prof-rollback-${randomUUID()}`;
    await queryClient`INSERT INTO identities (id, display_name) VALUES (${identityId}, 'Rollback fixture')`;
    await queryClient`INSERT INTO identity_contacts (id, identity_id, kind, value) VALUES (${`ct-${identityId}`}, ${identityId}, 'email', 'rollback@example.test')`;
    const [before] = await queryClient`SELECT identity_id, contact_id, owner_email, login_email FROM provider_accounts WHERE id = ${accountId}`;
    const [resourceBefore] = await queryClient`SELECT account_email FROM resources WHERE id = ${plainId}`;
    const [eventsBefore] = await queryClient`SELECT COUNT(*)::int AS count FROM capacity_events WHERE subject = ${accountId}`;
    await queryClient`CREATE FUNCTION reject_profile_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.identity_id LIKE 'prof-rollback-%' THEN RAISE EXCEPTION 'synthetic identity write failure'; END IF; RETURN NEW; END $$`;
    await queryClient`CREATE TRIGGER reject_profile_identity BEFORE UPDATE ON provider_accounts FOR EACH ROW EXECUTE FUNCTION reject_profile_identity()`;
    try {
      await expect(setAccountIdentity(accountId, identityId, "owner@example.test")).rejects.toThrow("synthetic identity write failure");
      expect((await queryClient`SELECT identity_id, contact_id, owner_email, login_email FROM provider_accounts WHERE id = ${accountId}`)[0]).toEqual(before);
      expect((await queryClient`SELECT account_email FROM resources WHERE id = ${plainId}`)[0]).toEqual(resourceBefore);
      expect((await queryClient`SELECT COUNT(*)::int AS count FROM capacity_events WHERE subject = ${accountId}`)[0]).toEqual(eventsBefore);
    } finally {
      await queryClient`DROP TRIGGER reject_profile_identity ON provider_accounts`;
      await queryClient`DROP FUNCTION reject_profile_identity()`;
      await queryClient`DELETE FROM identities WHERE id = ${identityId}`;
    }
  });

  it("links an account to an identity and adopts that person's primary email", async () => {
    const identityId = `prof-ident-${randomUUID()}`;
    const otherIdentityId = `prof-other-${randomUUID()}`;
    await queryClient`INSERT INTO identities (id, display_name) VALUES (${identityId}, 'Test Person'), (${otherIdentityId}, 'Same email, other person')`;
    await queryClient`INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, created_at) VALUES (${`ct-other-${otherIdentityId}`}, ${otherIdentityId}, 'email', 'second@example.com', true, NOW() - interval '1 day')`;
    await queryClient`INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary) VALUES (${`ct-a-${identityId}`}, ${identityId}, 'email', 'second@example.com', false), (${`ct-b-${identityId}`}, ${identityId}, 'email', 'primary@example.com', true)`;
    try {
      expect(await identityEmail(identityId)).toBe("primary@example.com");
      expect(await identityEmail("missing-identity")).toBeNull();
      await setAccountIdentity(accountId, identityId, "owner@example.test");
      const [row] = await queryClient`SELECT identity_id, owner_email FROM provider_accounts WHERE id = ${accountId}`;
      expect(row).toMatchObject({ identity_id: identityId, owner_email: "primary@example.com" });
      await expect(setAccountIdentity(accountId, "missing-identity", "o")).rejects.toMatchObject({ message: "Account not found" });
      await setAccountIdentity(accountId, identityId, "o", "SECOND@example.com");
      const [picked] = await queryClient`SELECT contact_id, owner_email FROM provider_accounts WHERE id = ${accountId}`;
      expect(picked).toMatchObject({ contact_id: `ct-a-${identityId}`, owner_email: "second@example.com" });
      await expect(setAccountIdentity(accountId, identityId, "o", "stranger@x.co")).rejects.toMatchObject({ message: "Account not found" });
      const byEmail = await readSnapshot({ email: "Second@example.com", provider: "cloudflare", person: identityId });
      expect(byEmail.accounts.map(account => account.id)).toEqual([accountId]);
      expect(byEmail.accounts[0].identityId).toBe(identityId);
      expect(byEmail.resources.every(resource => resource.accountId === accountId)).toBe(true);
      expect((await readSnapshot({ person: identityId, plan: "paid" })).accounts).toEqual([]);
      expect((await readSnapshot({ person: identityId, provider: "oracle" })).resources).toEqual([]);
    } finally {
      await queryClient`UPDATE provider_accounts SET identity_id = NULL WHERE id = ${accountId}`;
      await queryClient`DELETE FROM identities WHERE id IN (${identityId}, ${otherIdentityId})`;
      await queryClient`DELETE FROM capacity_events WHERE subject = ${accountId}`;
    }
  });
});
