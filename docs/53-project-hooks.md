# Project hooks: needs and usage (built 2026-11-05)

Part of [docs/52](52-projects-needs-usage-and-gitops.md). Recommend-only: nothing here reserves, starts, stops or changes a resource.

## Tables

`projects`, `project_keys` (hash only), `project_needs`, `project_usage_reports`, `project_resource_links` (source `declared` now; `inferred` and `gitops` arrive with the GitHub connector). All created idempotently in `src/lib/db/bootstrap.ts`.

## Operator API (session or admin key)

- `GET /api/projects`: list with link, need and key counts and last usage time.
- `POST /api/projects`: `{slug, name, repoUrl?, environment?, criticality?, notes?}`. Slug is lowercase letters, digits, dashes.
- `POST /api/projects/keys`: `{projectId, expiresInDays?}` returns the key once (`fhp_...`). `DELETE /api/projects/keys?id=pkey-...` revokes.

## Hook API (project key)

Both endpoints require `Authorization: Bearer fhp_...`, `X-FleetHub-Timestamp: <ISO time within 5 minutes>`, and `Idempotency-Key`. The project comes only from the key; a body can never name another project. Bodies are strict schemas (unknown keys rejected) with an 8 KB limit; 120 requests per minute per project (Redis when configured, per process otherwise; a failing shared limiter denies).

```bash
curl -sS -X POST "$FLEETHUB/api/hooks/needs" \
  -H "Authorization: Bearer $FLEETHUB_PROJECT_KEY" \
  -H "X-FleetHub-Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -H "Idempotency-Key: ci-2026-11-05-1" -H "Content-Type: application/json" \
  -d '{"kind":"database","purpose":"primary database","spec":{"storageGb":5}}'
```

- `POST /api/hooks/needs`: `{kind, purpose, spec?}`. Answers `{id, duplicate, recommendation, accepted:true, executed:false}`. The recommendation lists up to three free-tier candidates (billable ones are excluded; unknown billing is flagged) or `none_free`. Every candidate says capacity fit is unverified.
- `POST /api/hooks/usage`: `{resource, amount?, unit?, periodStart, periodEnd, metrics?}`. `resource` is a FleetHub resource id or its native id. Accepted without any prior need. A matching resource gets a `declared` link kept fresh; an unknown reference is stored with no resource, so undeclared use is visible instead of rejected. Answers carry `trust: project_reported_unverified`.
- A retry with the same key returns 200 with the original result; the same key with a different body returns 409.

## Deviation from the original capacity design

The original capacity design planned HMAC signatures with a per-source secret "stored hashed". HMAC needs the raw secret, so hash-only storage cannot verify it. This slice uses a hashed bearer key (same model as agent keys) plus the timestamp window and idempotency key. Request-body signing can be added later by storing the secret in the secret store; it is not needed to prevent a forged body when the transport is HTTPS (Tailscale).

## Dashboard and agents (built 2026-11-05)

- `GET /api/projects/footprint` (read-only; `?project=slug` for one): footprints, orphans (resources no project links to) and the resource to projects map. A project with no usage reports shows `never`; one that stopped for 7 days shows `stale`, never zero.
- Projects tab: register a project, issue and revoke keys (key shown once, curl examples use placeholders), footprint cards with attention reasons, Orphans and idle. Resource drawer on the Fleet Map shows "Used by".
- MCP (read-only, 8 tools now): `find_free_capacity {kind, providers?}` and `get_project_footprint {project?}`. Declaring a need is deliberately not an MCP tool; projects post to the hook so MCP stays read-only.

## Not built yet

Outbound `needs.decided` webhook, leases and allocations, a Project filter in the filter bar, inference and GitOps (docs/52 build order, steps 5 to 7). `/api/hooks/*` bypass the session proxy by design; the routes authenticate themselves (`src/proxy.ts`).

## Tests

`tests/project-hooks.test.ts` (schemas, auth, replay window, rate limit, independence of needs and usage, project scoping) and `tests/projects.integration.test.ts` (PostgreSQL: slug uniqueness, key lifecycle, concurrent idempotency, free-tier-only recommendations, usage links).
