# FleetHub execution plan, 16-29 November 2026

> Planning destination: move verified remaining journeys, epics and stories into Linear. This dated plan is migration input, not a parallel live backlog. Preserve stable contracts and verify imported issue links before pruning planning prose. See docs/64.

> Personal-use clarification: prioritize compute, storage, object storage and CDN across personal and authorized family accounts. The user decides; FleetHub collates and compares. Company-specific terms approval and compliance workflows are out of scope.

> Direction update, 2026-11-15: [resource advisor and replaceable integrations](64-resource-advisor-and-integration-boundaries.md) takes precedence over conflicting priorities below. Prove the core account/resource/capacity/service-relationship journey first. Generic AI endpoints and retirement of bundled gateway profiles are target work, not implemented behavior. Existing security and migration gates remain unchanged.

The public-main SHA and PR references below are historical planning evidence, not this checkout’s current release checkpoint. N4/N5 outbound delivery now follows the core comparison/evidence work in docs/64. No remote refresh or release acceptance is implied.

Status: prepared plan, not a claim of release acceptance. This plan audits the
existing roadmap and proposes a bounded order for the next ten working days.
It does not authorize infrastructure mutation or expand FleetHub into an executor.
If fewer days are available, finish week one before starting week two.

## Read first

1. [Scope and guardrails](01-scope-and-guardrails.md).
2. [Repository and release workflow](63-repository-and-release-workflow.md).
3. This plan, then only the capability documents listed in the chosen task.
4. [Reuse-first decisions](60-reuse-first-onboarding-and-ux-plan.md) and
   [completed delivery evidence](61-reuse-first-delivery-tasks.md) when needed.

Baseline: public main `b7e032b`, including public PR #12. The original private
reconciliation contains the same application tree plus CI-only runner changes.
The documentation audit is based on source and tests, not a fresh authenticated
runtime acceptance pass. Refresh the public baseline before implementation.

R0-R10 are implemented. Do not reopen them because an older design paragraph says
"missing", "today", or "pending". The most useful next work is proving the current
operator journey, closing evidenced defects and defining the remaining delivery
contract before adding more providers.

## Source-of-truth order

- Scope and policy: docs/01 and approved decisions in docs/60.
- Current API behavior: source schemas/routes, tests and the capability runbook.
- Next work: this file. Historical milestones M1-M4 are themes, not sprint status.
- Implementation evidence: a dated record tied to a SHA, with limits stated.
- Live rollout state: private operator evidence, never inferred from a merged PR.

If code and documentation disagree, record the discrepancy and inspect the tests.
Do not silently implement the older prose or weaken a safety check to match it.
Each PR must update the relevant capability doc and the task evidence together.

## What exists and what does not

| Journey / epic | Implemented evidence | Remaining boundary |
| --- | --- | --- |
| Install and connect | Independent profiles, built-in store, Infisical references, persisted skips; `src/lib/onboarding`, `src/lib/vault`, docs/23, 39, 45 | Built-in master-key rotation and automatic backend migration absent; bootstrap recovery stays outside the vault |
| See accounts and resources | Five collectors in `src/lib/inventory/collectors.ts`, OCI collector, identity hierarchy, resource profiles, docs/48, 51 | GitHub inventory is not implemented; an App token for GitOps is not a collector |
| Explore and attribute | R7 shared details/filters, project scope in `src/lib/projects/fleet-scope.ts`; docs/52 | Full authenticated live browser acceptance remains incomplete; fixture results are narrower |
| Trust freshness and diagnostics | Inventory snapshots, probe connector, redacted diagnostics, schedules and leases in `src/lib/connectors`; docs/56, 58 | Not universal service health, desired/live drift detection, or automatic removal of vanished scheduled placements |
| Record needs and usage | Independent authenticated hooks, idempotency, recommendations in `src/lib/projects`; docs/53 | No outbound decision delivery, exclusive reservations or capacity allocation engine |
| Read desired state | GitOps parsing/inference, GitHub App authorization; `src/lib/gitops`, docs/54 | No repository writes, automatic PR proposals or cluster mutations |
| Measure usage | Host/project Prometheus readings in `src/lib/projects/measurements.ts`, `src/lib/capacity/host.ts` | Declared requests are not observed CPU load; provider billing/quota meters remain incomplete |
| Ask from an agent | Nine read-only tools in `src/lib/mcp/tools.ts`, local stdio adapter in `src/mcp`; docs/35 | No write tools, hosted HTTP/OAuth transport or account-scoped grants |
| Add external facts | Strict, expiring reports in `src/lib/observations/report.ts`; docs/27 | Reports cannot create resources or change authoritative inventory |
| Act on resources | Non-executable plans only, `src/lib/enrollment/plan.ts`, `src/lib/distribution/dispatcher.ts` | No SSH, start/stop, provisioning, approvals-as-execution or M3 actuator |

