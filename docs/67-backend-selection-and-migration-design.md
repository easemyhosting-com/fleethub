# Explicit backend selection and credential migration (design)

Status: design only, not implemented. An operator chooses Infisical or the built-in
encrypted store per credential, and moves one credential between them on purpose, with
verification and rollback.

## Current behaviour

- Account registration picks the backend itself. `registerVaultedAccount` in
  `src/lib/onboarding/provider-credentials.ts` uses Infisical when the `infisical` setup
  step is `verified`, and the built-in store otherwise. The request cannot override this.
- Connector creation copies that rule. `createConnector` in `src/lib/connectors/service.ts`
  uses the same `useInfisical` check and writes to `writeScope(config, "connector")`
  from `src/lib/onboarding/model.ts`.
- The backend lives only in `secret_refs.vault_url` (`src/lib/db/schema.ts`). It holds
  `builtinVaultUrl` (`builtin:fleethub`, from `src/lib/vault/builtin.ts`) or the Infisical
  API URL. `openVaultForRef` in `src/lib/onboarding/vault-ref.ts` dispatches on that value.
  For Infisical it calls `refScope`, which refuses a reference whose origin, project or
  environment no longer matches the verified setup.
- Readers all go through `openVaultForRef`: inventory collection (`src/lib/inventory/service.ts`),
  rotation (`openVault` in `src/lib/rotation/service.ts`) and connectors (`src/lib/connectors/service.ts`).
- `replaceCredentials` in `src/lib/rotation/service.ts` already swaps a reference safely.
  It writes and verifies a new secret, then takes `pg_advisory_xact_lock(76411213)` and
  inserts a new `secret_refs` row copying the old `vault_url`. It repoints the account
  only if `secret_ref_id` is unchanged and no collection lease is active. It removes the
  old secret after commit. Rotation therefore never changes the backend.
- `configureRotation` keeps the rotator secret (`credential_rotation.rotator_secret_name`)
  in the same vault as the account credential, and `rotateNow` reads it from there.
- `secret_refs.status` exists but is written only as `'verified'`. No code moves a
  credential between backends; docs/45 lists this as a follow-up.
- The connectors and rotation POST routes call `isOperator` from `src/lib/auth/guard.ts`.
  `POST` in `src/app/api/providers/route.ts` checks only `requireWrite`. I found no
  operator check on that path, but I did not trace every branch of the route.

## Explicit selector

- Add an optional `backend: "infisical" | "builtin"` field to `providerOnboardingSchema`
  (`src/lib/providers/config-security.ts`) and to the connector create schema in
  `src/app/api/connectors/route.ts`. Both schemas stay strict.
- Replace the two copies of the `useInfisical` logic with one helper,
  `resolveWriteBackend(state, requested, kind)`, placed next to `openVaultForRef`.
  - If `requested` is set and that step is verified, use it. If that step is not
    verified, fail with `backend_unavailable` and do not fall back to the other backend.
  - If `requested` is missing and exactly one backend is verified, use that one. This
    keeps current single-backend installs and API clients working.
  - If `requested` is missing and both backends are verified, fail with
    `backend_required`. Nothing is preferred silently.
- UI: `src/components/ProviderOnboardingModal.tsx` and the connector form show a
  required choice only when both backends are verified. Otherwise they show the one
  backend as read-only text. Bulk and OCI import send the same field.
- Storage: no new column. `secret_refs.vault_url` already records the choice, and the
  same marker convention stays. The response returns only the backend name.
- Registration and connector creation both need `isOperator`. Adding the selector is
  when the providers route should get the same check as the connectors route.

## Migration state machine

A new table, `credential_migrations`, holds one row per attempt. Columns: `id`,
`owner_kind` (`account` or `connector`), `owner_id`, `source_ref_id`, `target_backend`,
`target_ref_id`, `target_names` (jsonb), `state`, `error_code`, `actor` and timestamps.
A partial unique index on `owner_id` allows only one non-terminal migration per owner.

1. `requested`: the operator chose a target. The source reference must open through
   `openVaultForRef` and the target step must be verified. New secret names
   (`FLEETHUB_ACCOUNT_*` or `FLEETHUB_CONNECTOR_*`, plus `FLEETHUB_ROTATOR_*` when a
   rotator exists) are generated and saved in `target_names` before anything is written,
   so a crash can never leave an untracked secret behind.
2. `copied`: each value is read from the source and written to the target under its new
   name. A `secret_refs` row is inserted with `status = 'pending'` and the target
   `vault_url`, `infisical_project`, `environment` and path (from `writeScope`). Nothing
   points at it yet.
3. `verified`: each target value is read back by opening the pending reference with
   `openVaultForRef`, not with the session that wrote it, so the production read path
   is the one tested. The value is compared with a fresh source read using
   `timingSafeEqual` after a length check. Plaintext stays in local variables, one
   value at a time, and is never stored or logged.
