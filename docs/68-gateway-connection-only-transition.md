# Gateway connection-only transition and profile retirement

**Status: unverified.** Nobody has run this runbook end to end yet. Every command below is derived from `compose.yml`, the setup helper and the onboarding code. None of it was observed working against a real installation. Run it on a copy first, and keep the bundled services until your own run passes every check.

This runbook moves an existing installation off the bundled Compose gateways, `cliproxy`, `infisical` and the legacy combined `integrations` profile, to external instances that FleetHub only connects to. It changes no Compose file. The profiles, service names and volume names stay as they are (see [integration boundaries](64-resource-advisor-and-integration-boundaries.md) and the [bundled Infisical deprecation](23-self-onboarding.md#bundled-infisical-deprecation)).

## What connection-only means

FleetHub stores an API URL and a console URL for each connection, plus a credential reference: the CLIProxy keys or the Infisical machine identity, held in protected runtime configuration. Installing, upgrading, backing up, starting and stopping the external service is the operator's job, done with that service's own tooling. FleetHub can verify a connection and read through it. It never manages the service's lifecycle.

## What FleetHub never does automatically

- Start, stop, restart or recreate any container. FleetHub has no Docker socket access. **Set up locally** only displays a command, and **Use local Compose addresses** only fills in form fields.
- Create, copy, restore or delete a Docker volume.
- Back up or restore a database, an OAuth credential directory or an encryption key.
- Import, move or re-point stored credential references between Infisical origins or into the built-in store.
- Remove or change a Compose profile when you onboard, verify, skip or reconfigure a connection.

Every step below is something the operator does by hand.

## Prerequisites

- Shell access to the Docker host, run as the user who owns the private setup directory. Set `FLEETHUB_SETUP_DIR=/path/to/setup`.
- A private backup directory outside the repository. Create it with `mkdir -m 700 /path/to/backup`.
- An external instance you already run, or will install with the upstream guide: the [CLIProxyAPI Docker Compose guide](https://help.router-for.me/docker/docker-compose) or [Infisical self-hosting](https://infisical.com/docs/self-hosting/deployment-options/docker-compose). It must be reachable from FleetHub's container over HTTPS. Plain HTTP to a host other than loopback also needs `FLEETHUB_ALLOW_INSECURE_SERVICE_HTTP=true`, which only takes effect after a FleetHub restart. Inside a container, `localhost` refers to the container itself.
- A hot-reloaded `$FLEETHUB_SETUP_DIR/runtime/runtime.env`. The setup helper creates it. Older installations enable it once, as [doc 38](38-hot-reload-config.md) describes, and that step recreates `fleetdeck` and `inventory-worker`.
- A maintenance window. Overlap, verification and rollback all assume the bundled services are still present.

## 1. Read-only inventory

These commands only read state:

```sh
docker compose ls
docker volume ls --filter label=com.docker.compose.volume
docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' <project>_cliproxy_auth
```

Write down the Compose project name (`<project>` below) and the exact names of `<project>_cliproxy_auth`, `<project>_cliproxy_logs`, `<project>_cliproxy_plugins` and `<project>_infisical_pg_data`. Also write down which profile you start with (`cliproxy`, `infisical` or `integrations`), because rollback uses the same one. In **Setup connections**, note the saved API URL for each gateway. Every later command uses the same project name and env file, so Docker resolves the original volumes:

```sh
compose() { docker compose -p <project> --env-file "$FLEETHUB_SETUP_DIR/.env" --profile <profile> "$@"; }
```

## 2. Back up (operator action)

FleetHub does not take or check these backups. The volumes are mounted read-only, the copy container has no network, and nothing is stopped:

```sh
for v in cliproxy_auth cliproxy_plugins; do
  docker run --rm --network none -v "<project>_$v:/src:ro" -v /path/to/backup:/backup \
    --entrypoint tar postgres:16.15-alpine -C /src -czf "/backup/$v.tgz" .
done
compose exec -T infisical-db pg_dump -U infisical -d infisical -Fc > /path/to/backup/infisical.dump
cp -p "$FLEETHUB_SETUP_DIR/.env" "$FLEETHUB_SETUP_DIR/cliproxy-config.yaml" /path/to/backup/
```

The tar container can use any local image that includes `tar`. The pinned PostgreSQL image is already on the host. Use the `pg_dump` output to restore Infisical: a file copy of a running PostgreSQL volume is not guaranteed to be consistent. The env-file copy holds `INFISICAL_ENCRYPTION_KEY` and `INFISICAL_AUTH_SECRET`, so protect it like the keys themselves. Before relying on any backup, restore it in isolation.

## 3. CLIProxy

1. **Stand up or reuse the external instance.** Give it its own Compose project or host, and a host port other than `8317`/`8085` while the bundled gateway still runs.
2. **Copy the data.** The credential state is in the auth volume and the config file. Logs are optional. Restore into the external instance's auth directory, then give the files to the user that instance runs as:

   ```sh
   docker volume create <external-project>_cliproxy_auth
   docker run --rm --network none -v <external-project>_cliproxy_auth:/dest -v /path/to/backup:/backup:ro \
     --entrypoint tar postgres:16.15-alpine -C /dest -xzf /backup/cliproxy_auth.tgz
   ```

   Use the copied `cliproxy-config.yaml` as its config, or configure new distinct inference and management keys. Two instances refreshing the same OAuth logins can invalidate each other's tokens, so keep the overlap short.
3. **Point FleetHub at it.** In `$FLEETHUB_SETUP_DIR/runtime/runtime.env` (hot-reloaded, see [doc 38](38-hot-reload-config.md)), set `CLIPROXY_API_KEY` and `CLIPROXY_MANAGEMENT_KEY` to the external instance's keys. Add its exact origin and keep the bundled origin for rollback, for example `FLEETHUB_ONBOARDING_ALLOWED_ORIGINS=http://infisical:8080,http://cli-proxy-api:8317,https://cliproxy.example.com`. In **Setup connections**, open the CLIProxy step. Enter the API URL `https://cliproxy.example.com` and the console URL `https://cliproxy.example.com/management.html`, then save.
4. **Verify through FleetHub.** **Verify** must pass: it calls `/v1/models` with the inference key and `/v8/management/credentials` with the management key. Then run **Check capabilities** and confirm the upstream account counts by provider match what the bundled gateway showed. Open the console URL from your own device.
5. **Stop the bundled service and keep its volumes.** Run `compose stop cli-proxy-api`. With `restart: unless-stopped`, a stopped container stays stopped. Do not run `down`, `rm` or `--volumes`.

## 4. Infisical

FleetHub stores each Infisical credential reference with the exact API URL it was written through. A reference opens only while the verified setup has the same origin, project and environment (`src/lib/onboarding/vault-ref.ts`). After an origin change, every stored reference fails with "Vault reference does not match the verified setup". FleetHub has no tool that re-points references. **Continue only if the external instance will answer at the API URL already saved in FleetHub.** The bundled default `http://infisical:8080` is a Compose service name, so in practice that rules out most bundled installations. If yours uses it, stop here and keep the bundled profile. An origin change needs its own explicit, per-credential migration, which this runbook does not cover.

1. **Stand up the external instance and keep it stopped.** Install with the upstream guide, using the same `INFISICAL_IMAGE` digest as the bundled one so database migrations match. Upgrade only after the cutover is verified.
2. **Freeze credential writes, then take the final dump.** The backup in section 2 ran with everything live, so a credential saved after it would be missing from the external instance while FleetHub still points at it. Stop every writer first: FleetHub's web app and worker, and the bundled Infisical service so no other client writes through it. Its database keeps running for the dump:

   ```sh
   compose stop fleetdeck inventory-worker infisical
   compose exec -T infisical-db pg_dump -U infisical -d infisical -Fc > /path/to/backup/infisical-final.dump
   ```

   Keep these services stopped until step 4. Restore `infisical-final.dump`, not the earlier copy. To abort before step 4, run `compose up -d infisical fleetdeck inventory-worker`; nothing was changed.
3. **Restore the data, keys included.** Before Infisical's first start, restore the final dump into the external PostgreSQL:

   ```sh
   docker run --rm -i -e DEST_DB_URI postgres:16.15-alpine \
     sh -c 'pg_restore --no-owner --dbname "$DEST_DB_URI"' < /path/to/backup/infisical-final.dump
   ```

   Here `DEST_DB_URI` is `postgresql://infisical:<password>@db.example.com:5432/infisical`, exported in the shell and never written to a file in the repository. Set the external `ENCRYPTION_KEY` and `AUTH_SECRET` to the values of `INFISICAL_ENCRYPTION_KEY` and `INFISICAL_AUTH_SECRET` from the private env file. **The keys must move with the database.** A database restored without its original `ENCRYPTION_KEY` starts, but every stored secret is unreadable, and no FleetHub action can recover it. Redis holds cache and queue state only and is not copied.
4. **Point FleetHub at it, then lift the freeze.** Start the external Infisical. Make the saved API URL resolve to the external instance from FleetHub's container. Set `INFISICAL_URL` in `runtime/runtime.env` to that same URL, keep its origin in `FLEETHUB_ONBOARDING_ALLOWED_ORIGINS`, and keep the existing machine identity unless you deliberately replace it. Only then run `compose up -d fleetdeck inventory-worker`. Do not start the bundled `infisical` again.
5. **Verify through FleetHub.** On the Infisical step, **Verify** must pass: it creates, reads back and deletes a probe secret in the saved scope. Then scan at least one account whose credential is in Infisical. That confirms the web app and the inventory worker can both open existing references.
6. **Stop the remaining bundled services and keep the volume.** Run `compose stop infisical-redis infisical-db`. `infisical_pg_data` is left as it is.

## Rollback

The bundled volumes were never changed, so rollback means restarting on them:

```sh
compose up -d cli-proxy-api        # re-runs the one-shot ownership step first
compose up -d infisical            # its PostgreSQL and Redis start as dependencies
```

Restore the previous `runtime.env` values, and in **Setup connections** set the saved URLs back. If Infisical step 4 changed DNS or proxy routing for the saved API URL, restore that routing to the bundled `infisical` service before anything else, because the URL itself did not change. Then run **Verify** again and confirm it reached the bundled instance, for example by stopping the external instance first. A pass against the external instance proves nothing about rollback. Writes made only to the external instance during the overlap are not copied back. OAuth tokens that the external CLIProxy refreshed may leave the bundled copy stale. If that happens, log in again in its Management Center. If you upgraded since the pre-change setup, keep `CLIPROXY_UID`/`CLIPROXY_GID` in the env file (see [self-onboarding](23-self-onboarding.md)). `scripts/verify-cliproxy-nonroot.sh` exercises the ownership step on a disposable project, not on your volumes.

## Retirement

- **Volumes.** Delete bundled volumes only as a separate, explicit step after a verification period you choose, and only once the owner has confirmed it. By then, confirm the external instance has its own tested backups and that the `/path/to/backup` copies have been restored somewhere successfully. Deletion is irreversible. Name each volume individually, for example `docker volume rm <project>_cliproxy_auth`, and never as part of a migration command.
- **Profiles.** The `cliproxy`, `infisical` and `integrations` profiles, the `cli-proxy-api-volumes` step and the volume declarations stay in `compose.yml` until this runbook has been exercised end to end and its status line above records that. Removing them requires a separate reviewed compatibility change with release notes. No removal date is set.