Provider fetch prompts already exist in `src/lib/providers/prompts/index.ts`.
Their JSON output is a manual report, not the `/api/observations` schema. Do not
post it there or promise an `inventory_supplement` ingestion capability.

## Ten-day order and dependencies

| Window | Item | State / size | Depends on | Result |
| --- | --- | --- | --- | --- |
| Day 1 | N0 Repository and documentation alignment | Prepared in this documentation change / S | Public baseline verified | One public contribution target and current reading order |
| Days 1-2 | N1 Re-establish release evidence | Ready / S | N0; current checks finish | Exact-head CI/review inventory and clear blocked checks |
| Days 2-4 | N2 Authenticated acceptance of core journeys | Ready / M | N1 local baseline | Repeatable disposable-data checks and defect list |
| Days 4-5 | N3 Fix only confirmed acceptance defects | Conditional / S per defect | N2 reproducer | Small reviewed fixes, with matching regression evidence |
| Days 6-7 | N4 Outbound decision contract | Ready for design only / M | N2; needs/usage behavior understood | One reviewed contract and threat model; no sending yet |
| Days 8-10 | N5 First outbound delivery slice | Blocked on N4 contract acceptance / L | N4 decision record and review | At most one event, with durable worker delivery and failure tests |
| After N2, if N5 is not ready | N6 GitHub inventory discovery brief | Ready for research only / S | N0 | Exact official API/permission/coverage proposal, no collector code |

These are working-day budgets, not delivery guarantees. N5 must be split into
small sequential PRs after its contract is agreed. Never fill spare time with M3
execution. If N2 reveals a serious auth, data-loss or provenance defect, fix and
verify that first and move week-two feature work out.

## N0: repository and docs alignment

Read docs/63. Confirm the public repository's default branch, current main SHA,
protections and open PRs. Use a clean public checkout for subsequent product work.
Do not rename remotes in another active task or publish private history.

Acceptance: README and docs index point here; obsolete pending claims are corrected
or explicitly historical; every public relative link resolves; no private journal
is required to understand a task. The audit inventory below identifies remaining
limitations rather than claiming every future product capability is documented.

## N1: establish the release baseline

Source: `.github/workflows/ci.yml`, `.nvmrc`, `package.json`, docs/63.

1. Fetch public main, record SHA and clean status. Record the current PR head too.
2. Inspect all six CI results and CodeRabbit review coverage at that exact head.
   Treat old-head passes and skipped reviews as insufficient. Do not bypass gates.
3. Run local checks below where prerequisites exist. A skipped database suite is
   not an integration pass. Record why any command could not run.
4. Write `docs/verification/YYYY-MM-DD-release-baseline.md`, using public-safe
   identifiers and bounded evidence. Test counts belong to this record, not a
   timeless guarantee in the README.

Acceptance: every gate is passed or explicitly blocked; no hidden billing/runner
failure is described as a code failure. Merge only when all required gates pass.
No production deployment or migration is part of this task.

## N2: authenticate and prove the core journey

