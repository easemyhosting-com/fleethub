import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
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
    await queryClient`INSERT INTO identities(id,display_name) VALUES (${owner}, 'Account owner')`;
    await queryClient`INSERT INTO identity_contacts(id,identity_id,kind,value) VALUES (${contact}, ${owner}, 'email', 'owner@example.com')`;
    await queryClient`INSERT INTO secret_refs(id,label,path,keys) VALUES (${ref}, 'Encrypted reference', '/fixture', '["API_KEY"]'::jsonb)`;
    for (const id of projects) await queryClient`INSERT INTO projects(id,slug,name) VALUES (${id}, ${id}, 'Consumer app')`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM app_credential_consumers WHERE project_id IN (${projects[0]}, ${projects[1]})`;
    await queryClient`DELETE FROM app_credential_links WHERE secret_ref_id = ${ref}`;
    await queryClient`DELETE FROM app_workspaces WHERE account_id = ${account}`;
    await queryClient`DELETE FROM app_accounts WHERE id = ${account}`;
    await queryClient`DELETE FROM projects WHERE id IN (${projects[0]}, ${projects[1]})`;
    await queryClient`DELETE FROM secret_refs WHERE id = ${ref}`;
    await queryClient`DELETE FROM identity_contacts WHERE id = ${contact}`;
    await queryClient`DELETE FROM identities WHERE id = ${owner}`;
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
  it("refuses missing relations and preserves linked contacts", async () => {
    expect(await saveAppAccountCommand({ action: "account", label: "Missing", service: "App", ownerContactId: "missing" })).toBeNull();
    expect(await saveAppAccountCommand({ action: "workspace", accountId: "missing", label: "Missing" })).toBeNull();
    expect(await saveAppAccountCommand({ action: "consumer", credentialId: credential, projectId: "missing" })).toBeNull();
    await expect(queryClient`DELETE FROM identity_contacts WHERE id = ${contact}`).rejects.toMatchObject({ code: "23503" });
  });
});
