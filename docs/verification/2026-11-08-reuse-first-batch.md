# Reuse-first onboarding: first implementation batch

Implemented on the pre-release development tree. Tracked work: [delivery checklist](../61-reuse-first-delivery-tasks.md). This record describes the first slice, not completion of the broader roadmap.

## Delivered behavior

- Independent optional `infisical` and `cliproxy` Compose profiles. Infisical retains its own database and Redis. The explicit legacy `integrations` profile remains available for both stacks. Service names, volume keys, image pins and loopback port bindings are preserved.
- New external connections open in Connect existing mode. Switching services resets the installation mode; an existing verified backend reopens directly.
- Local setup offers only the selected service's command. The helper creates private configuration and starts nothing. The UI never executes host commands or accesses Docker.
- API and browser console addresses are explicit. A separate action fills same-Compose local addresses. Existing saved paths are retained; new empty Infisical paths use `/accounts`.
- Private access and gateway setup are optional. Skip for now defers the connection for the visit without writing state, revoking access or pretending verification succeeded.
- Draft changes require Save or Discard before navigating between connections. Discard restores saved values without writes. Failed verification retains the editable configuration and never triggers installation.
- The built-in backend still works without extra services. Identity Graph, Fleet Map and their view defaults are untouched.

## Verification

- Focused setup/onboarding suites: 41 passed, including actual Compose config resolution for neither/Infisical/CLIProxy/both and the legacy combined profile. Config resolution starts no containers. Assertions check preserved named volumes and private Infisical database/cache ports. The Compose regression skips explicitly if the Docker Compose CLI is absent; it ran locally.
- Full unit suite: 596 passed, 61 skipped. Coverage: 96.12% statements, 96.36% functions and 97.84% lines. Database-gated tests remain skipped in this run; this is not a live migration test.
- Production build and TypeScript passed after correcting an optional-property assertion in the new Compose test.
- Browser fixture checks use the actual SetupWizard component and built CSS, with all HTTP served by Playwright interception. No server or live database is involved. Covered default/reopened backends, service switching, per-service commands, no writes on revealing instructions, explicit local addresses, draft discard, failed verification, optional deferral and provider access through a verified built-in backend. Existing and local panels fit a 390px viewport without document overflow; no page errors occurred.
- Impeccable mechanical detector: no findings. Repository hygiene and whitespace checks passed.
- CodeRabbit reviewed the tracked changes and reported one minor runbook issue: custom setup directories were not consistently reflected in commands. The runbook now uses `FLEETHUB_SETUP_DIR` throughout its commands. The follow-up review included the newly added browser verification script and completed with zero findings. Its reviewed-file list covers the application, Compose configuration, setup helper, verification script and focused tests. New untracked planning documents were not included in that review.
- The local FleetHub web container was rebuilt successfully using its existing Compose project and private environment file. Container recreation succeeded and the root route returned HTTP 200. The serving image is `sha256:3ac093ee391d2bf6e20995d94b41662d96404edf28b5263e69cc5980dea065b3`. Other services were not rebuilt or migrated.

## Reproduce the browser fixture checks

Build first with `npm run build`. With Playwright installed as a development tool and a supported browser available, run `npm run verify:setup-ui`. If Playwright is installed outside the project, set `FLEETHUB_PLAYWRIGHT_MODULE` to its absolute `index.mjs` path. Optionally set `FLEETHUB_BROWSER_CHANNEL=chrome` to use installed Chrome. Playwright is not a runtime dependency of FleetHub.

The check writes results and screenshots under ignored `reports/qa/reuse-first`. It uses synthetic accounts and never contacts real services. Raw screenshots, traces and interim notes stay ignored; public summaries belong in this directory. The existing ignore rules already cover those artifacts, so no broader ignore patterns were added.

## Limits and next work

Current production rate limiting still needs Redis REST outside local mode. Versioned capability checks, persistent skipped states, shared details/filter refinements, broad authenticated app QA and migration to the owner's existing services remain pending. No provider credentials or external service settings were changed by this slice. Optional containers have not been stopped or deleted.

The requested Qwen 27B MLX testing pass will use [the testing-only brief](../prompts/testing-only-agent.md). It must distinguish this working tree from the serving build, report blocked paths honestly and avoid live mutations. Its results are separate evidence, not implied by the fixture tests.
