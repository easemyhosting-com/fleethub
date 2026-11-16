import { z } from "zod";
import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { appAccountSnapshot, type AppAccountCommand } from "./model";

/** Metadata only. This module never opens a vault or contacts a SaaS service. */
export async function saveAppAccountCommand(input: AppAccountCommand): Promise<string | null> {
  const id = `app-${randomUUID()}`;
  switch (input.action) {
    case "account": {
      const rows = await queryClient`INSERT INTO app_accounts (id, label, service, owner_contact_id)
        SELECT ${id}, ${input.label}, ${input.service}, id FROM identity_contacts WHERE id = ${input.ownerContactId} RETURNING id`;
      return rows.length ? id : null;
    }
    case "workspace": {
      const rows = await queryClient`INSERT INTO app_workspaces (id, account_id, label)
        SELECT ${id}, id, ${input.label} FROM app_accounts WHERE id = ${input.accountId} RETURNING id`;
      return rows.length ? id : null;
    }
    case "credential": {
      const rows = await queryClient`INSERT INTO app_credential_links
        (id, workspace_id, secret_ref_id, label, issuer, purpose, environment, scopes, expires_at, validity)
        SELECT ${id}, w.id, s.id, ${input.label}, ${input.issuer}, ${input.purpose}, ${input.environment},
          ${JSON.stringify(input.scopes)}::jsonb, ${input.expiresAt}::timestamptz, ${input.validity}
        FROM app_workspaces w CROSS JOIN secret_refs s WHERE w.id = ${input.workspaceId} AND s.id = ${input.secretRefId} RETURNING id`;
      return rows.length ? id : null;
    }
    case "consumer": {
      const rows = await queryClient`INSERT INTO app_credential_consumers (credential_id, project_id)
        SELECT c.id, p.id FROM app_credential_links c CROSS JOIN projects p
        WHERE c.id = ${input.credentialId} AND p.id = ${input.projectId} AND p.archived_at IS NULL
        ON CONFLICT (credential_id, project_id) DO UPDATE SET project_id = EXCLUDED.project_id RETURNING credential_id`;
      return rows.length ? input.credentialId : null;
    }
    case "unlink": {
      const rows = await queryClient`DELETE FROM app_credential_consumers
        WHERE credential_id = ${input.credentialId} AND project_id = ${input.projectId} RETURNING credential_id`;
      return rows.length ? input.credentialId : null;
    }
  }
}

/** Bound each list; callers must not mistake a partial view for a complete ledger. */
export async function readAppAccounts() {
  const lists = await Promise.all([
    queryClient`SELECT a.id, a.label, a.service, i.display_name AS owner, c.value AS contact FROM app_accounts a
      JOIN identity_contacts c ON c.id = a.owner_contact_id JOIN identities i ON i.id = c.identity_id ORDER BY a.id LIMIT 1001`,
    queryClient`SELECT id, label, account_id AS "accountId" FROM app_workspaces ORDER BY id LIMIT 1001`,
    queryClient`SELECT id, label, workspace_id AS "workspaceId", secret_ref_id AS "secretRefId", issuer, purpose,
      environment, scopes, expires_at AS "expiresAt", validity FROM app_credential_links ORDER BY id LIMIT 1001`,
    queryClient`SELECT credential_id AS "credentialId", project_id AS "projectId" FROM app_credential_consumers ORDER BY credential_id, project_id LIMIT 1001`,
    queryClient`SELECT c.id, i.display_name || ' / ' || c.value AS label FROM identity_contacts c JOIN identities i ON i.id = c.identity_id ORDER BY c.id LIMIT 1001`,
    queryClient`SELECT id, name AS label FROM projects WHERE archived_at IS NULL ORDER BY id LIMIT 1001`,
    queryClient`SELECT id, label FROM secret_refs ORDER BY id LIMIT 1001`,
  ]);
  const [accounts, workspaces, credentials, consumers, contacts, projects, secretRefs] = lists.map(rows => rows.slice(0, 1000));
  return appAccountSnapshot.parse({ accounts, workspaces, credentials: credentials.map(row => ({ ...row,
    expiresAt: z.coerce.date().nullable().transform(value => value?.toISOString() ?? null).parse(row.expiresAt) })),
  consumers, contacts, projects, secretRefs, limited: lists.some(rows => rows.length > 1000) });
}