Source: docs/23, 35, 45, 52-54, 56, 58; `scripts/verify-setup-ui.mjs`,
`scripts/verify-fleet-ui.mjs`; corresponding route/service tests.
Use disposable PostgreSQL and synthetic credentials only. Existing browser fixture
scripts intercept APIs and exercise actual components, but do not prove a real
session or database round trip. Add separate disposable-app integration/browser
evidence for that gap; preserve the fixture coverage rather than relabeling it.

| Case | Required observable result | Existing starting points |
| --- | --- | --- |
| First operator and sessions | Bootstrap closes after first operator; logout/revocation denies old sessions; invalid/read-only credentials cannot mutate | `tests/auth-routes.test.ts`, `tests/sessions-database.integration.test.ts` |
| Backend readiness | Built-in verify enables credential storage; optional skips persist; one edit does not reset another verified connection | `tests/builtin-vault.integration.test.ts`, `tests/onboarding-database.integration.test.ts`, setup fixture |
| Provider collection | Pending account becomes enabled only after success; failed/permission-limited/empty scan preserves the correct snapshot | `tests/inventory-database.integration.test.ts`, `tests/inventory-service.test.ts` |
| Shared views | Same selected project/search/problem filter across Resources, Fleet Map and identities; selection and keyboard focus behave at 320/390/1280 px | fleet fixture, `tests/fleet-filters.test.ts`, `tests/project-view.test.ts` |
| Hooks and GitOps | Needs/usage independent; retries stable; other-project access denied; confirmed links scoped correctly | `tests/project-hooks.test.ts`, `tests/projects.integration.test.ts`, `tests/github-authorization.integration.test.ts` |
| Connector scheduling | Schedule persists; scoped key queues a scan; worker handles it once, preserves other placements and does not revive archived projects | `tests/connector-schedule-api.test.ts`, `tests/connector-schedule.integration.test.ts` |
| Trust and agent access | Unknown quotas stay unknown; stale measurements labelled; nine MCP tools read only; failures are error results | `tests/project-measurements.test.ts`, `tests/mcp-server.test.ts`, `tests/mcp-stdio.test.ts` |

Record expected, observed, fixture/live-disposable/blocked, SHA, command and evidence
location for each row. Sanitized summaries may be committed; raw reports and
screenshots belong in ignored `reports/`. Do not use a live owner's database,
OAuth account or credential to manufacture acceptance. If external provider access
is unavailable, mock that boundary and state the limit.

Acceptance: every row has explicit evidence or a bounded blocker. A confirmed
defect needs a minimal reproducer, affected path, impact and expected behavior.
No new UI design or product feature is required to complete an evidence report.

## N3: small fixes from evidence

One PR per coherent defect. Start with the N2 reproducer; name the exact allowed
files and add a regression that fails before the fix. For UI changes, load exactly
one owner design skill from AGENTS.md and check installed Next.js docs before
framework changes. For database changes, preserve the existing idempotent bootstrap
and concurrency guarantees; test on disposable PostgreSQL.

Acceptance: reproducer passes, related regressions pass, required CI and actual
review pass, capability doc reflects behavior. No test may hide assertions in a
mock exception that production code catches. Stop if fixing the defect would
require a new authorization model or feature contract; document that as separate
work rather than expanding the PR.

## N4: outbound decision contract, design only

Current need handling returns a recommendation synchronously and stores it in
`src/lib/projects/store.ts`. It does not send events. Hash-only inbound project
keys in `src/lib/projects/keys.ts` cannot be recovered to sign outgoing messages.

Write a bounded design under `docs/planning/outbound-decisions.md`. It must settle:

- One initial event: `needs.decided`, representing a stored recommendation with
  `allocated:false`, `executed:false`. No `allocation.changed` event until an actual
  lease lifecycle exists. No existing inbound response or auth contract changes.
- Who configures/revokes the endpoint and signing credential, and where each is
  stored. Reuse the verified secret-backend interface; never reuse the hashed
  inbound key as recoverable signing material.
- Versioned envelope, event ID, project/need identity, occurred-at time, minimal
  payload, exact signature bytes/headers and receiver replay/deduplication rules.
