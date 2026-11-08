# FleetHub

Self-hosted inventory and capacity tracker for the free and paid cloud resources you legitimately hold, built with Next.js and PostgreSQL. Register accounts and manual resources, collect read-only provider metadata, track allowances, usage and expiry, and share the same stored inventory with agents. Unknown usage is never shown as zero, and provider account rules stay in force: FleetHub does not create accounts or evade quota limits.

Use Node.js 24.22.1, as specified in `.nvmrc`. Run `npm ci`, then `npm run dev`. Run `npm test`, `npm run typecheck`, and `npm run build` before shipping changes.

## Start a local installation

First-time users get a short guided tour when the dashboard opens; reopen it any time from **Guided tour** in the sidebar.

Start with the [documentation guide](docs/README.md) and the current [reuse-first onboarding and UX plan](docs/60-reuse-first-onboarding-and-ux-plan.md). Existing-service connection is the preferred path; local integrations start only when explicitly requested.

Follow [self-onboarding](docs/23-self-onboarding.md) for an existing-instance or bundled setup. The generated Compose configuration includes a separate read-only inventory worker. OCI has a read-only collector and remains protected from workload execution. No SSH or infrastructure execution is enabled.

For local development with your own PostgreSQL and configured integrations, run `npm run build:worker`, then `npm run worker` in a second terminal alongside `npm run dev`. The web process never runs cloud inventory collectors.

`npm test` runs the unit suite. `npm run verify:inventory` additionally creates and removes a disposable PostgreSQL instance, exercises the real SQL workflow, and verifies the production build. It requires Node 24 and PostgreSQL development tools on your PATH. It never uses your configured DATABASE_URL.

The isolated setup UI check, `npm run verify:setup-ui`, uses optional Playwright tooling and synthetic API fixtures after a build. See [the verification record](docs/verification/2026-11-08-reuse-first-batch.md) for prerequisites and coverage.

Local Docker writes are kept low by default; see [low-write Docker notes](docs/34-low-write-local-docker.md).

## Production configuration

Set `DATABASE_URL`, a dedicated random `FLEETHUB_AUTH_SECRET` of at least 32 bytes, and `FLEETHUB_APP_URL` to the exact browser origin. Set `FLEETHUB_AUTH_REQUIRED=true`. Generate secrets locally, for example with `openssl rand -hex 32`; do not reuse the API key as a signing secret.

For first setup, configure a separate random `FLEETHUB_BOOTSTRAP_TOKEN` of at least 32 bytes. The Access & Auth dialog accepts this installation token when creating the first operator. Registration closes when any user exists. Remove the bootstrap token after setup. Existing accounts cannot be reset through registration. The former environment-admin password fallback has been removed.

Google login requires client credentials and `FLEETHUB_ALLOWED_EMAILS`. Every login checks the allowlist, verified Google email, browser-bound single-use OAuth state, and PKCE. Production requires a canonical `FLEETHUB_APP_URL`. Reverse-proxy identity requires a separate `FLEETHUB_PROXY_AUTH_SECRET`, the matching `X-FleetHub-Proxy-Secret` header, and an allowlisted email. The ingress must strip caller-supplied identity headers and prevent direct access.

An optional `FLEETHUB_API_KEY` grants administrative API access. `FLEETHUB_READONLY_KEY` permits reads and the MCP planning protocol. Never embed either key in browser code. Session-authenticated writes require the canonical browser Origin. Logout clears the browser cookie; copied session tokens remain valid for up to seven days or until the signing secret is rotated. Persistent session revocation remains unfinished.

Production outside local mode shares its request limits through FleetHub's own PostgreSQL, so replicas need no extra service. Requests fail closed if the limiter cannot reach the database. Local mode uses an in-memory limiter. Set `FLEETHUB_RATE_LIMIT_SECRET` consistently across replicas. Forwarding headers are ignored unless `FLEETHUB_TRUSTED_IP_HEADER` explicitly selects a trusted ingress header.

Open **Setup connections** to configure independent connections. Credentialed registration requires either a verified Infisical scope or the built-in encrypted store. Tailscale and CLIProxy are optional and do not gate provider inventory. Infisical credentials use structured references in PostgreSQL; the built-in backend stores encrypted values in PostgreSQL with its master key outside the database. Supported management API accounts queue a read-only inventory scan; the separate worker enables them after a complete success. Unsupported providers remain manual. Inventory-only registration is available before setup is ready. Saving setup settings does not delete or migrate existing stored credentials.

