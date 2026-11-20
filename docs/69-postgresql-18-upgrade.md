# PostgreSQL 18 upgrade and rollback

This is a maintenance procedure for existing Compose installations. It has not been executed against an existing deployment. Fresh installations can use the current Compose file directly. Existing installations must complete this procedure before starting the app against the new volumes.

The PostgreSQL 18 Compose file uses `fleetdeck_pg18_20261119` and `infisical_pg18_20261119`, mounted at `/var/lib/postgresql`. PostgreSQL 16 used `fleetdeck_pg_data` and `infisical_pg_data`, mounted at `/var/lib/postgresql/data`. Starting the new file does not migrate data. Docker creates empty volumes if the new names do not exist. Keep the original project name and record the fully resolved volume names. Do not rename, delete or reuse the PostgreSQL 16 volumes with PostgreSQL 18.

## Before maintenance

- Arrange an approved maintenance window and inventory every writer, including workers, external clients and Infisical jobs. Stop if any writer cannot be paused.
- Retain the previous application image and Compose revision for rollback. Record database versions, project name, volume names and enabled profiles privately outside the repository.
- Preserve the original configuration and encryption keys through the deployment's existing secret-management process. Infisical requires its original encryption key and auth secret to read restored data. FleetHub also needs its existing secret-store key and authentication configuration. Never generate replacement keys for a restore or print their values.
- Rehearse a logical dump and restore into isolated disposable PostgreSQL 18 databases. Check application reads and authenticated access to existing encrypted credentials. Row counts alone do not prove that secrets decrypt.
- Ensure sufficient memory for Infisical's 2 GiB container limit plus both databases, the application and the host. Its fresh-database migrations previously failed under the 1 GiB limit. The larger limit does not prove that a restored deployment is healthy.
- Use a private backup directory outside the repository, with access restricted to the operator. Keep rehearsal backups separate from the final cutover backups.

## Final backup and restore

1. Enter maintenance mode and stop all application and worker writers using the **previous** Compose revision. Pause Infisical and its other clients if migrating its database. Leave the old databases running for the final dumps. Verify no remaining client can write; do not rely only on stopping the web container.
2. Take **new logical dumps after all writers have stopped**, using the PostgreSQL 16 databases and `pg_dump -Fc`. Record checksums and per-table counts from this quiescent source. Earlier rehearsal dumps are not cutover backups: writes made after them would be lost. If writes resume, repeat this step before proceeding.
3. Stop the old database services cleanly. Keep their volumes intact and offline for rollback. Select the new Compose revision, retaining the same project name and original secrets.
4. Start only `fleetdeck-db` and, when used, `infisical-db`. Do not start the app, workers or Infisical yet. Inspect the resolved mount names and wait for database health. Confirm each target is the intended empty PostgreSQL 18 database. If it already contains data, stop and investigate rather than restoring over it.
5. Restore each final dump into its matching target with `pg_restore --exit-on-error --no-owner --no-acl`. Use the matching database role and database name. Treat any nonzero exit as a failed restore. Keep services stopped until it is resolved.
6. Compare all restored table counts with the quiescent source manifest and verify expected schema objects. Record checksums and restore results privately. Start the required cache service before Infisical. Start the application and workers only for controlled validation while external writes remain blocked.
7. Verify database connectivity, expected schema bootstrap, authenticated application reads, existing credential decryption, worker health and Infisical readiness when used. HTTP 200 on the landing page and HTTP 401 without authentication are useful smoke checks, but insufficient migration acceptance criteria.
8. Reopen writes only after all validation passes. Record this acceptance point. Retain the old volumes and final dumps under the deployment's backup policy.

## Rollback

Before writes reopen, stop the new app, workers, Infisical and PostgreSQL 18 databases. Restore the previous application image and Compose revision with the same project name, original keys and original PostgreSQL 16 volumes. Verify their mounts before starting them. Validate health and authenticated reads before ending maintenance. Never attach a PostgreSQL 18 data directory to PostgreSQL 16.

After writes reopen, the old PostgreSQL 16 volumes are stale. Switching back would discard new writes. Stop writers and plan a separately validated data reconciliation or logical migration before rollback; do not assume PostgreSQL 18 dumps can be restored into PostgreSQL 16. Keep both datasets intact until recovery is verified.

A stale Infisical migration lock must be investigated with all migrators stopped. Do not automatically clear it in an existing deployment. Lock-reset experiments on disposable databases are not a production recovery procedure.

The gateway transition runbook in [docs/68](68-gateway-connection-only-transition.md) describes the older PostgreSQL 16 volume names. On an upgraded installation, discover the actual attached PostgreSQL 18 volume instead of copying its old name. Its one-shot tar helper does not select the database server version, and raw copies of running database volumes are not consistent backups.
