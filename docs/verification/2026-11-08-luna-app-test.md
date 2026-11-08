# LUNA independent app QA

Date: 2026-11-08. Target: `http://127.0.0.1:3060`. This was a replacement independent pass using the current working tree, not an acceptance claim for every workflow.

## Revision and scope

Start and end revision: `7e9e0e32ddd78e41cdefe6ebf32dd71526fab3e9`. At both start and end, the same staged and unstaged paths were present: `LICENSE`; `README.md`; `docs/17-free-tier-catalog-schema.md`; `docs/23-self-onboarding.md`; `docs/60-reuse-first-onboarding-and-ux-plan.md`; `docs/61-reuse-first-delivery-tasks.md`; `docs/verification/2026-11-08-capabilities-and-diagnostics.md`; `docs/verification/2026-11-08-r8-r9-verification.md`; `package-lock.json`; `package.json`; `scripts/check-hygiene.mjs`; `scripts/verify-setup-ui.mjs`; `src/app/api/onboarding/cliproxy-capabilities/route.ts`; `src/app/api/onboarding/route.ts`; `src/components/CollectionDiagnostics.tsx`; `src/components/ConnectorsPanel.tsx`; `src/components/InventoryAccountsPanel.tsx`; `src/components/SetupWizard.tsx`; `src/lib/cliproxy/capabilities.ts`; `src/lib/connectors/diagnostics.ts`; `src/lib/db/bootstrap.ts`; `src/lib/db/schema.ts`; `src/lib/infisical/client.ts`; `src/lib/onboarding/model.ts`; `src/lib/onboarding/service.ts`; `src/lib/onboarding/transport.ts`; `tests/cliproxy-capabilities-route.test.ts`; `tests/cliproxy-capabilities.test.ts`; `tests/connector-diagnostics.test.ts`; `tests/onboarding-database.integration.test.ts`; `tests/onboarding-service.test.ts`; `vitest.config.ts`. The initial process inspection found no concurrent test, build or Next process. No source, test, dependency, CI, runtime, database or deployment files were changed by this pass.

The current Next server build identity could not be tied to this uncommitted checkout. Live behavior is reported as observed, not as proof the working tree is deployed.

## Coverage matrix

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Dashboard / stored inventory | Pass (shell only) | Live desktop landing view rendered; showed 0 accounts and sign-in required. Not an authenticated dashboard check. |
| Resources | Blocked | `/api/resources` returned 401; inventory data and interactions unavailable. |
| Identity Graph | Blocked | Requires signed-in inventory. Graph selection, zoom, orientation and keyboard behavior not exercised live. |
| Identity Tree | Blocked | Requires signed-in inventory. |
| Identity Tiers | Blocked | Requires signed-in inventory. |
| Fleet Map | Blocked | Navigation is present; content depends on authenticated inventory. Map selection/filter/zoom unavailable. |
| People and accounts | Blocked | Identity and account APIs return 401. |
| Projects | Blocked | Authenticated live project list unavailable. |
| Hosts | Blocked | Host inventory/detail unavailable. |
| Connectors and collection diagnostics | Not tested live | No authenticated account/connector context. Unit tests cover diagnostic projection categories and redaction. No scan or probe was triggered. |
| Setup / optional skips | Not tested live | No setup write/verify/save was attempted. Unit tests passed; fixture browser could not run because optional Playwright package is absent. |
| Provider onboarding | Blocked | Requires authenticated provider flow; no provider mutation or credential action attempted. |
| Agent access / MCP | Blocked | Authenticated surfaces unavailable; no pairing or key mutation attempted. |
| Settings and auth | Partial pass | Anonymous `/api/auth` returned 200 JSON; `/api/sessions` returned 401. Invalid cookie to protected resources returned 401 with generic sign-in guidance, status and timestamp. |
| Desktop layout | Pass (landing only) | 1280px preview showed navigation, sign-in prompt and tour without visible shell overflow. |
| Mobile layout | Pass (landing only) | At 390×844, shell and tour fit; no horizontal overflow was observed. Authenticated pages and mobile navigation details remain untested. |

