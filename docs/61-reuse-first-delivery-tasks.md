# Reuse-first delivery tasks

Started 2026-11-08. Source decisions: [current plan](60-reuse-first-onboarding-and-ux-plan.md). This checklist tracks implementation, evidence and remaining work rather than treating the entire roadmap as one release.

## First batch

- [x] Review the signed-in reference console and record all 12 navigation pages.
- [x] Confirm requested testing model availability: `qwen3.8-27b-mlx` through Codex via CLIProxy.
- [x] Split optional Infisical and CLIProxy Compose profiles; retain an explicitly documented legacy combined profile without changing service names or volumes.
- [x] Keep generated setup files private and make explicit startup choices discoverable. No helper or browser action starts containers.
- [x] Default new external-service setup to Connect existing; reset installation mode when switching services.
- [x] Give each service only its own installation commands; remove Docker integration commands from Tailscale instructions.
- [x] Separate optional private access/gateway wording from secret-backend readiness; add a set-up-later action without pretending unverified connections are verified.
- [x] Add focused regressions for profile combinations, generated setup guidance and setup choices; run type checking, tests and build.
- [x] Finish follow-up change review. First review found one minor runbook issue, now fixed; follow-up included the new browser fixture script and completed with zero findings.
- [x] Complete a scoped independent QA pass with the [testing brief](prompts/testing-only-agent.md). Qwen was interrupted without findings and cancelled. At the owner's request, a separate LUNA pass completed with no confirmed defect. Authenticated workflows remain blocked and are not an acceptance pass. See [LUNA report](verification/2026-11-08-luna-app-test.md).

## Ordered work items

