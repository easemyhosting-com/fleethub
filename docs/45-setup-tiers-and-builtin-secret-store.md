# Setup tiers and the built-in secret store (M1, first slice)

Implements the first part of the approved plan in [product scope](44-product-scope-and-onboarding-tiers.md). Start from the handoff for rules and state.

## What changed

- **Only a secret store is required.** Provider credentials can be stored once **either** Infisical **or** the built-in store is verified. Tailscale and the CLIProxy gateway are independent, optional steps. `ready` in `/api/onboarding` means "a secret store is verified".
- **Steps are independent.** Verifying or editing one step no longer invalidates the others; each step's fingerprint covers only its own credentials (see docs/38 for hot-reloaded settings).
- **Built-in secret store** (`src/lib/vault/builtin.ts`): values are encrypted with AES-256-GCM in the `secret_store` table. The key is derived (HKDF-SHA256) from `FLEETHUB_SECRET_STORE_KEY`, which lives only in the environment, so a database leak alone reveals nothing. The secret name is bound as authenticated data, so ciphertext cannot be moved to another name; each write uses a fresh 12-byte nonce.
- **One resolver for every backend** (`src/lib/onboarding/vault-ref.ts`): `openVaultForRef` opens the backend a credential reference points to (`vault_url` is `builtin:fleethub` for built-in, otherwise the Infisical URL) and still refuses Infisical references that no longer match the verified setup. Registration, scanning and rotation all use it, so Replace and Rotate (docs/39) work for both backends.
- **Registration** prefers Infisical when it is verified, otherwise the built-in store.
- **Setup wizard**: grouped as Secret store (required, pick one), Private access (recommended) and AI gateway (optional), with all steps selectable. A new install starts on the built-in store.
- **Migration**: `bootstrapDatabase` widens the `onboarding_steps` id check to include `builtin` and creates `secret_store`. Existing installs keep working unchanged.

## Using the built-in store

1. Generate a key: `openssl rand -base64 48` (the setup helper now generates `FLEETHUB_SECRET_STORE_KEY` for new setup directories).
2. Put it in the private `.env` and restart once. It is deliberately **not** hot-reloadable and not in the runtime allowlist.
3. Setup connections, Built-in secret store: Save, then Verify (writes, reads back and deletes a probe).
4. **Back up the key.** Losing it makes stored credentials unrecoverable; keeping it with the database backup defeats the protection.

## Limits and follow-ups

- Key rotation for the built-in store is not implemented (re-encrypt all secrets under a new key); plan it before recommending the store for important credentials. Until then, losing or leaking the key means replacing the stored credentials.
- Moving existing credentials between Infisical and the built-in store is not implemented.
- The setup verification still expires after 15 minutes (configurable, docs/38); for the built-in store a re-verify is one local click.
- Next slices of M1: Cloudflare resource listings, entitlements and allowances store, OCI read-only collector, resource vocabulary and the Fleet Map ([product scope](44-product-scope-and-onboarding-tiers.md)).

## Verification

Unit tests for encryption (round trip, wrong key, tamper, moved ciphertext, short key), the resolver, independent step state and registration; PostgreSQL integration tests for the table, setup verification, built-in registration end to end, and the existing inventory and rotation flows. Not verified live with a real built-in credential on the owner's install (it uses Infisical).