Synthetic plugin telemetry now requires explicit fixture mode. Catalog limits are not measured usage, and unknown usage is not zero. OCI targets are excluded from workload placement. Dispatch returns plans; it does not execute workloads.

Optional Compose profiles are independent: `infisical` includes its dedicated database and Redis; `cliproxy` includes persistent auth storage. Both keep digest-pinned images. The legacy `integrations` profile explicitly enables both stacks. `node scripts/prepare-local-setup.mjs` creates private one-time setup files without overwriting an existing install. The helper and setup UI never start containers. Startup alone does not verify credentials, permissions or migration readiness. See [the self-onboarding guide](docs/23-self-onboarding.md).

New installations should use the built-in encrypted store or connect an existing Infisical. The bundled Infisical profile is deprecated, with commands and volumes retained for compatibility. See the [migration and retention guidance](docs/23-self-onboarding.md#bundled-infisical-deprecation).

See [setup tiers and the built-in store](docs/45-setup-tiers-and-builtin-secret-store.md) and [the reuse-first plan](docs/60-reuse-first-onboarding-and-ux-plan.md).

## Safe assisted orchestration

The [operating model](docs/25-safe-orchestration-operating-model.md) defines guided enrollment, optional future SSH assistance, vault ownership, and LLM approval boundaries. A new `/api/host-enrollment/plan` endpoint and `plan_host_enrollment` MCP planning tool return proposals only. They do not connect to hosts, fetch SSH keys, or install software. The current MCP bridge is not universal transport/OAuth support for every client.

## Standard MCP (local stdio, read-only)

`npm run build:mcp` bundles a standard MCP server that speaks stdio using the official SDK. Configure a client to run `node build/mcp-stdio.mjs` with `FLEETHUB_URL` (default `http://localhost:3060`; https or loopback http only) and a per-agent key from **Agent access** in `FLEETHUB_READONLY_KEY` (the shared `FLEETHUB_READONLY_KEY` from your setup also works). It exposes the six read-only tools, relays calls to the authenticated `/api/mcp` bridge, and reports any failure as an error result rather than empty inventory. It has no write, refresh, SSH or execution tools. Streamable HTTP transport and MCP OAuth are not implemented. See [connecting agents](docs/35-connect-agents-to-mcp.md) for Claude Code, Codex and T3 Code setup. The bundle needs `node_modules`, so it is not part of the Docker image.

## Agent context

`GET /api/agent-context` and the `get_fleet_context` bridge tool report registered inventory, setup readiness, credential-reference metadata, protection rules, unknowns, and connection guidance. They do not probe hosts or retrieve secrets. See [the minimum context contract](docs/26-agent-context-contract.md). External agents can submit structured, unverified reports through [observation writeback](docs/27-observation-writeback.md), using a dedicated reporting credential. Reports never change inventory or permissions.

## Maintenance

Direct dependency versions are exact and must have been published at least 48 hours before selection. `npm run check:dependencies` verifies the lockfile and release ages. `node scripts/update-dependencies.mjs` selects mature releases within the current major versions, then `npm install` refreshes the lockfile. Review and test those updates. Renovate configuration applies a two-day waiting period to future updates when Renovate is enabled for the repository.

CI runs PostgreSQL integration tests in a disposable database, tests with coverage, TypeScript checks, a production build, dependency audits, CodeQL, secret scanning, and container vulnerability scanning. It runs on pull requests, pushes, and a weekly schedule. CodeQL needs a code scanning upload target: private repositories without GitHub Advanced Security still analyze the code and print a findings summary, and start uploading SARIF once the `CODEQL_UPLOAD` repository variable is set to `true`. GitHub Actions must be enabled before these jobs can run remotely.

Generated files, local inputs, environment files, caches, and reports are ignored by Git. Docker uses an allowlist containing only application build inputs. `npm run check:hygiene` checks the visible root files and rejects generated or sensitive paths.

## License

FleetHub is licensed under [Apache-2.0](LICENSE). Optional services and dependencies retain their own licenses.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
