# Security continuation verification

This follow-up starts from public commit `0af8cd8a5d3de312a639414ec90c6a0aafe6dbb4`. Changes remain local. Nothing in this record establishes full authenticated application acceptance.

## Ownership finding and fix

A PostgreSQL integration rerun reproduced an account contact pointing to another person who shared the selected email. `setAccountIdentity` previously selected the contact through an unrestricted email lookup, then updated the identity separately. A failure between those operations could leave a partial ownership change.

The fix selects the contact within the chosen identity and locks the account and contact while one transaction updates identity, contact, owner email, the matching login email, resource emails and the audit record. Existing independent login addresses remain unchanged.

Regression coverage supplies an older primary contact on a different person with the same email. A database trigger also forces the identity write to fail and verifies that account ownership, resource email and audit history remain unchanged.

## Verification

- Pinned Node 24.22.1, all 100 test files and 681 tests passed with isolated PostgreSQL and `--fileParallelism=false`, including a final coverage run. Coverage was 95.43% statements, 91.50% branches, 96.19% functions and 97.87% lines.
- TypeScript and whitespace checks passed. Repository hygiene passed before the ownership fix.
- An initial default parallel integration invocation caused schema creation collisions and shared-fixture interference. The supported CI invocation explicitly disables file parallelism. Those failures are retained as execution evidence, not a passing run.
- Production and worker builds passed. CodeRabbit completed with zero findings on the ownership source/test changes and the two reconciled release documents. Subsequent scanner-disposition documentation and mock-matching edits were outside that review snapshot.

## Runtime and release boundaries

The existing app and inventory worker are running. Duplicate Infisical and gateway containers remain stopped. No service volume was deleted. The implementation fix and the earlier R5/R6 changes have not been deployed by this continuation.

Published CI remains successful for the initial commit. Main protection requires quality, dependencies, codeql, container, secrets and inventory, includes administrators and forbids force pushes and deletion. Secret scanning and push protection are enabled, private vulnerability reporting and dependency alerts are enabled, and zero open secret-scanning alerts were returned. Automatic Dependabot security updates are disabled, which is distinct from dependency alerts.

CodeRabbit is authenticated to the intended organization and reported 10/10 CLI reviews available before the review. Review-app installation remains unverified and requires owner authorization.

The owner signed in through the shared browser. Read-only authenticated GETs passed for auth, fleet, inventory, identities, identity graph, onboarding, projects, project footprints, connectors, sessions and agent context. An explicit invalid bearer token returned 401 even with a valid browser session. GET `/api/resources` returned 405 because that route implements mutation only. The deployed capability endpoint returned 404, consistent with R5 not being deployed. No live operator credentials were reset or extracted, and no operator was added to the live database.

Desktop identity Graph, Tiers and Tree navigation and Fleet Map table/detail navigation were exercised against the stored live snapshot. This closes the prior absence of all authenticated evidence, but does not establish full workflow acceptance. Credential save/verify/rotation, provider onboarding, scans, pairing, revocation and mutations remain unverified live. R5/R6 live verification still requires deployment.

R7, R10 and the tracked backlog remain unfinished. The ownership fix addresses a verification finding and does not complete either roadmap item.

## Published CodeQL warning disposition

The successful published-head CodeQL job reported five warnings in its summary. `CODEQL_UPLOAD` was empty in that run, so SARIF was not uploaded. The repository variable is now `true`; it has not retroactively uploaded that analysis. The alerts API returned 404 with a scope diagnostic. Uploaded code-scanning coverage remains unverified.

- `js/incomplete-url-substring-sanitization` in `tests/connector-clients.test.ts`, two warnings: the code selected synthetic Kubernetes fixture responses by API pathname, not by remote host. Replaced broad substring matching with exact supported API path comparisons.
- The same rule in `tests/providers.test.ts`: the mocked fetch selected Cloudflare fixture responses by a substring anywhere in the URL. Replaced it with parsed hostname equality.
- `js/insufficient-password-hash` in `src/lib/auth/guard.ts`: the flagged operation computes a keyed HMAC-SHA256 digest of an already authenticated API token for rate-limit identity separation. It is not a stored password verifier. Disposition: reviewed false positive for this use; no rule suppression was added.
- The same rule in `src/lib/auth/session.ts`: the flagged operation signs the session payload with HMAC-SHA256 using the server authentication secret. It is not password storage. Password hashing uses the separate salted PBKDF2 implementation. Disposition: reviewed false positive for this use; no rule suppression was added. This disposition does not claim a broader cryptographic audit of password storage.

No local CodeQL executable was available for a fresh analysis. A new analysis/upload remains pending. The current token cannot enumerate GitHub App installations, returning HTTP 403; neither CodeRabbit nor Greptile app installation is verified.

## R7 findings and partial implementation

Authenticated live QA measured an identity Tree page width of 733px at a 390px viewport. The flex content container could not shrink, and identity controls did not wrap at narrow widths. A populated live Graph also expanded the document to 1536px at a 1280px viewport through the same flex-column constraint. The local fix allows the content column to shrink, wraps the identity heading and view controls, and gives the mobile navigation toggle a name and expanded state.

