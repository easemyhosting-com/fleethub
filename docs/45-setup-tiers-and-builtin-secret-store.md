# Setup tiers and the built-in secret store (M1, first slice)

Current behavior and limitations of secret storage. Read the [current product direction](64-resource-advisor-and-integration-boundaries.md) for personal/local use and replaceable integrations. Private handoffs are not prerequisites for understanding this public contract.

## Default for personal installations

Infisical is optional. Start with manual inventory without stored provider credentials,
or use the built-in encrypted store for credentialed collection. No external vault
service is needed. Credentialed writes require one verified backend; that is a secret
protection check, not a gate on manual inventory.

The setup helper generates a random master secret for new installs. Keep it in protected
runtime configuration outside Git, with access limited to the operator and required
application processes. Never display it in inventory responses, logs or project tickets.
Back it up separately from the database and preserve it when restoring an installation.
The application still needs access to this key to decrypt credentials; a compromised
application process or host can access secrets. Encryption protects a database-only
leak when the master secret is strong and kept separately, not a fully compromised host.

The current registration path prefers verified Infisical when both backends are verified.
A new install starts with the built-in choice. An explicit backend selector and safe
cross-backend migration are follow-up work, not current capabilities.

## What changed

- **Only a secret store is required.** Provider credentials can be stored once **either** Infisical **or** the built-in store is verified. Tailscale and the CLIProxy gateway are independent, optional steps. `ready` in `/api/onboarding` means "a secret store is verified".
- **Steps are independent.** Verifying or editing one step no longer invalidates the others; each step's fingerprint covers only its own credentials (see docs/38 for hot-reloaded settings).
- **Built-in secret store** (`src/lib/vault/builtin.ts`): values are encrypted with AES-256-GCM in the `secret_store` table. The key is derived (HKDF-SHA256) from `FLEETHUB_SECRET_STORE_KEY`, which lives only in the environment, so a database-only leak does not expose plaintext credentials when the master secret is strong and kept separately. The secret name is bound as authenticated data, so ciphertext cannot be moved to another name; each write uses a fresh 12-byte nonce.
- **One resolver for every backend** (`src/lib/onboarding/vault-ref.ts`): `openVaultForRef` opens the backend a credential reference points to (`vault_url` is `builtin:fleethub` for built-in, otherwise the Infisical URL) and still refuses Infisical references that no longer match the verified setup. Registration, scanning and rotation all use it, so Replace and Rotate (docs/39) work for both backends.
- **Registration** prefers Infisical when it is verified, otherwise the built-in store.
- **Setup wizard**: grouped as Secret store (required, pick one), Private access (recommended) and AI gateway (optional), with all steps selectable. A new install starts on the built-in store.
- **Migration**: `bootstrapDatabase` widens the `onboarding_steps` id check to include `builtin` and creates `secret_store`. Existing installs keep working unchanged.

## Using the built-in store

1. Generate a key: `openssl rand -base64 48` (the setup helper now generates `FLEETHUB_SECRET_STORE_KEY` for new setup directories).
2. Put it in the private `.env` and restart once. It is deliberately **not** hot-reloadable and not in the runtime allowlist.
3. Setup connections, Built-in secret store: Save, then Verify (writes, reads back and deletes a probe).
4. **Back up the key.** Losing it makes stored credentials unrecoverable; storing it alongside the database backup removes the benefit of separate key protection.

## Limits and follow-ups

- Offline transactional master-key rotation is implemented through a separate maintenance runner. It requires a tested backup and all application/worker readers and writers stopped. There is no online rotation API or automatic runtime-key switch. Follow [the rotation procedure](66-offline-master-key-rotation.md); changing the configured key in place still makes existing ciphertext unreadable.
- Moving existing credentials between Infisical and the built-in store is not implemented.
- The setup verification still expires after 15 minutes (configurable, docs/38); for the built-in store a re-verify is one local click.
- Cloudflare listings, entitlements/allowances, the read-only OCI collector, resource profiles and Fleet Map have since shipped. Use [the current plan](62-next-two-weeks.md) for follow-ups; do not rebuild them from the historical M1 proposal.

## Verification

Unit tests for encryption (round trip, wrong key, tamper, moved ciphertext, short key), the resolver, independent step state and registration; PostgreSQL integration tests for the table, setup verification, built-in registration end to end, and the existing inventory and rotation flows. Not verified live with a real built-in credential on the owner's install (it uses Infisical).


## Credential relationships

Secret values belong only in the selected encrypted backend. Inventory and account
views should expose credential references and metadata such as purpose, scopes,
expiry and consumers, never plaintext values. General app-account credentials and
many-to-many consumer links are target work in docs/64; do not assume every arbitrary
SaaS API key can already use the provider-specific registration and rotation paths.
Provider credential replacement is distinct from rotating the store's master key.

## Master-key backup and recovery

Treat the generated master secret as irreplaceable recovery material. Generate it
locally with the setup helper or a cryptographic random generator; retain its exact
bytes. Do not print it in support output, put it in a shell command argument, paste
it into a ticket, or commit it. Store the runtime configuration with restrictive
permissions. The master secret is not hot-reloadable.

Keep an encrypted, access-controlled key backup in a different protection domain
from database backups, such as an independently protected password manager or an
offline encrypted medium. A copy beside a database dump, in the same unprotected
archive or under the same backup credentials defeats database-only separation.
Record the deployment label, key-generation date and which database-backup range
it unlocks, without recording the secret in that index. Limit recovery access and
test retrieval. Losing both the runtime secret and its separate backup makes the
ciphertext unrecoverable. A new random key cannot recover old ciphertext.

Recovery procedure:

1. Stop writes from the web app, worker and any credential automation. Preserve the
   damaged database/configuration for diagnosis. Do not overwrite the only backup.
2. Restore a database backup to a separate disposable PostgreSQL instance. Restore
   the matching key through the private configuration channel, never SQL, logs,
   command arguments or a browser response. Keep provider networking disabled.
3. Verify AES-GCM decryption of synthetic or deliberately selected test references
   in that isolated instance. Emit only success/failure/counts. Never display the
   plaintext or the master secret. Wrong-key or tamper failures must stop recovery;
   do not replace ciphertext or reset verification to hide them.
4. Check expected reference counts and metadata relationships. Verify that account
   records still point to the intended encrypted backend. Restoring a database alone
   does not restore external Infisical contents or provider-side credentials.
5. After verification, switch the application and worker together to the recovered
   database and matching runtime key, then restart and verify the built-in store.
   Keep the original database and matching key available until rollback is no longer
   required. Revert both database and runtime key together if validation fails.

If a key was exposed, database recovery does not revoke any provider credentials.
Revoke/replace affected provider keys using their own lifecycle process. Do not
change the master secret in place as an improvised rotation.

The disposable PostgreSQL restore test backs up encrypted row bytes, removes and
restores them, and verifies decryption with a separately retained in-memory key.
It rejects wrong-key and tampered backups and checks that no key/plaintext is logged.
It does not certify a particular backup service, a production dump, or a disaster
recovery across PostgreSQL versions. Test the chosen backup tooling separately
before relying on it. No production credentials are needed for this proof.
