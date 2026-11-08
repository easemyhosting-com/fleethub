# Architecture second opinion: reuse-first integrations

Date 2026-11-08. Reviewed against the pre-release development tree, including the first batch. Requested by the owner. The review read code and documentation only; it changed no services, containers, credentials or settings. The owner adopted its recommendations in [plan revisions](../60-reuse-first-onboarding-and-ux-plan.md#revisions-after-the-architecture-review) and [ordered work items](../61-reuse-first-delivery-tasks.md#ordered-work-items).

## Agreed with the existing plan

- Reuse the owner's existing Infisical and CLIProxyAPI. FleetHub owns only its web application, worker and PostgreSQL.
- CLIProxy keeps LLM OAuth, auth files, token refresh and routing. FleetHub reads supported metadata and never copies auth files.
- Track free and paid capacity separately, with explicit quota scope. Unknown usage is never zero.
- Keep the built-in encrypted store.

## Findings

1. **Exact scope matching blocks migration and folder separation.** `secret_refs` rows already store vault URL, project, environment and path. `openVaultForRef` (`src/lib/onboarding/vault-ref.ts`) and inventory collection (`src/lib/inventory/service.ts`) refuse any reference that differs from the single current Infisical setup. Connector credentials (`src/lib/connectors/service.ts`) and account credentials (`src/lib/onboarding/provider-credentials.ts`) write to the same configured path. Consequences:
   - Pointing setup at a different Infisical origin makes every existing reference unreadable.
   - Separate `/accounts` and `/connectors` folders are not implementable today.

   Recommendation: resolve each reference from its own location, constrained by approved origins and path prefixes.
2. **Redis REST is an undeclared third dependency.** `src/lib/auth/rate-limit.ts` requires an Upstash-compatible endpoint outside local mode. Recommendation: an atomic PostgreSQL window counter that fails closed.
3. **The bundled Infisical stack is a maintenance liability.** The stack has three containers, with a pinned `latest` digest that will age. FleetHub would own Infisical's upgrades and backups. Recommendation: the built-in store or Connect existing, with upstream installation guidance and a volume-preserving deprecation.
4. **`/runtime` is self-contradictory.** Bootstrap secrets cannot live in the vault they unlock. Recommendation: `/accounts`, `/connectors` and an optional `/ci`.
5. **Process risk.** The first batch was uncommitted across sessions on a branch with an open PR. Recommendation: commit before further work.

## Database

PostgreSQL stays. The code uses transaction-scoped advisory locks, `jsonb` operators and `timestamptz`, and two processes write concurrently. SQLite would add a second dialect for no operator benefit.

## Not verified

Infisical authentication on the owner's server, folder-level permissions on its free edition, and CLIProxy management API metadata were not exercised. Container-side Tailscale resolution was not tested either. Task R4 covers them.
