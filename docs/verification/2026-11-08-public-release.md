# Public release verification

FleetHub was published at [easemyhosting-com/fleethub](https://github.com/easemyhosting-com/fleethub) under Apache-2.0. Published initial commit: `0af8cd8a5d3de312a639414ec90c6a0aafe6dbb4`.

## History and content

The release uses a separate clean checkout and one fresh initial commit with the selected organization identity and GitHub no-reply address. The original development history remains private. A fresh remote clone matched all 357 file-allowlisted export files. No original development commit object was present in that clone.

The export excludes private journals, environment files, credential mounts, local setup, migration/recovery artifacts, build products and raw QA evidence. Gitleaks scans of the export and fresh Git history passed. Owner/fleet identifier and old workspace-metadata checks found no matches. A local Trivy secret scan also passed. GitHub secret scanning reported zero open alerts when checked.

## Implementation evidence

The full suite passed 100 files and 680 tests on pinned Node 24.22.1, including isolated PostgreSQL integration. Coverage was 95.45% statements, 91.49% branches, 96.19% functions and 97.87% lines. TypeScript, production/worker build, MCP bundle, dependency checks, hygiene and whitespace checks passed. A clean checkout installed and built successfully. npm audit reported zero vulnerabilities.

The six setup browser fixture checks passed. Diagnostics keyboard disclosure and long-label overflow checks passed at 1280px, 390px and 320px. The mobile diagnostics fixture was visually inspected. Impeccable reported no findings in the changed diagnostics UI. CodeRabbit's follow-up reviewed the new capability and diagnostics files and LICENSE with zero findings.

The [independent LUNA pass](2026-11-08-luna-app-test.md) completed without a confirmed product defect. Its 614 unit tests passed, with 66 database tests skipped. Its signed-out browser review covers the shell; authenticated workflows remain blocked. LUNA could not tie the running server's build to the tested checkout, so its live observations do not verify the published release build. Its optional Playwright fixture dependency was unavailable. The implementation fixture checks above use an explicit optional Playwright module and do not convert LUNA's blocked coverage into an independent pass.

## GitHub controls and remaining work

Secret scanning, push protection, private vulnerability reporting and dependency alerts are enabled. Main requires the six CI job checks, pull requests, linear history and resolved conversations. Administrators are included; force pushes and branch deletion are disabled. CodeQL uploads are configured for subsequent runs.

The [release CI run](https://github.com/easemyhosting-com/fleethub/actions/runs/42472967279) is separate from local evidence. All six jobs passed on the published commit, including CodeQL and secret scanning. The earlier secret job failed during scanner installation before scanning. The refreshed run's secret job passed.

Update, 2026-11-09: the CodeRabbit GitHub App is installed. It submitted reviews on pull requests #4 onward; #1 through #3 merged without one. `main` now requires its `CodeRabbit` check in addition to the six CI jobs. A passing check does not by itself show that a review ran, because skipped or rate-limited reviews can also pass. Greptile has not reviewed any pull request and is not a required check; its installation still needs owner authorization. Shared map/list/identity details and filters (R7), project-filter coordination and the non-LLM authorization adapter (R10) have since merged. See the [delivery tracker](../61-reuse-first-delivery-tasks.md).

This record does not claim full authenticated application acceptance or completion of the product roadmap. It was written after the immutable initial publication snapshot and remains a follow-up documentation change until merged into the public repository.
