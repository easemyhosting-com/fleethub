# Connector schedules and rescan hook

Automatic scans run in the inventory worker. Prometheus defaults to every 15 minutes; Kubernetes and Docker default to every six hours. Each connector's Projects panel offers manual-only, 15 minutes, hourly, six-hourly and daily schedules. The operator API also accepts `scanIntervalMinutes: null` to restore the default.

Automatic Prometheus scans record host and matching project usage. Cluster and Docker scans refresh registered, active projects and list newly discovered slugs for operator review. They never register new projects or revive archived ones. Because a connector sees only part of the fleet, these refreshes preserve other placements and resource links; they do not retire vanished placements or reconcile links. Explicit discovery/apply retains its existing reconciliation behavior.

The worker claims one due connector at a time using an atomic comparison and a ten-minute lease. A crashed claim expires. Requests received during a scan remain pending for a subsequent pass. Scans remain read-only toward providers and hosts.

## Flux or CI rescan trigger

Create a rescan key in the connector's schedule controls. Copy it immediately; only its SHA-256 hash is stored. Replace or revoke it from the same controls. Keys can request a rescan of their own connector only.

Send `POST /api/hooks/rescan` with `Authorization: Bearer <rescan-key>`. Its body is ignored. A valid key returns 202 and queues work; it does not synchronously scan. Missing or invalid keys return 401, rate limits return 429 and storage failures return 503. The process-local rate limiter allows 30 requests per minute per key, expires entries and caps its map at 4096 entries. It is not a distributed rate limiter.

A Flux notification-controller generic Provider can target the endpoint, with its Authorization header in the Provider's referenced Kubernetes Secret, and an Alert selecting the relevant Kustomizations. FleetHub must be reachable from that cluster. No Flux objects or remote configuration were installed by this change. Enter credentials through FleetHub and the owner's secret-management flow.

## Verification and recovery notes

- The original worker failure was `TypeError ERR_INVALID_ARG_TYPE` during its timestamp claim. Drizzle configures timestamp serializers on the shared postgres.js client; pass ISO strings explicitly cast to `timestamptz`, including the claim-completion timestamp. An isolated postgres.js-only reproduction misses this problem.
- Real disposable PostgreSQL tests cover timestamp serialization, active leases, requests during a scan, preserving another host's placement, archived projects and deleted projects. Unit tests cover scheduling, keys, hook responses and operator-only updates.
- Rebuilt both services and scanned live Kubernetes, Docker and Prometheus connectors successfully. No credentials were printed.
- CodeRabbit could not run the uncommitted review because its free CLI allowance was exhausted. Manual review found and fixed timestamp serialization, unsafe partial-discovery reconciliation, archived-project revival, concurrent claims and unbounded rate-limit storage.
- Shared browser automation timed out twice. Playwright opened the app but had no signed-in session, so authenticated Projects controls and `/hosts/borealis` remain unverified in the browser.
