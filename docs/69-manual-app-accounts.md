# Manual app accounts and consumers

Open **Identity & Accounts**, then **Manage supporting app accounts and consumers**,
or visit `/app-accounts`. Sign in as an operator and load the ledger. Read-only
API keys and agent sessions cannot read contacts or change these relationships.

1. Create a person and contact in the existing identity view.
2. Record a supporting service account with that owner contact. Add one or more
   workspaces beneath the account.
3. Link existing encrypted-store references to a workspace. Record a credential
   label, issuer, purpose, environment, granted scopes and any known expiry or
   reported validity. The issuer is a separate label, not inferred from ownership.
4. Select an existing FleetHub project as a consumer. A project can represent an
   app or service. One credential link can have several consumers, and a workspace
   can have several credential links.

Only non-secret metadata belongs in these fields. Never paste key values into them.
Credential links reuse `secret_refs`; the API does not return vault paths, key names
or decrypted values. Keys are never rotated here.
Connector removal and provider credential replacement preserve stored credentials
and references that still have ledger dependents. Replacement does not move ledger
links to a new key; update consumer arrangements deliberately. Cleanup locks the
reference before checking dependents, so a concurrent link cannot race deletion.
Adding a link does not verify the backend, scopes or upstream key validity.
Reported active or revoked status is an operator statement. Unknown stays unknown.
Dates entered in the form mean midnight UTC. Expiry is separate from reported validity.

Removing a consumer link removes only a local relationship. It does not revoke,
delete or change a stored credential. Account/workspace and credential metadata
editing or deletion are not provided in this first version. Existing contacts and
references with ledger dependents cannot be deleted until those dependents are
handled; no cascade silently erases this ledger.

Manual records live in `app_accounts`, `app_workspaces`, `app_credential_links` and
`app_credential_consumers`. Owners reuse `identity_contacts`, and consumer IDs
reference `projects`. No provider account, resource, quota, health or capacity
record is generated. No SaaS API is called. There is no dedicated Linear collector.

`GET /api/app-accounts` returns the ledger and selector metadata with `no-store`.
Each list is bounded at 1,000 records, with an explicit partial-view notice when
that limit is exceeded. `POST` accepts strict, size-limited commands named
`account`, `workspace`, `credential`, `consumer` and `unlink`. Both methods require
operator authorization; writes use the existing same-origin and rate-limit guard.

## Storing a new key

When a key is not in FleetHub yet, use **Store a new key** on the same page, or
`POST /api/credentials` with `{"label": "...", "value": "..."}` (operator, write
access, strict schema, value at most 8 KiB). The value goes to the verified secret
store: Infisical when verified, otherwise the built-in AES-256-GCM store. FleetHub
reads it back to confirm the write, then records a single-key `secret_refs` row
under a setup-revision lock. The response contains only the new reference ID.
Purpose, environment, scopes, expiry and reported validity stay in the credential
link (step 3), so metadata changes never touch the secret.

`DELETE /api/credentials` with `{"refId": "..."}` removes FleetHub's stored copy and
its reference. It is refused while a provider account, connector, ledger link or the
optional AI connection still uses the key, and it applies only to keys stored through
this flow, identified by an explicit creation marker in reference metadata; existing
references default to unowned, even if their key names match the generic format.
Imported or provider references are never removed here. Removal is not
revocation. The key stays valid at its issuer until the operator revokes it there,
and the response says `"revokedUpstream": false`.