- Transactional outbox insertion alongside a new need; an idempotent retry must not
  enqueue another logical event. At-least-once delivery with a stable event ID,
  not an exactly-once promise.
- Worker ownership, bounded requests, atomic claims/leases, crash recovery,
  timeouts, maximum response/body size, retry/backoff and terminal failure policy.
  Keep sending out of request handlers and never execute receiver responses.
- HTTPS destination allowlisting, no URL credentials or redirects, DNS/IP checks
  at connection time, blocking metadata/private/loopback addresses unless a
  separately reviewed explicit private-destination policy is chosen. Existing
  user-supplied URL helpers are not proof against DNS rebinding.
- Endpoint edits, credential rotation, disconnect/archive behavior for pending
  events, retention, redacted diagnostics and operator recovery controls.
- Exact API schemas, table/index migration, size limits, test matrix and rollback
  plan. Queue workers must tolerate rolling upgrades and disabled delivery.

Acceptance: every bullet has a concrete choice, an invariant and a test. An
independent security/design review resolves objections before N5. If a choice is
unresolved, mark N5 blocked and keep the current synchronous recommendation path.
This document makes design work ready; it deliberately does not invent a public
outbound API that a smaller model might implement prematurely.

## N5: delivery after the contract is accepted

Split work into (a) storage/configuration and transaction tests, (b) worker sender
and failure/retry tests, (c) operator diagnostics/documentation. Each brief copies
the approved N4 schemas, constants and allowed files, rather than referencing an
unsettled proposal. Start from `src/lib/projects/store.ts`, `src/worker/inventory.ts`,
`src/lib/db/bootstrap.ts`, existing vault interfaces and connector claim patterns;
do not create a second worker scheduler without demonstrating why it is necessary.

Required failure tests: duplicate/concurrent inbound needs, transaction rollback,
worker crash before/after response, duplicate delivery, timeout/429/5xx/4xx policy,
redirect, private/metadata IP and DNS change, wrong/revoked key, endpoint change,
archived project, unavailable vault/database and redacted logs. Assert no HTTP
calls from inbound routes and no event when delivery is disabled/unconfigured.

Done means required checks plus receiver tests pass with disposable endpoints;
real deployment remains separately verified. If this cannot fit three days safely,
ship only reviewed preparatory work with sending disabled and mark customer use
blocked. Do not claim the whole event system shipped.

## N6: GitHub collector discovery if feature delivery is blocked

Read `src/lib/inventory/collectors.ts`, `src/lib/gitops/github-authorization.ts`,
`src/lib/inventory/model.ts` and docs/54. Produce a read-only contract from current
official GitHub API documentation, with URLs and checked date. Start with repository
metadata only. Actions usage, runners, packages and billing require separate
permissions/coverage decisions; do not bundle them into a first collector.

Specify account scope, supported credential type and owner, minimum permissions,
pagination/call and size budgets, stable native IDs, partial permission handling,
rate-limit/retry behavior, redaction and test fixtures. Decide explicitly whether
operator-bound GitOps authorization can serve a background account collector;
do not borrow it silently. No token or OAuth UI is built in this research task.
Acceptance: one small implementation brief and unresolved decisions, with no
claim that the existing GitOps reader is missing or that quota usage is measured.

## Common commands and evidence

Use Node 24.22.1 from `.nvmrc`. Do not upgrade the stack as incidental sprint work.

```bash
npm ci
npm run check:hygiene
npm run check:dependencies
npm run typecheck
npm test
npm run build
npm run build:mcp
npm run verify:inventory
```

`verify:inventory` requires `initdb`, `pg_ctl`, `createdb`; it creates its own database,
runs the integration-enabled suite/builds and cleans up. It does not use a live
`DATABASE_URL`. Do not substitute an owner's database if tools are missing.
Run checks serially when builds share `.next` or tests share a database. For a small
fix, start with the affected test files, then run the required suite and CI once.

