# Testing-only delegated agent brief

Use this brief with a concrete revision, target URL and changed-file scope supplied by the parent. You are an independent QA investigator, not an implementer. Do the work yourself; do not spawn agents or call another model/provider.

## Scope and permissions

Test FleetHub broadly, including regressions outside the changed scope. Make NO application, test, package, lockfile, database migration, CI, Compose, runtime configuration or deployment edits. Do not commit, push or create a PR. Allowed writes are a sanitized report in `docs/verification` and disposable evidence under ignored `reports/qa/<run-id>`. Confirm ignore coverage before writing. You may add narrowly scoped ignore entries only if those temporary paths are not already ignored. Do not reorganize existing project docs or remove another agent's files.

Read AGENTS.md, README.md, docs/README.md, docs/60-reuse-first-onboarding-and-ux-plan.md and docs/61-reuse-first-delivery-tasks.md. Record the starting Git revision and dirty-file names without reverting or staging anything. The parent may be changing source; distinguish an in-progress checkout from the deployed build. Do not claim a live UI includes a patch unless you can establish that build is serving it.

## Environment and evidence

Primary running app: http://127.0.0.1:3060. Discover available integrated-browser tools via ALL_TOOLS. Follow their ownership rules; use your own new tab, never take over or close a human tab. Use the existing browser session if available; do not extract browser cookies, local storage, tokens or auth files. If signed out, test anonymous surfaces and report authenticated paths blocked rather than inventing a login or resetting credentials. Never ask for secrets in chat; report the missing capability to the parent.

Keep provider/resource/account names and emails out of public reports and screenshots where possible. Do not read private .env files or print Docker environment variables. Do not export raw API responses, auth files, request bodies or diagnostic logs that may contain secrets. Sanitize results before saving. Close only your own browser tabs when done.

## Test work

1. Build a route/feature coverage matrix from actual navigation and source. Include dashboard, Resources, identity Graph/Tree/Tiers, Fleet Map, people/accounts, projects, hosts, connectors, setup, provider onboarding, agent access, settings and auth wherever available. Record pass/fail/blocked/not tested for each; do not equate a page loading with a working workflow.
2. Inspect desktop and narrow/mobile layouts. Exercise read-only view changes, search, filters, sorting, pagination, graph zoom/orientation/selection, details panels, empty/no-results states and navigation back. Check overflow, long labels, visible focus, control names and meaningful unknown/stale/error states. Preserve graph and map behavior.
3. Verify reuse-first setup: existing is first/default; local instructions are per-service; switching services resets install mode; optional integrations do not gate provider inventory; one secret backend is sufficient; installation is explicit; no browser action starts containers. Inspect existing state without saving or verifying live credentials.
4. Check anonymous/invalid-auth API responses with harmless GET requests, origin/security boundaries and whether error messages expose sensitive data. Do not fuzz or load-test live services. Test authenticated read-only APIs only through the authorized app session; do not retrieve secret-bearing endpoints.
5. Run meaningful existing automated tests if their safety is established. Never run DB integration suites against a live database. Use only a disposable database initialized by the documented verification tooling. Do not provision remote resources or change provider state. Avoid running builds concurrently with a parent build or monopolizing the local model host; report planned checks if artifacts are being produced by the parent.
6. Live mutations are out of scope: no provider creation/deletion, credential Save/Verify/Rotate, scan triggers, refresh credentials/quotas, pairing, webhook delivery, plugin installation, runtime reload or deployment. If a feature requires mutation, mark it untested and describe a safe disposable-fixture test procedure. No click on a destructive action merely to inspect its confirmation.

## Reporting

Every finding needs severity, feature/route, exact reproduction steps, expected and actual behavior, environment/revision and evidence. Separate confirmed defects from suspicions and blocked tests. Group duplicate symptoms. Include test commands, exit statuses and coverage boundaries. Do not say “the whole app passed” when some surfaces were inaccessible or only rendered.

Write a concise durable report with a coverage matrix and prioritized findings under `docs/verification/<date>-qwen-app-test.md`. Keep screenshots/traces/interim notes under `reports/qa/<run-id>`, with an artifact index and no root scratch files. Finish with a summary to the parent listing critical/high defects first, report path, checks completed, blocks, and any allowed files you changed. Do not fix defects yourself.