## Prioritized findings

No confirmed application defect was established in the accessible live surface or completed automated checks.

### Coverage blocker: authenticated workflows unavailable

**Severity:** High verification limitation, not a product defect. **Routes/features:** Resources, identities, map, people/accounts, projects, hosts, connectors, provider onboarding, agent access and authenticated settings. **Reproduction:** Open the live target in a fresh preview session; it displays “Sign in to view inventory.” Anonymous GETs to `/api/resources`, `/api/identities`, `/api/inventory`, `/api/onboarding`, and `/api/onboarding/cliproxy-capabilities` return 401. `/api/sessions` returns 401. **Expected:** A signed-in test session is needed for read-only workflow verification. **Actual:** No authorized session was available, so those workflows are blocked. No session data was extracted and no login/reset was attempted. **Environment/revision:** Local app on port 3060; checkout revision above, serving build unconfirmed.

### Fixture browser unavailable

**Severity:** Medium verification limitation. **Feature:** Setup wizard fixture. **Reproduction:** `npm run verify:setup-ui`. **Expected:** Run the synthetic Playwright fixture. **Actual:** Exit 1, `ERR_MODULE_NOT_FOUND` for optional `playwright` package. No dependency was installed. Desktop/mobile setup fixture claims in earlier records were not independently reproduced in this pass.

## Automated and security checks

| Check | Result |
| --- | --- |
| `git diff --check` | Exit 0 |
| `npm run check:hygiene` | Exit 0, repository hygiene passed |
| `npm run typecheck` | Exit 0 |
| `npm test -- --coverage.enabled=false` | Exit 0; 85 files passed, 15 skipped; 614 passed, 66 skipped. DB integration files remain gated/skipped; no live DB was used. |
| `npm run build` | Exit 0; Next production build, TypeScript build pass, and inventory worker build completed. |
| `npm run verify:setup-ui` | Exit 1; optional Playwright dependency missing. |
| Gitleaks isolated tree scan | Exit 0; zero findings. Scanned current tracked/unignored working tree export with 100% redaction; no private Git history. |
| Anonymous / invalid-auth GET checks | Protected endpoints returned 401. Invalid-cookie response was generic sign-in guidance with status/timestamp; no credential values. `OPTIONS /api/resources` returned 401. |

The isolated export was assembled from `git ls-files -co --exclude-standard`, so ignored reports, archives, environment files and private backups were excluded. No raw match was printed or retained. Relevant changed code was inspected for versioned CLIProxy capability boundaries, endpoint allowlisting/redirect behavior, diagnostic projection and Infisical transport logging. No confirmed leak or unsupported capability claim was found in the reviewed changed paths. This was not a full public tree manual audit beyond the automated detector and scoped source review.

## Limits

Source and unit-test evidence does not prove live functionality. The live authenticated app could not be exercised. The setup fixture browser was unavailable. PostgreSQL integration tests were not run against any database in this pass. No live mutations, provider writes, credential save/verify/rotate, scan, quota refresh, pairing, webhook delivery, deployment or configuration changes were performed. Existing verification records for R5/R6 and R8/R9 remain supporting evidence, not substitutes for the blocked live paths.

Detailed temporary evidence index: `reports/qa/luna-20261108/evidence-index.md` (ignored). No screenshots or raw live response bodies were retained.

## Parent follow-up

After receiving this report, the parent reran the setup fixture using an existing optional Playwright installation via `FLEETHUB_PLAYWRIGHT_MODULE` and Chrome via `FLEETHUB_BROWSER_CHANNEL=chrome`. `npm run verify:setup-ui` exited 0. All six fixture checks passed, including saved scopes, persisted optional skips, draft protection, service-specific commands and 390px overflow checks; no page errors occurred. No dependency or source file was changed. This resolves the fixture-tooling blocker for the parent verification; LUNA's original coverage and the authenticated-live-workflow limitation above remain unchanged.
