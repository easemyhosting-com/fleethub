# Hot-reloaded configuration

Changing a setting no longer needs a restart for the values below. Edit `runtime/runtime.env` in your private setup directory (`FLEETHUB_RUNTIME_DIR`, mounted read-only at `/run/fleethub/runtime`); the web app and the inventory worker pick the change up within about a second of the next request or worker pass. Logs name the settings that changed, never their values.

## What reloads

`FLEETHUB_APP_URL`, `FLEETHUB_ALLOWED_ORIGINS`, `FLEETHUB_API_KEY`, `FLEETHUB_READONLY_KEY`, `FLEETHUB_OBSERVATION_KEY`, `FLEETHUB_BOOTSTRAP_TOKEN`, `FLEETHUB_DEVICE_PAIRING`, `FLEETHUB_PAIRING_QR`, `FLEETHUB_PAIRING_MAX_SCOPE`, `FLEETHUB_ONBOARDING_ALLOWED_ORIGINS`, `INFISICAL_URL`, `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID/SECRET`, `TAILSCALE_API_TOKEN`, `TAILSCALE_API_AUTH`, `TAILSCALE_DEVICE_ID`, `CLIPROXY_API_KEY`, `CLIPROXY_MANAGEMENT_KEY`.

## What still needs a restart (on purpose)

`DATABASE_URL`, `FLEETHUB_AUTH_SECRET`, `FLEETHUB_AUTH_REQUIRED`, `FLEETHUB_LOCAL_MODE`, `FLEETHUB_TRUST_PROXY_AUTH`, `NODE_ENV`. A file edit must never be able to weaken authentication or repoint the database, so the loader ignores these keys. Changes to `compose.yml`, the image, or the Tailscale status file (already re-read live) are separate.

## Behavior

- Values from the file override the container environment; removing a line restores the original value.
- Missing, unreadable or over-64 KB files are ignored; the last good values stay.
- The file is read at most once per second, and only when its modification time or size changes.
- Why a directory mount: editors replace files, and a single-file bind mount keeps pointing at the old inode (see docs/23).
- The file is world-readable on the host (the container user must read it). Keep it only in the private setup directory; it holds the same secrets as `.env`.
- Compose-level variables in `.env` are still only applied by `docker compose up`. Use `runtime.env` for anything that should change live.

## First-time upgrade of an existing install

Add `FLEETHUB_RUNTIME_DIR=<setup dir>/runtime` to `.env`, create `runtime/runtime.env`, then recreate `fleetdeck` and `inventory-worker` once. After that no restart is needed for the listed settings.
