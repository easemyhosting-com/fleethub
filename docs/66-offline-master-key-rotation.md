# Offline built-in master-key rotation

This procedure re-encrypts the built-in `secret_store` under a new master secret.
It does not rotate upstream provider credentials or migrate Infisical references.
It is an offline maintenance operation, not an application endpoint. It must not be
run while the web app, worker, scripts or other readers/writers are using the store.
The maintenance flag is an operator assertion, not automatic process detection.

## Transaction and failure contract

The implementation derives/validates both keys and refuses an unchanged key. It
requires an explicit database connection and maintenance assertion. Inside one
PostgreSQL transaction it locks `secret_store` in ACCESS EXCLUSIVE mode, validates
every old ciphertext before any rewrite, then re-encrypts and verifies every row
with a fresh nonce. Names are unchanged, preserving references and authenticated
data bindings. Probe rows and empty names are included. Keyset pages bound metadata
memory; plaintext is held one value at a time, never in a batch or log.

Wrong-key and tampered stores fail preflight. Empty stores are rejected because
there is no old ciphertext against which to authenticate the old key. SQL failure,
lock timeout or cancellation before commit rolls back every rewrite. A commit is
atomic: the database contains either the old set or the new set, not a partial
mixture. PostgreSQL connection loss and crash recovery retain this transaction rule.
A failure returned near commit does not prove which set committed. Keep both keys.

The lock serializes database access during the transaction. It does not stop a
previously running process from later writing with its old in-memory key. Stopping
all consumers before rotation, and restarting all with the new key, is mandatory.
There is no online dual-key period, auto-restart or automatic configuration rewrite.
JavaScript memory is not a secret-isolation boundary; host/process compromise is
outside the database-only protection model.

## Preparation and execution

1. Follow the [separate-key backup/recovery runbook](45-setup-tiers-and-builtin-secret-store.md#master-key-backup-and-recovery).
   Keep a pre-rotation database backup and its matching old key. Generate a strong
   new random master secret locally and back it up separately before proceeding.
2. Stop all application/worker/automation readers and writers. Confirm the target
   `DATABASE_URL` through a private runtime configuration channel. Do not put its
   credential-bearing value in command arguments or support output.
3. Put the old and new raw master secrets in separate regular private files with
   no group/other permission bits. Files are limited to 4096 bytes; symbolic links
   are refused. A single final newline is removed; other bytes are preserved.
   These are raw key files, not `.env` files. Never include the values in arguments.
4. From the source checkout, using the pinned Node version, build the separate runner:

   ```sh
   npm run build:master-key-rotation
   node build/master-key-rotation.mjs --offline-maintenance \
     --old-key-file /path/to/private/old-master \
     --new-key-file /path/to/private/new-master
   ```

   Only the already-configured private environment supplies `DATABASE_URL`. The
   runner does not load arbitrary environment files or change runtime configuration.
   Output contains only the rotated row count or a generic failure code. No secret
   name, key, ciphertext or plaintext is emitted. Do not enable shell tracing.
5. After an acknowledged commit, update the web app and worker runtime master
   secret together through their private configuration channel. Restart and verify
   decryption in isolation before restoring provider networking or normal work.
   Re-verify the built-in setup step. Take a post-rotation backup associated with
   the new key; do not discard the old backup/key until the rollback window closes.

## Interruption and rollback

If rotation clearly failed before commit, retain the old configuration and verify
that the old key still decrypts the preserved store. Fix the cause before retrying.
Do not substitute a random key, delete unreadable rows or bypass verification.

If the process or connection vanished around commit, keep writers stopped. On an
isolated restored copy, test decryption with each retained key without printing
plaintext. Determine which single key opens every row, including probes. Use that
key for coordinated restart. If neither does, restore the known-good pre-rotation
backup and matching old key and investigate; never guess or combine row sets.

To undo an acknowledged rotation, either restore the matched pre-rotation database
and old key together, or perform another fully verified offline rotation from new
to old. Restoring an older database can discard later metadata, so preserve a copy
first. Provider credential revocation/expiry is independent of database rollback.

## Verification scope

Disposable PostgreSQL tests prove successful re-encryption including probes,
fresh nonces and unchanged names, wrong/short/unchanged keys, tampered ciphertext,
empty stores, pre-cancellation and rollback after a later UPDATE is interrupted by
a database trigger. Earlier rewrites are byte-identical to the original after
rollback. These tests do not claim a production rotation, automatic process
coordination, kill-at-commit crash testing, or compatibility of a backup vendor.