4. `switched`: this step runs only when the operator asks for it. One transaction takes
   `pg_advisory_xact_lock(76411213)` and locks the owner row `FOR UPDATE`. It requires
   that `secret_ref_id` still equals `source_ref_id`, that no `account_collections`
   lease is active and that no `credential_rotation` lease is held. It then repoints the
   owner (for connectors, `connectors.secret_name` too), updates `rotator_secret_name`,
   sets the target ref to `'verified'` and records the new state. The source secrets and
   source ref are not touched.
5. `cleaned`: this step also runs only on operator confirmation. It removes the source
   secrets, then deletes the source `secret_refs` row if nothing references it. This
   uses the same guard as the cleanup step in `replaceCredentials`.

Terminal states: `aborted` (before the switch), `rolled_back` (after the switch) and
`superseded` (the owner's reference changed underneath the migration).

## Rollback

- `requested`, `copied` or `verified`: aborting removes the names in `target_names`
  from the target and deletes the pending ref. The source was never changed. If removal
  fails, the row stays `aborted` with `error_code = target_not_removed` so a retry can
  finish the cleanup.
- `switched`: rollback first checks that the source still reads and matches the target,
  without logging either value. Then, in one transaction with the same lock and checks
  as the switch, it points the owner back at `source_ref_id` and only after that removes
  the target copy. If the owner no longer points at `target_ref_id`, the migration
  becomes `superseded` and rollback is refused, because the source copy is now stale.
- `cleaned`: there is no rollback. To go back, the operator runs a new migration in the
  other direction.

## Failure modes

- Target unavailable at copy or verify: abort automatically. The source and the owner
  are unchanged.
- Verification mismatch: the state stays `copied` with `error_code = verify_mismatch`
  and the switch is refused. The response never says which bytes differed.
- Crash between steps: every step is idempotent given the stored row. On restart a
  non-terminal row shows as interrupted, and the operator can resume (re-verify, then
  switch) or abort. The switch itself is one transaction, so the owner points at exactly
  one reference.
- Concurrent rotation or replacement: `replaceCredentials` and the switch use the same
  advisory lock and both compare `secret_ref_id`. If rotation wins, the switch fails and
  the row becomes `superseded`; the target copy is removed. If the switch wins, later
  rotations copy the target `vault_url` and stay on the target backend.
- Infisical setup changed or a step became unverified: `refScope` rejects the source or
  target. Before the switch this aborts. After the switch, cleanup stays pending until
  the operator verifies the step again.
- Backend removed outside FleetHub: not supported (see non-goals). Migration refuses
  to start while either step involved is unverified.

## Never logged or returned

Plaintext values, comparison buffers or digests, ciphertext, nonces, Infisical access
tokens, client secrets and secret names. API responses contain the migration id,
owner id, source and target backend names, the state and a generic error code. Server
logs use the same generic codes as `MasterKeyRotationError` in
`src/lib/vault/master-key-rotation.ts`, and never include driver error text.

## Authorization and audit

Every migration action requires `verifyApiAccess(req, { requireWrite: true })` and then
`isOperator`. Agent keys and read-only sessions get 403. Each transition writes an
`audit_log` row (`src/lib/db/schema.ts`) with the actor, action
`credential_migration.<step>`, target owner id and a `detail` field holding only the
migration id, backend names, state and error code. For accounts, the same event is also
recorded in `credential_events` (created in `src/lib/db/bootstrap.ts`, written by
`record` in `src/lib/rotation/service.ts`), so it appears in credential history.

## Required tests

- Unit: the `resolveWriteBackend` matrix (each combination of verified backends with
  requested or missing choice), the legal and illegal state transitions, mismatch
  detection, and console and response spies that catch any value or secret name.
- Disposable PostgreSQL integration (`*.integration.test.ts`, never a real database):
  built-in to "Infisical" and back with Infisical mocked; switch atomicity, using a
  trigger that fails the repoint; `replaceCredentials` racing a switch; resume after
  simulated crashes at each state; rollback after switch; refusal when superseded;
  cleanup that keeps a source ref still referenced elsewhere; carrying the rotator secret.
- Infisical mocked at `@/lib/onboarding/vault` the way
  `tests/rotation-database.integration.test.ts` and `tests/vaulted-provider.test.ts` do:
  write failure, read-back mismatch, delete refusal and a setup scope change.
- Route tests: non-operator gets 403, unknown fields get 400, and responses carry no
  secret material.

## Non-goals

- No bulk or automatic migration. Each credential moves on its own operator request.
- No online master-key rotation. Offline rotation stays as described in docs/66.
- No removal or decommissioning of a backend, no change to how `openVaultForRef`
  dispatches, and no third backend.