Opening a live Fleet Map resource drawer left focus on the underlying table button. The local drawer now focuses Close on open, closes on Escape, and restores focus to the trigger when it still exists. Long resource names wrap within the drawer header.

`npm run verify:fleet-ui` bundles the actual page with the built CSS and synthetic API fixtures. With an explicitly configured optional Playwright module and Chrome, Graph, Tree and Tiers passed document-overflow checks at 1280px, 390px and 320px. At each size, a long-name resource drawer passed initial focus, Escape dismissal and focus-return checks. No page errors occurred. The mobile synthetic screenshot was visually inspected. Production/worker build passed after the UI changes. Impeccable's source detector reported no regex findings in the three changed UI files; its output explicitly states that parsed-page contrast and geometry rules did not run.

These fixes are implemented and tested locally, not deployed. Shared account/resource details, consistent problem search/filter semantics, selection persistence, project filtering, populated identity long-label cases and large-fleet behavior remain pending. R7 is not complete. R10 and the earlier backlog remain unimplemented.

## Secret-scan scope

A redacted gitleaks scan of the tracked and nonignored source export passed with no findings. A broad working-directory scan returned 13 generic-key matches, all in ignored `.next` build/cache output. Their paths and field roles correspond to Next.js-generated preview signing/encryption keys and server-action encryption keys. Installed Next.js generation code confirms these build keys are generated by the framework. They are excluded from Git and the source export, and the Docker context allowlist excludes local `.next` output. No application runtime or provider credential was identified in that scan. No broad scanner suppression was added.

## Full-tree privacy review and history audit

The owner asked for a whole-repository check for secrets, personal data and references to private infrastructure, plus a Git history check.

- **History.** The public repository has one branch, `main`, and one reachable commit with GitHub noreply author and committer metadata. It has no tags, releases, pull requests or forks. The push activity log shows two earlier root commits that were force-replaced before the repository became public. GitHub still serves both by SHA. Each was fetched and audited: they differ from the published commit only in task-tracker and verification wording, contain no private data, and pass a redacted gitleaks scan. The published commit also passes.
- **Identifier sweep.** A denylist was built from every value removed by the private scrub commits and from the ignored private archive (emails, hostnames, addresses, personal paths, account identifiers). It was matched against the working tree, the published commit and both replaced commits. The owner's name, tailnet, real host names and personal paths do not occur. One test fixture still used a private RFC 1918 address taken from a real node; it is replaced locally with a neutral address. The remaining matches are documentation ranges, generic loopback/CGNAT values and synthetic fixture domains.
- **CodeRabbit.** The CLI accepts at most 300 files, so the 360-file tree was reviewed as two complete halves (224 and 136 files) in a disposable repository whose base is an empty commit, with privacy-focused instructions. It reported no secret, PII or owner-reference finding. It reported 16 correctness and documentation findings.

### Finding dispositions

Fixed locally and covered by tests:

- `DELETE /api/demo/seed` deleted every identity, account, resource and gateway for any write-authorized caller. Both demo handlers are now operator-only, the reset removes only the fixed demo row IDs in one transaction, and database errors are no longer echoed. A PostgreSQL regression proves real inventory survives.
- `maskPhoneNumber` exposed the area code. It now keeps only the country code and last four digits.
- The development localhost write exception could never match, because client identifiers are hashed. The dead branch is removed; anonymous development writes still require the explicit opt-in.
- GitOps discovery was blocked by the global 64 KB pre-check before its own larger limit. `verifyApiAccess` accepts a per-route `maxBytes`.
- Replacing only a rotation credential cleared the stored schedule. An omitted schedule is now kept; `null` still turns it off. Covered by the rotation database test.
- Usage reported by native ID raised a false "no matched usage" warning, and an ambiguous native ID attached usage to an arbitrary resource. Footprints now expose the matched resource ID; an exact FleetHub ID wins and an ambiguous native ID stays unmatched. Covered by a projects database test.
- The OCI A1 free pool used the old 4 OCPU / 24 GB allowance. It now reads the catalog values.
- README session-revocation text, guided-tour setup/collection text, the MCP tool list, catalog window/engine counts and stale cross-references, and legacy combined-profile Docker commands were corrected.

Not changed:

- The container CI job was reported to return 503 instead of 401. The published `container` job passed with this exact check, so the report is contradicted by run evidence.
- The OCI scan call budget (120) can be exhausted below the 50-compartment cap. Fixing it needs either a higher outbound call bound or partial-scan semantics, which needs live tenancy evidence and an owner decision. Resolved on 2026-11-09 with per-product budgets; see the delivery task list.

### Verification after fixes

Pinned Node 24.22.1 with a new disposable PostgreSQL container and `--fileParallelism=false`: 101 files and 685 tests passed. Coverage was 95.36% statements, 91.56% branches, 96.2% functions and 97.74% lines. TypeScript, production, worker and MCP builds, repository hygiene, whitespace and a redacted gitleaks scan of the tracked tree passed. None of these fixes is deployed or pushed.
