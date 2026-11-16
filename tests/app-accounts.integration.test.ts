import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { createBuiltinVault } from "../src/lib/vault/builtin";
import { removeUnusedSecretRef } from "../src/lib/vault/cleanup";
import { deleteConnector } from "../src/lib/connectors/service";
import { readAppAccounts, saveAppAccountCommand } from "../src/lib/app-accounts/store";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("manual SaaS ledger (disposable PostgreSQL)", () => {
  const prefix = `ledger-${randomUUID()}`;
  const owner = `${prefix}-owner`, contact = `${prefix}-contact`, ref = `${prefix}-ref`;
  const projects = [`${prefix}-app`, `${prefix}-service`];
  let account = "", workspace = "", credential = "", secondWorkspace = "", secondCredential = "";
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local test database");
    expect((await bootstrapDatabase()).success).toBe(true);
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "fixture".repeat(8));
    await queryClient`INSERT INTO identities(id,display_name) VALUES (${owner}, 'Account owner')`;
    await queryClient`INSERT INTO identity_contacts(id,identity_id,kind,value) VALUES (${contact}, ${owner}, 'email', 'owner@example.com')`;
    await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys) VALUES (${ref}, 'Encrypted reference', 'builtin:fleethub', '/fixture', ${JSON.stringify([ref])}::jsonb)`;
    await createBuiltinVault().write(ref, "synthetic-ledger-credential");
    for (const id of projects) await queryClient`INSERT INTO projects(id,slug,name) VALUES (${id}, ${id}, 'Consumer app')`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM app_credential_consumers WHERE project_id IN (${projects[0]}, ${projects[1]})`;
    // Sweep by prefix so fixtures from a failed test are removed too.
    const fixtures = `${prefix}-%`;
    await queryClient`DELETE FROM app_credential_links WHERE secret_ref_id LIKE ${fixtures} OR id LIKE ${fixtures}`;
    await queryClient`DELETE FROM connectors WHERE id LIKE ${fixtures}`;
    await queryClient`DELETE FROM app_workspaces WHERE account_id = ${account}`;
    await queryClient`DELETE FROM app_accounts WHERE id = ${account}`;
    await queryClient`DELETE FROM projects WHERE id IN (${projects[0]}, ${projects[1]})`;
    await queryClient`DELETE FROM secret_refs WHERE id LIKE ${fixtures}`;
    await queryClient`DELETE FROM secret_store WHERE name LIKE ${fixtures}`;
    await queryClient`DELETE FROM identity_contacts WHERE id = ${contact}`;
    await queryClient`DELETE FROM identities WHERE id = ${owner}`;
    await createBuiltinVault().remove(ref);
    vi.unstubAllEnvs();
    await queryClient.end();
  });
  it("distinguishes the owner, issuer and multiple consumers without creating capacity", async () => {
    const before = (await queryClient`SELECT COUNT(*) AS n FROM resources`)[0].n;
    account = (await saveAppAccountCommand({ action: "account", label: "Supporting app", service: "Example SaaS", ownerContactId: contact })) ?? "";
    workspace = (await saveAppAccountCommand({ action: "workspace", accountId: account, label: "Workspace one" })) ?? "";
    secondWorkspace = (await saveAppAccountCommand({ action: "workspace", accountId: account, label: "Workspace two" })) ?? "";
    const input = { action: "credential", workspaceId: workspace, secretRefId: ref, label: "Key one", issuer: "Separate key issuer", purpose: "Read issues", environment: "dev", scopes: ["issues:read"], expiresAt: "2027-02-01T00:00:00.000Z", validity: "unknown" } as const;
    credential = (await saveAppAccountCommand({ ...input, scopes: [...input.scopes] })) ?? "";
    secondCredential = (await saveAppAccountCommand({ ...input, workspaceId: secondWorkspace, label: "Key two", scopes: [], expiresAt: null })) ?? "";
    for (const projectId of projects) expect(await saveAppAccountCommand({ action: "consumer", credentialId: credential, projectId })).toBe(credential);
    expect(await saveAppAccountCommand({ action: "consumer", credentialId: credential, projectId: projects[0] })).toBe(credential);
    const snapshot = await readAppAccounts();
    expect(snapshot.accounts.find(item => item.id === account)).toMatchObject({ owner: "Account owner", contact: "owner@example.com" });
    expect(snapshot.workspaces.filter(item => item.accountId === account)).toHaveLength(2);
    expect(snapshot.credentials.find(item => item.id === credential)).toMatchObject({ issuer: "Separate key issuer", validity: "unknown", scopes: ["issues:read"], expiresAt: input.expiresAt });
    expect(snapshot.credentials.find(item => item.id === secondCredential)?.expiresAt).toBeNull();
    expect(snapshot.consumers.filter(item => item.credentialId === credential)).toHaveLength(2);
    expect((await queryClient`SELECT COUNT(*) AS n FROM resources`)[0].n).toBe(before);
    expect(JSON.stringify(snapshot)).not.toContain('"path"');
  });
  it("unlinks locally without changing the reference or revocation metadata", async () => {
    expect(await saveAppAccountCommand({ action: "unlink", credentialId: credential, projectId: projects[0] })).toBe(credential);
    const snapshot = await readAppAccounts();
    expect(snapshot.consumers.filter(item => item.credentialId === credential)).toHaveLength(1);
    expect(snapshot.credentials.find(item => item.id === credential)?.validity).toBe("unknown");
    expect((await queryClient`SELECT id FROM secret_refs WHERE id = ${ref}`)).toHaveLength(1);
  });
  it("preserves a connector secret while the ledger still depends on it", async () => {
    const connector = `${prefix}-connector`;
    await queryClient`INSERT INTO connectors(id,kind,label,host_name,created_by,secret_ref_id)
      VALUES (${connector}, 'prometheus', 'Fixture', 'example.com', 'fixture', ${ref})`;
    expect(await deleteConnector(connector)).toBe(true);
    expect(await deleteConnector(connector)).toBe(false);
    expect(await createBuiltinVault().read(ref)).toBe("synthetic-ledger-credential");
    expect((await queryClient`SELECT id FROM secret_refs WHERE id = ${ref}`)).toHaveLength(1);
  });
  it("cleans an unused secret and tolerates an already removed reference", async () => {
    const unused = `${prefix}-unused`;
    await createBuiltinVault().write(unused, "synthetic-unused-credential");
    await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys)
      VALUES (${unused}, 'Unused fixture', 'builtin:fleethub', '/', ${JSON.stringify([unused])}::jsonb)`;
    await removeUnusedSecretRef(unused);
    expect((await queryClient`SELECT id FROM secret_refs WHERE id = ${unused}`)).toHaveLength(0);
    await expect(createBuiltinVault().read(unused)).rejects.toThrow();
    await removeUnusedSecretRef(unused);
  });
  it("cleans more builtin references concurrently than the connection pool size", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `${prefix}-pool-${index}`);
    for (const id of ids) {
      await createBuiltinVault().write(id, "synthetic-pool-fixture");
      await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys)
        VALUES (${id}, 'Pool fixture', 'builtin:fleethub', '/', ${JSON.stringify([id])}::jsonb)`;
    }
    await Promise.all(ids.map(id => removeUnusedSecretRef(id)));
    expect((await queryClient`SELECT id FROM secret_refs WHERE id = ANY(${ids})`)).toHaveLength(0);
    expect((await queryClient`SELECT name FROM secret_store WHERE name = ANY(${ids})`)).toHaveLength(0);
  });
  it("waits for a concurrent link and checks dependencies with a fresh snapshot", async () => {
    const shared = `${prefix}-concurrent`;
    const link = `${prefix}-concurrent-link`;
    await createBuiltinVault().write(shared, "synthetic-concurrent-credential");
    await queryClient`INSERT INTO secret_refs(id,label,vault_url,path,keys)
      VALUES (${shared}, 'Concurrent fixture', 'builtin:fleethub', '/', ${JSON.stringify([shared])}::jsonb)`;
    let cleanup: Promise<void> | undefined;
    try {
      await queryClient.begin(async tx => {
        await tx`INSERT INTO app_credential_links(id,workspace_id,secret_ref_id,label,issuer,purpose,environment)
          VALUES (${link}, ${workspace}, ${shared}, 'Concurrent link', 'Issuer', 'Read', 'dev')`;
        cleanup = removeUnusedSecretRef(shared);
        // Observe the real lock wait rather than assuming a delay proves contention.
        const deadline = Date.now() + 5000;
        while (true) {
          await tx`SELECT pg_stat_clear_snapshot()`;
          const [state] = await tx`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FROM secret_refs WHERE id = $1 FOR UPDATE%') AS waiting`;
          if (state.waiting) break;
          if (Date.now() > deadline) throw new Error("Cleanup did not wait for the FK lock");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      });
      await cleanup;
      expect(await createBuiltinVault().read(shared)).toBe("synthetic-concurrent-credential");
      expect((await queryClient`SELECT id FROM secret_refs WHERE id = ${shared}`)).toHaveLength(1);
    } finally {
      // Settle without rethrowing so a failed cleanup cannot skip fixture removal.
      await cleanup?.catch(() => undefined);
      await queryClient`DELETE FROM app_credential_links WHERE id = ${link}`;
      await removeUnusedSecretRef(shared);
    }
  });
  it("refuses missing relations and preserves linked contacts", async () => {
    expect(await saveAppAccountCommand({ action: "account", label: "Missing", service: "App", ownerContactId: "missing" })).toBeNull();
    expect(await saveAppAccountCommand({ action: "workspace", accountId: "missing", label: "Missing" })).toBeNull();
    expect(await saveAppAccountCommand({ action: "consumer", credentialId: credential, projectId: "missing" })).toBeNull();
    await expect(queryClient`DELETE FROM identity_contacts WHERE id = ${contact}`).rejects.toMatchObject({ code: "23503" });
  });
});