Order approved by the owner on 2026-11-08 ([plan revisions](60-reuse-first-onboarding-and-ux-plan.md#revisions-after-the-architecture-review)). Work one item at a time; each needs its own verification record before it is checked.

- [x] **R0 Documentation.** Record the revised decisions, the PostgreSQL-only database decision and this ordered list.
- [x] **R1 Commit the first batch.** Committed before the public release.
- [x] **R2 Self-describing credential references.**
  - `refScope` in `src/lib/onboarding/vault-ref.ts` reads a reference from its stored folder. Origin, project and environment must still equal the verified setup, so the client secret is never sent to an origin a stored row names. Inventory collection and rotation share it.
  - Optional **Connector secret path** in setup. Blank keeps connectors beside accounts. Verification round-trips a probe in each folder.
  - Tests: earlier-folder reads (unit and PostgreSQL inventory collection), other allowlisted origin refused, project/environment/path-syntax refusals, connector folder writes and two-folder verification.
- [x] **R3 PostgreSQL shared limiter.**
  - `rate_limit_windows` is an unlogged table with one atomic upsert per request on database-clock minute windows, plus occasional cleanup. Database errors deny; cleanup errors do not.
  - The project-hook limiter uses it in production. Trusted-header client IPs are HMAC-hashed before use as keys. Redis variables are removed from Compose, README and the docs.
  - Tests: unit fail-closed (503) and limit checks, plus a PostgreSQL test with 60 concurrent requests across two connection pools, no over-admission, unlogged storage and window rollover.
- [x] **R4 Owner migration to existing services.** Do this only after R2.
  - Progress: dedicated destination project, development identity and dev/prod account/connector folders created. Both runtime containers passed authenticated development-folder round trips. Seven references copied with readback, cut over and verified through the application API. Encrypted database/configuration backups restored successfully in isolation; reference rollback rehearsed there. All seven references were subsequently read from both runtime containers. Duplicate Infisical containers stopped after verification; retained volumes and repeated reads passed. The worker heartbeat remained fresh. Existing gateway rejected the old installation's keys with HTTP 401. A dedicated management key subsequently authenticated from both containers. Dedicated inference and management keys then passed from both runtime containers, and application verification persisted after cutover. Local gateway metadata and configuration contained no upstream credentials. Encrypted configuration backup readback passed before its container stopped; every volume remains retained. Private recovery evidence stays outside the public repository.
  - Verify the owner's existing Infisical and CLIProxy from inside the web and worker containers, including Tailscale name resolution from Colima.
  - Create or confirm the `fleethub` project and a scoped machine identity on the free edition.
  - Back up the local Infisical and FleetHub databases. Move credentials one reference at a time, with a rehearsed rollback.
  - Stop duplicate containers only after that evidence exists. Never delete their volumes as part of this item.
- [x] **R5 Connector capability states.** Read-only v8 capability contract, separate authentication, credential enablement, reported upstream availability and quota lifecycle states. Server version and actual inference availability remain unknown. Provider quota readers are unsupported by this adapter. See [implementation and verification](verification/2026-11-08-capabilities-and-diagnostics.md).
- [x] **R6 Redacted diagnostics.** Bounded category-based diagnostics and account-level repair guidance in collection and connector details, with source/time and keyboard disclosure. No raw proxy logs. See [verification](verification/2026-11-08-capabilities-and-diagnostics.md).
- [x] **R7 Map and details UX.** Resources, the identity mind map and Fleet Map share fleet search, Needs attention and inventory filters. Resource details persist between views, and account collection facts use the same component. The identity mind map remains the default and keeps the ownership path when filtering. Browser verification covers populated Graph, Tree and Tiers at 320, 390 and 1280 px, drawer focus and Escape, and search in a 201-resource graph. See the fixture command `npm run verify:fleet-ui`. The separate project filter uses confirmed active links.
- [x] **R8 Persisted skip state.** Optional private-access/gateway skips persist separately from connection settings. Save or successful verification clears the flag. Unit, real PostgreSQL and fixture-browser checks pass. See [R8/R9 verification](verification/2026-11-08-r8-r9-verification.md).
- [x] **R9 Public install defaults.**
  - Present the built-in store and Connect existing Infisical as the public paths. Link local Infisical installation to upstream guidance.
  - Publish a deprecation note for the bundled `infisical` profile that preserves volumes. Keep the `cliproxy` profile. See [R8/R9 verification](verification/2026-11-08-r8-r9-verification.md).
- [x] **R10 Non-LLM authorization adapter.** A GitHub App authorizes read-only GitOps for a signed-in FleetHub operator. The authorization code uses PKCE and one-use session-bound state. PostgreSQL tests cover refresh serialization, encrypted storage, revocation, reconnect and the existing GitOps sync route with mocked GitHub responses. See [GitHub App setup](52-projects-needs-usage-and-gitops.md#authorize-a-github-app-for-gitops).

The project filter scopes Resources, Fleet Map, identity list and graph, and the Projects view by a URL slug. Inventory APIs and the resource-list MCP tool use the same scope. Outbound decision delivery remains pending. The OCI scan call budget found in the [full-tree review](verification/2026-11-08-security-continuation.md#full-tree-privacy-review-and-history-audit) is resolved: compute has its own 80-call budget that covers the 50-compartment cap, optional products share 220 calls, and a product that would not fit is reported as not covered before any call is spent instead of failing the scan. This was verified with mocked responses only, not against a live tenancy.

## Public release

- [x] **P1 Scrub the current tree.** Personal and family emails, domains, tailnet and device names, real server names and IP addresses, Grafana identifiers, OCI profile names, local paths and private product names are replaced with placeholders. Demo hosts are fictional (`atlas`, `borealis`, `polar-night-owl`, `polar-ember`).
- [x] **P2 Separate the private journal.** Owner-specific planning, handoff and live-fleet records moved to ignored `docs/archive/`. They are not part of the public repository. Public docs keep the current product, operator and verification records, with no links into the archive.
- [x] **P3 Build and ignore hygiene.** CLIProxy `config.yaml` is excluded from every Docker build context. Local CLIProxy mounts, agent tooling and the archive are ignored. `SECURITY.md` uses GitHub private vulnerability reporting.
- [x] **P4 Choose a license.** Owner selected Apache-2.0. Full license and package metadata added.
- [x] **P5 Publish with fresh history** under `easemyhosting-com`. Create the repository private, push one initial commit of the audited tree, and re-audit the pushed content. Switch it to public only after the license is chosen. Earlier development history stays private.
  - Published from a separate clean checkout after file-allowlisted export, gitleaks, identifier and private-artifact audits. One fresh initial commit contains the selected Apache-2.0 license; original development history remains private. A fresh remote clone matched the export. CodeRabbit follow-up returned zero findings, and the owner-requested LUNA audit completed with explicit coverage limits. CI status is a separate operational result; a transient scanner installation failure did not establish a secret finding.
- [ ] **P6 After publishing.** Private vulnerability reporting, secret scanning, push protection, dependency alerts and branch protection are enabled. Future development uses the separate clean checkout. CodeRabbit and Greptile GitHub App installation remains pending owner authorization. See [release verification](verification/2026-11-08-public-release.md).

## Latest evidence

See [first-batch verification](verification/2026-11-08-reuse-first-batch.md), [R8/R9 verification](verification/2026-11-08-r8-r9-verification.md), [capabilities and diagnostics](verification/2026-11-08-capabilities-and-diagnostics.md), and the [independent LUNA report](verification/2026-11-08-luna-app-test.md). The implementation suite passes 100 files and 680 tests, including isolated PostgreSQL integration. Styled setup and diagnostics fixture-browser checks pass with an explicitly configured optional Playwright module.

LUNA independently passed 614 tests with 66 database tests skipped, TypeScript, production/worker build, hygiene and a redacted isolated-tree secret scan. Anonymous and invalid-auth APIs deny access. Its browser pass covers only the signed-out desktop/mobile shell; authenticated workflows were blocked. Its setup fixture could not run because optional Playwright was not installed in its default module path. These are verification limits, not confirmed application defects.

Qwen was interrupted without findings and cancelled, with no completed report. The historical delegated Claude second-opinion report remains absent; the completed architecture-second-opinion record is a separate review. No review is a claim that the entire authenticated app passed.
