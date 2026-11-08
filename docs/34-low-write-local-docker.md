# Keeping local Docker writes low

FleetHub is a small stack, but idle databases still write. These measures reduce that, especially when the Docker VM disk lives on an external SSD.

## What the repository does

- **Postgres:** both databases run with `checkpoint_timeout=15min` and `wal_compression=on`. Durability is unchanged: `fsync` and `synchronous_commit` stay on. Do not disable `fsync` for a database that holds real inventory.
- **Worker:** the inventory worker writes its heartbeat every 30 seconds (it was every pass plus 15 seconds) and polls for jobs every 10 seconds. The dashboard still reports it online for up to 60 seconds after the last heartbeat. A queued refresh may wait up to 10 seconds to start.
- **CLIProxy:** generated configuration sets `logging-to-file: false`. An existing install keeps the old value until you edit `cliproxy-config.yaml`.
- **Container logs:** every service uses Docker's `local` log driver capped at two 10 MB files.
- **Measured (2026-10-27, Colima, idle, 3 minutes):** the FleetHub database wrote 0 bytes, Infisical's database about 160 kB, and the worker, Redis and CLIProxy none. First start writes more (schema setup, about 300 MB across both databases) and settles afterwards.
- Redis was left unchanged: it wrote under 100 kB, and Infisical queues live there.

## Habits that matter more

- Stop the stack when you are not testing: `docker compose -p <project> --env-file <setup>/.env --profile infisical --profile cliproxy stop` (naming a profile you never started is harmless), then `colima stop <profile>`.
- Prune now and then: `docker builder prune` and `docker image prune`. Build cache is usually what fills a disk.

## Optional: a separate small Colima profile on the internal disk (not tested here)

Use this only if the main Colima VM lives on an external drive and you want FleetHub's databases off it. It adds a second VM, so give it a small allocation and start it only when needed. The existing profile is not modified.

Colima keeps profile state under `COLIMA_HOME` (default `~/.colima`). If `~/.colima` is a symlink to an external drive, a new profile would land there too, so point `COLIMA_HOME` at an internal directory for this profile only:

```bash
export COLIMA_HOME="$HOME/.colima-fleethub"
colima start fleethub --cpu 2 --memory 3 --disk 15 --mount "$HOME/fleethub-setup:w"
```

Colima may switch your active Docker context to the new profile. Check with `docker context ls`, and switch back with `docker context use colima` if it did. A `DOCKER_HOST` variable in your shell overrides contexts, so address the profile explicitly:

```bash
export DOCKER_HOST="unix://$COLIMA_HOME/fleethub/docker.sock"
node scripts/prepare-local-setup.mjs --directory "$HOME/fleethub-setup"
docker compose -p fleethub-app --env-file "$HOME/fleethub-setup/.env" up -d --build
```

This starts the core services only. Add `--profile cliproxy` or `--profile infisical` only when you choose to run that bundled service; the [self-onboarding guide](23-self-onboarding.md) explains why connecting an existing Infisical is preferred.

Open a new terminal (or unset both variables) to return to your normal Colima profile. Stop the internal VM with `COLIMA_HOME="$HOME/.colima-fleethub" colima stop fleethub`. The bind-mounted setup files then live on the internal disk because that profile shares only that folder.