After a build, run `npm run verify:setup-ui` and `npm run verify:fleet-ui` with the
optional Playwright package/browser available. `FLEETHUB_PLAYWRIGHT_MODULE` accepts
an installed module path and `FLEETHUB_BROWSER_CHANNEL` an available browser channel.
Missing browser tooling means blocked evidence, not a product failure. These
scripts use fixture APIs and are not a real OAuth or production acceptance pass.

Evidence record fields: baseline/head, task ID, expected behavior, exact commands,
results and skip counts, fixture boundaries, defects, review findings/disposition,
remaining blockers and whether the result is prepared, merged or customer-usable.
Use [the testing-only brief](prompts/testing-only-agent.md) for delegated QA.

## Brief for a smaller model

Copy this and fill every bracket before starting. Do not hand over the full roadmap
as an undifferentiated implementation request.

```text
Work on task [N-ID / one subtask] from docs/62-next-two-weeks.md.
Canonical repo: easemyhosting-com/fleethub; baseline [public main SHA].
Read AGENTS.md, docs/01 and [specific capability docs].
Goal: [one observable behavior or evidence artifact].
Allowed files: [explicit paths]. Dependencies already satisfied: [evidence].
Do not change: [auth/policy/secret handling and unrelated capabilities].
Acceptance cases: [copy the relevant table or approved N4 contract verbatim].
Run: [focused commands], then [required validation]. Use disposable data only.
Write/update: [capability doc and dated evidence record].
Stop and report if the baseline differs, a contract is undecided, tooling is
missing, or a change requires new permissions. Do not invent endpoints or bypass
checks. Return changed files, evidence, review findings and remaining blockers.
```

Ready tasks have inputs, allowed files, outputs and an acceptance oracle. Design
or security decisions in N4/N6 need a stronger review; a smaller model can execute
a concrete approved slice afterward. If only docs change, check links, hygiene,
whitespace and required CI; do not add tests that merely restate prose.

## Deferred work and evidence that could change the order

| Work | Decision | Start gate |
| --- | --- | --- |
| Cloudflare/other provider usage meters | Defer implementation this sprint | Official API scope/unit/window contract and fresh supported samples; unknown quota remains unknown |
| Full health/drift and resource relationships | Extend later | N2 establishes a real gap beyond existing probes/connectors and freshness |
| Built-in master-key rotation/backend migration | Separate security design | Recovery requirement and migration/rollback design; no opportunistic secret rewriting |
| Account-scoped agent keys, observation retention | Backlog | Specific access/retention requirement and compatibility contract |
| MCP HTTP/OAuth and hosted clients | Defer | Explicit client demand and reviewed authentication/transport design |
| Greptile installation | Optional owner decision | Explicit authorization; existing seven checks suffice |
| Reservations, actuator, SSH, provisioning, GitOps writes | Defer | Separate M3/M4 approval and security gates in docs/25 |
| New datastore, multi-tenant SaaS, UI rewrite | Reject for this window | Measured need and a separate scope decision |

Use GitHub Issues/PRs in the public repository for work status. A new tracker or
migration to another service is unnecessary for this window. Do not create issues
from this proposal until the task boundaries are accepted. `Prepared` means the
brief is implementable; `customer-usable` requires passing gates and verified
runtime behavior. A checkbox for code alone proves neither.

## Review limits and decisions still needed

No fresh live provider scan, authenticated browser session, deployment, restore or
credential migration was performed for this documentation audit. Existing evidence
is dated and scoped. Provider pricing/terms and catalog figures were not revalidated;
retain their verification flags. GitHub repository/protection metadata was checked
on 2026-11-15. Dependabot security updates are disabled in the public repository;
this is distinct from dependency alerts, audit CI and Renovate configuration.
Do not claim automatic security PRs are enabled.

Decisions that affect week two: accept N4's eventual contract; choose the first
real receiver and permitted destination policy; confirm whether N6 is the fallback
priority. Until decided, N1-N3 can proceed and N5 cannot. This plan does not require
another answer to perform the already-authorized documentation work.
