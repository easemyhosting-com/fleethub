# Credential replacement and rotation

Every credential change goes through one write path, `replaceCredentials` in `src/lib/rotation/service.ts`: manual replacement, one-click rotation and scheduled rotation. It never shows a secret after entry and never lets a scan token's account scope change.

## What happens on a change

1. The new credential is validated against the provider's schema. Non-secret fields (for Cloudflare, `accountId`) must equal the registered account's; otherwise register a new account.
2. The new secret is written to Infisical under a fresh name and read back byte for byte.
3. In one transaction (taking the same setup lock as registration) the account's `secret_refs` reference is swapped, the collection row is queued with the new credential digest, and no scan may hold a live lease. If any step fails, the new secret is removed and the old credential stays active.
4. Only then is the old Infisical secret removed and its reference row deleted. If removal fails the change still stands; the event is flagged `old_secret_not_removed` so it can be cleaned up in the vault.
5. A `credential_events` row records action, outcome, error code and actor (never a value).

## Rotation without manual steps

Infisical's own secret rotation is a paid feature on self-hosted installs, so rotation is implemented in FleetHub using provider APIs. Each provider is a `CredentialRotator` registered in `src/lib/rotation/defaults.ts`:

```ts
registerRotator({ providerId, label, rotatorHint, rotate({ current, rotatorSecret, signal }), checkRotatorSecret(secret, signal, scope) })
```

Adding a provider means one file implementing that interface plus one line in `defaults.ts` (and its secret field names in `scope.ts` / form fields in `fields.ts`). Nothing in the pipeline, API, worker or UI changes.

Cloudflare is built in. It uses a **separate rotation credential** (a Cloudflare token allowed to edit API tokens) stored in Infisical beside the account secret. It is never given to the inventory scan. To rotate, FleetHub finds the scan token's own id (`/user/tokens/verify`, or the account-owned equivalent), rolls its value with the rotation credential, then runs the common write path with the returned value.

Safety rules specific to rolling, because the provider invalidates the old value immediately:

- Before rolling, the vault must accept a test write and no scan may be running.
- After rolling, storing the new value is retried for up to about 100 seconds. If it still fails the event is `store_failed_after_roll`; create a new token and use Replace credentials.
- A failed attempt records the reason, keeps the previous credential if the provider did not roll, and a scheduled rotation retries after six hours rather than immediately.

## Using it

On an account with stored credentials the Accounts panel shows **Replace**, **Rotate now** and **Auto-rotation**. Auto-rotation takes the rotation credential and an optional interval in days (1 to 365). The inventory worker runs due rotations one at a time. Only an operator can change credentials; read-only keys and read-scoped devices cannot.

`GET /api/rotation` returns provider rotators, per-account status and the last 20 events. `POST /api/rotation` takes `replace`, `rotate` or `configure` (rotation credential, schedule, or removal).

## Verification and limits

Verified: unit tests for the registry, scope rules and the Cloudflare rotator against stubbed HTTP; route authorization tests; PostgreSQL integration tests with an in-memory vault covering swap, rollback, busy scans, vault outage before a roll, store failure after a roll, scheduling and backoff. Not verified: a live Cloudflare roll with a real token, and the exact permission Cloudflare requires for account-owned tokens. Other providers (Upstash, Supabase, Neon) support Replace; automatic rotation for them needs a rotator once their APIs are confirmed.
