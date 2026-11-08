# External-agent observations

FleetHub accepts structured reports about registered resources without executing commands or changing authoritative inventory. An external agent can inspect a server using separately authorized tools, then submit what it observed. This endpoint does not grant SSH access, disclose credentials, alter protection policy, or approve work. OCI remains protected.

## Credentials

Set `FLEETHUB_OBSERVATION_KEY` to a separate random secret of at least 32 bytes and configure `FLEETHUB_AUTH_SECRET` with at least 32 bytes. The local setup generator supplies both for fresh installs; existing installations must add the reporter key explicitly. Never send this key to a model in prose: configure it in the agent client's credential store.

The reporter key authorizes only `POST /api/observations`. A separate read-only FleetHub key can read `/api/agent-context` and `GET /api/observations`. The administrator key and signed user sessions can also report; session writes require same-origin requests. Reporter identity is computed by the server, not accepted from the request. The shared reporter key identifies a credential, not a particular model or individual. Rotating the reporter/signing key changes that identity. Per-agent credentials and resource-scoped grants remain future work.

## Submit

Send bearer authorization, JSON content type, and an `Idempotency-Key` header containing 1–128 letters, digits, dots, underscores, colons or hyphens. The JSON body is limited to 16 KiB:

```json
{
  "resourceId": "registered-host-id",
  "source": "ssh_inspection",
  "observedAt": "2026-10-26T08:00:00Z",
  "expiresAt": "2026-10-26T09:00:00Z",
  "facts": {
    "connectivity": { "ssh": "reachable", "tailscale": "unknown" },
    "services": [{ "name": "nginx", "state": "healthy" }],
    "metrics": { "cpuPercent": 4, "memoryUsedBytes": 1048576 }
  }
}
```

Use current timestamps. Observations may be at most 24 hours old or 60 seconds in the future. Expiry must be future, later than observation, and at most 24 hours after observation. A retry must still satisfy these time limits.

Allowed sources: `ssh_inspection`, `provider_api`, `manual`, `external_agent`. These labels are reporter claims, not independently verified evidence. Facts may include `resourceState` (online/offline/unknown), connectivity for SSH/Tailscale/HTTPS (reachable/unreachable/unknown), metrics (CPU percentage, memory/disk used bytes), and up to 32 services (name and healthy/unhealthy/unknown state). At least one fact is required. Unknown fields are rejected. Do not submit secrets, raw logs, file contents, or identifying details as service names; structural validation cannot detect every secret encoded in an allowed string.

Responses: 201 for a new report, 200 for an identical retry, 409 when the same reporter/key identifies different content, 404 for an unregistered resource, 400 for invalid input, 413 for oversized bodies, and 503 for unavailable storage. The reporter/key pair is unique. Replays do not extend expiry. Idempotency compares the normalized schema output, including timestamps and service ordering.

## Read and limits

`GET /api/observations?resourceId=registered-host-id` returns at most the latest 100 reports, with server receipt time, reporter identity, observation time, expiry, and `current`/`expired` freshness. Omit the filter for recent fleet reports. All reports have `authoritative: false` and `trust: external_report_unverified`, including current reports. They never change resource state, placement policy, protections, or execution permissions. Authoritative inventory still comes from its existing collection path.

This is a small HTTP contract, not a new MCP execution tool or a full discovery system. Reports cannot create missing resources. There is no automatic retention cleanup or pagination yet; operators should account for database growth. The existing API write rate limit applies. The dedicated reporter credential is fleet-wide, so share it only with trusted clients.

## Verification (2026-10-26)

Node 24 typecheck and production build passed. The covered suite passed 245 tests (6 optional integration tests skipped), with 98.10% statements and 98.79% lines across the configured scope. Five new API tests cover credential scope, input rejection, retries, history and storage failures. A separate disposable PostgreSQL test passed eight concurrent identical submissions, conflict/unknown-resource rejection, and confirmed the protected Oracle fixture's inventory state and protection were unchanged. The disposable database was stopped afterward. Repository hygiene and diff whitespace checks passed. No live infrastructure was changed.
