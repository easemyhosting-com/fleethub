# Reuse-first onboarding and FleetHub UX plan

Decision date: 2026-11-08. The owner approved connecting existing services first, explicit optional local installation, and preserving the fleet mind map. This document records that direction and proposes implementation batches. It does not claim the batches are implemented or authorize deleting live data.

Read this with [product scope](44-product-scope-and-onboarding-tiers.md), [implemented setup tiers](45-setup-tiers-and-builtin-secret-store.md), [identity hierarchy](51-person-email-account-hierarchy.md), and [delivery tasks](61-reuse-first-delivery-tasks.md). For integration onboarding and UX priorities, this decision supersedes older mandatory Tailscale/Infisical/CLIProxy sequences. Existing inventory, projects, hosts, usage attribution and MCP work remain in scope.

## Product and service boundaries

FleetHub is a public, self-hosted resource inventory and capacity advisor for legitimately held free and paid provider accounts. It tracks resources, allowances, measured usage, resets, expiry, health and billing exposure. Unknown usage is never zero. Provider account restrictions remain in force; automatic signup and quota-limit evasion remain excluded.

FleetHub owns its web application, inventory worker and PostgreSQL data. Its supported external secret-management and LLM-gateway integrations are Infisical and CLIProxyAPI. These are independent optional connections, not services that every install starts. The existing built-in encrypted store remains a lightweight alternative to Infisical. Tailscale is an optional transport, not a prerequisite. Provider APIs are connectors, not additional required hosted infrastructure.

Non-local production rate limiting now uses FleetHub's existing PostgreSQL, fails closed on database errors and requires no Redis REST service. Task R3 is implemented. Local in-memory limiting is not a multi-replica production replacement.

## Revisions after the architecture review

Owner-approved on 2026-11-08 after a second-opinion review ([record](verification/2026-11-08-architecture-second-opinion.md)). These revisions take precedence over conflicting text later in this document.

1. **Credential references are self-describing.** Each `secret_refs` row records its vault URL, project, environment and path. Reads use the reference's own folder; new writes use the current target, so changing the configured folder never strands earlier credentials. Origin, project and environment must still equal the verified setup, because the single machine identity's client secret is only ever sent to that origin; a stored row cannot redirect it. Moving a secret to another vault is an explicit per-reference copy, verify and row update (task R4). Implemented as task R2.
2. **PostgreSQL is FleetHub's only datastore.** Rate limiting moves from Redis REST to PostgreSQL (task R3). SQLite is not a supported alternative; see the database decision below.
3. **Infisical folder layout is smaller.** Use `/accounts` and `/connectors` under `dev` and `prod`. Add `/ci` only when CI needs secrets. Drop `/runtime`: FleetHub's database password, encryption key and Infisical bootstrap credential cannot live in the vault they unlock, so the folder would mislead. `/connectors` needs task R2 because connector and account credentials currently share the one configured path.
4. **FleetHub does not maintain a bundled Infisical installation long term.** Public defaults: the built-in encrypted store, or Connect existing Infisical. Local Infisical installation links to Infisical's own self-hosting guide. The `infisical` profile stays until a documented deprecation release with volume-retention guidance (task R9). The `cliproxy` profile wraps the upstream image and remains.
5. **Delivery order changes.** Commit the first batch, then self-describing references, the PostgreSQL limiter and the owner's migration. Capability states, diagnostics and map/details UX follow. See [delivery tasks](61-reuse-first-delivery-tasks.md).

### Database decision

Keep PostgreSQL; do not add SQLite support. The web application and inventory worker are separate processes writing concurrently. The code uses transaction-scoped advisory locks for collection jobs, `jsonb` operators, `timestamptz` and `postgres-js` raw SQL throughout. SQLite would need a second query dialect, a replacement for advisory locks and single-host volume sharing between containers, for no benefit to the target operator. The FleetHub database container already runs with low-write settings. Revisit only if a measured single-process install becomes a goal.

## Decisions and current implementation

| Area | Current evidence | Target |
| --- | --- | --- |
| Setup | Independent verification; either verified vault unlocks credential storage | Existing-service connection is the first visible choice for each integration |
| Local services | Separate `infisical` and `cliproxy` profiles; explicit legacy `integrations` retained | No automatic startup; retain service and volume names |
| Credentials | Bootstrap secrets come from protected runtime configuration | Keep bootstrap outside the vault it unlocks; clear handoff guidance |
| Infisical scope | Reads use the saved reference folder; verified origin, project and environment remain strict; separate connector write path is supported | Explicit, verified migration between origins |
| Rate limiting | Shared fail-closed PostgreSQL limiter | Verify deployment uses the new build |
| CLIProxy | Verification checks models and a management credential-list response | Separate inference, management, account-status and quota capabilities |
| Fleet exploration | Identity Graph defaults to graph; Fleet Map is a separate resource view | Preserve both; improve navigation, selection, readability and recovery |
| Documentation | Older guides still describe ordered setup gates and manual-only OCI | Make current guidance easy to find and identify historical material |

## Onboarding contract

For each integration, present **Connect existing** first, **Set up locally** second, and **Skip for now** where applicable. Do not preselect an installation or launch a container on page load, Save, Verify, or a failed connection. A failed connection must offer correction and retry, not silently fall back to a new instance.

1. Create the operator account. Inventory-only/manual exploration remains available without external integrations.
2. Choose a credential backend. In the Infisical connection card, connect existing comes first and local installation second. Keep the built-in encrypted store available as a separate backend choice. One verified backend is enough for credentialed provider onboarding.
3. Offer CLIProxy independently for AI features, with the same connection/install/skip choices. Its absence does not block cloud inventory.
4. Offer private-access guidance without requiring a Tailscale account or API token.
5. Connect one provider, show permission requirements, test access, save safely, and show first-scan progress and results.

Persist public settings and progress, never plaintext credentials in browser storage. Show configured, checking, verified, failed, skipped and stale states with timestamps. Existing verified connections should reopen as connection summaries with Edit, Verify and Open console actions. Changing one connection must not reset unrelated connections. Expired secret-store verification should attempt the existing bounded re-verification before asking the user to repeat setup.

Collect the API address reachable from FleetHub separately from the browser console address. Explain that container localhost refers to the container. Check both web and worker reachability where both consume a connection. Allowlist exact intended service origins, retain TLS verification and redirect restrictions, and distinguish DNS, routing, authentication, permission and response-format failures without exposing secrets.

### Explicit local installation

Provide a reviewed command preview and required ports, images, persistent volumes, resource requirements and backup instructions. The first implementation generates instructions for the operator's terminal; FleetHub receives no Docker socket and does not run host commands through HTTP.

Split Compose into independent profiles, with Infisical's PostgreSQL and Redis confined to its profile. Preserve digest pins, loopback-only publishing, dedicated data volumes and explicit startup. Support reuse of one service while locally installing the other. Preserve existing Compose project names and volume mappings during upgrades. Retain `--profile integrations` as an explicitly requested legacy combined option for now. Individual profile names must never activate the unrelated stack. New commands use individual profiles; removing the legacy option needs separate migration guidance.

Generated configuration must not overwrite an existing install. Stopping an optional service must preserve its data; reset and volume deletion are separate explicit operations. Describe update, restart, backup and removal independently.

## Infisical organization and credential ownership

For the owner's installation, reuse the existing server if authentication and scope tests pass. Check whether a FleetHub project exists before creating one. Do not rename or consolidate other application projects.

Use a dedicated `fleethub` project, with `dev` and `prod` environments. Within each, use `/accounts` and `/connectors`, and `/ci` only when CI actually needs secrets. No `/runtime` folder; bootstrap credentials stay outside the vault. Set the account secret path to `/accounts`, which receives `FLEETHUB_ACCOUNT_<uuid>` records. The optional connector secret path supports `/connectors`; leaving it blank preserves the shared-folder behavior. R2 reads older references from their recorded folders within the verified origin, project and environment. Per-provider folder organization is not implemented.

Store account names, people, emails, resource relationships and structured vault references in PostgreSQL. Avoid emails in secret names. Preserve stable references across label changes. Record the backend chosen for each credential; do not silently migrate existing records when the preferred backend changes.

Use distinct machine identities for development, production, deployment/CI and collectors where permissions permit. Give the account-registration process the create/read/delete permissions required by its round-trip checks and cleanup, and collectors only the reads they require. Folder names alone do not enforce isolation. Verify project/environment/path permissions on the deployed free edition rather than assuming paid features exist.

Keep Infisical bootstrap credentials, FleetHub database startup credentials and encryption-key recovery outside the only vault they unlock. Maintain encrypted backups and a restore procedure. Existing shared credentials keep their verified owner; importing a reference or issuing a dedicated scoped credential is preferable to copying every application's secrets into FleetHub. Cross-project reference workflows are future work, not a current onboarding promise.

## Provider connection lifecycle inspired by CLIProxy

Borrow explicit account connection methods and visible credential health. Every provider adapter declares whether it supports API key, OAuth authorization code with PKCE, device authorization, credential-file import or manual inventory. Only show methods the adapter implements. FleetHub login is separate from provider authorization.

For non-LLM OAuth adapters, use provider-supported flows, minimum scopes, browser-bound one-time state, validated redirects, expiry tracking and a single refresh owner with concurrency control. Store refresh credentials in the chosen vault. Handle cancellation, denied permissions, expired device codes, revoked tokens, partial discovery and reconnect without duplicating accounts. Removing FleetHub's connection must not delete provider resources; disclose whether provider-side revocation is supported.

CLIProxy remains the owner of its LLM OAuth flows, local auth files, token refresh, inference and routing. FleetHub must not mount, copy, display or independently refresh those auth files. Link to the supported CLIProxy management flow, then refresh supported account metadata. Track capabilities by deployed version; unsupported quota endpoints mean unknown quota, not failed inference or zero remaining allowance. Inference keys and management keys have distinct privileges.

Provider credentials requiring files stay in the vault when supported; any materialized local file needs private permissions, a narrow mount, bounded lifetime where possible and backup/deletion rules. Never expose raw credentials through graph nodes, inventory APIs, MCP responses or logs.

## UX direction: preserve the maps and improve operations

This is refinement of the current interface, not replacement with the CLIProxy dashboard. Preserve the identity mind map as the default in Identities and Accounts, with its person/email/provider/account/resource relationships, orientation control, zoom, overview and selection. Preserve Fleet Map as a separate resource view and retain Resources, Tree and Tiers alternatives. Do not conflate the identity graph with the Fleet Map or change navigation defaults as a side effect.

Use CLIProxy's separation of connection methods, credentials, routing and quota information as interaction inspiration. FleetHub's own primary questions are what an account owns, what capacity remains, when it resets, what costs money, and whether the information is trustworthy.

Planned refinements:

- Use one account/resource detail treatment across graph, map and list. Show owner, plan, health, credential status, last successful scan, allowance scope and usage source; actions stay contextual.
- Preserve selected account/resource and compatible filters when switching views. Distinguish global filters from view-specific controls; clear/reset explains what it changes.
- Retain graph zoom and orientation on revisit, add or verify fit-to-selection and fit-to-view, and support branch collapse/search without discarding the surrounding ownership path. Review existing controls before adding duplicates.
- Use progressive disclosure for large graphs. Keep useful roll-ups while branches are collapsed; avoid fetching or rendering every resource detail immediately.
- Give keyboard users a usable equivalent to pan/zoom exploration, visible focus, named controls and a predictable details-panel focus return. Keep text labels alongside status colors.
- On narrow screens, retain access to the graph with explicit controls and a list/tree alternative. Use a full-width details sheet rather than tiny nodes or an obstructing permanent sidebar.
- Make stale, unavailable, permission-denied and empty states distinct. Keep previous data visible with its timestamp during refresh; offer reconnect at the affected account.
- Separate free allowances, trial credits, paid capacity and actual charges. Record the scope of shared quotas so account and resource roll-ups cannot count the same allowance twice. Show observed usage separately from catalog entitlements and allocated capacity.

### Reference review and limits

On 2026-11-08, browser inspection of `http://127.0.0.1:8317/management.html` reached `#/login`. The page explicitly displays the current server address, a Change action, management-key input, Show key, Remember password and Login. Reuse the explicit destination and editable connection summary; FleetHub should keep machine credentials server-side rather than borrow browser password retention.

The first review used the supplied screenshot. A subsequent signed-in browser review on 2026-11-08 inspected Dashboard, OAuth Login, Auth Files, Quota Management and Routing in the local instance. Its displayed version was v8.0.58. The observed instance and version are reference evidence, not a universal CLIProxy capability contract.

The follow-up review completed all 12 main navigation pages, plus the Config Panel section tabs and Error Request Logs tab. See the [page-by-page reference review](verification/2026-11-08-cliproxy-console-review.md) for coverage and limits. UI v1.27.3 and backend v8.0.58 were displayed separately.

Verified observations:

- Dashboard separates Connected from a Needs attention summary, shows success/failure counts within a named rolling window, and distinguishes active credentials from credentials not serving. A successful management connection does not establish healthy upstream requests.
- OAuth Login presents provider-specific methods, including browser sign-in, device authorization and service-account JSON. It distinguishes Kimi sites instead of treating them as one interchangeable account domain. The review inspected method choices without initiating authorization.
- Auth Files provides provider counts, search by name/account/type/provider/error, Enabled/Disabled/Problem filters, sorting, display options, pagination and account-level Models and quota-refresh actions. Enabled credentials can still have problems. File upload and bulk deletion controls exist, but were not exercised.
- Quota Management listed credentials while reporting **0 loaded**, with per-account refresh affordances. Connected accounts and discovered credentials are separate from loaded quota measurements. No quota refresh was triggered, and no actual remaining allowance or reset value was verified.
- Routing depicts priority tiers, serving and cooling credentials, fallback behavior and retry policy. It explicitly describes limitations of its preview, including omitted session affinity, live API-key cooldowns and WebSocket preference, and unknown plugin models. These are UI explanations, not a tested failover guarantee.

Plan refinements from this evidence:

1. Model connection authentication, credential enablement, upstream availability and quota observation as separate dimensions. Present an actionable reason and source timestamp for each. A disabled credential is not a revoked credential; a cooling account is not necessarily disconnected.
2. Add provider/method capability labels to connection choices. A browser login, device flow, service account and manual API key have different scopes and recovery steps. Provider/site identity must survive import and reconnect.
3. Make account search and problem filters available alongside the existing graph and list alternatives. Keep the ownership path visible when narrowing a graph to problematic accounts. Use contextual details for repair actions rather than replacing the mind map with a credential-card grid.
4. Represent quota as not loaded, loading, observed, stale, unsupported or failed, with independent authentication status. An empty measurement must not produce 0% usage or imply free capacity. Show per-account refresh with last-attempt and last-success metadata, bounded retries and upstream rate limits.
5. Keep resource/account availability explanations in map details. When recommendations omit an account, explain the evidenced reason, such as stale data or unavailable quota. Any future dependency or placement diagram must distinguish observed facts from a preview and state its omissions.
6. Separate harmless view refresh from credential refresh, reconnect and destructive operations in labels and permissions. FleetHub should not inherit CLIProxy's bulk credential deletion or routing policy controls as part of a read-only integration.

Additional requirements from the complete navigation review:

- Connection summaries show service/UI versions where available, last capability check and saved/verified/effective states. Installed or enabled does not imply effective when a global switch disables a capability.
- Onboarding contains a real first-provider checklist. The reference Quick Start page currently shows a promotion; its title alone is not evidence of useful onboarding. FleetHub keeps setup free of promotional gates.
- Plan bounded, redacted connector diagnostics in account/resource details, with source/time and actionable error categories. Do not copy raw proxy request logs into FleetHub. Audit events and operational diagnostics remain distinct.
- Distinguish core API capabilities from optional extension capabilities. No plugin installation is an onboarding prerequisite. Keep inference routing, model aliases, payload editing and plugin administration in CLIProxy.

These refinements extend batches 3 and 5; they do not change the service-ownership or reuse-first decisions. Verify which metadata the deployed management API actually exposes before promising an imported status. UI labels alone are not an API schema. Add capability tests for partial responses and version differences before implementing the adapter.

The review used rendered page content and read-only navigation. It did not read raw auth files, export credentials, start OAuth, change routing, disable/delete accounts or trigger credential/quota refresh. No private account identifiers are retained in this document. Actual login completion, token refresh, quota retrieval, failover, mobile layout and keyboard accessibility remain unverified. This is a scoped planning review, not a full functional or accessibility audit.

## Delivery batches and acceptance checks

| Batch | Deliverable | Required proof |
| --- | --- | --- |
| 1 | Correct guides and establish this decision record | Local documentation links resolve; implemented versus planned behavior is explicit |
| 2 | Independent profiles, generated configuration, self-describing credential references and PostgreSQL limiter | Default starts no optional services; all four existing/local combinations validate; old volumes remain attached; references written under an earlier scope still read after the setup changes, while unapproved origins and paths are refused; PostgreSQL limiter fails closed and holds the limit under concurrent requests with no Redis configured |
| 3 | Reuse-first setup and capability checks | No container starts from a browser action; skips work; unrelated edits preserve readiness; separate connection/availability/quota states, web/worker connectivity and wrong-scope failures are tested |
| 4 | Owner's transition to existing services | Scoped Infisical round-trip and CLIProxy capability checks pass from runtime; credential references are migrated deliberately; backups and rollback work before duplicate services stop |
| 5 | Map/detail refinements | Both maps and current defaults remain; filters and selection agree across views; problem-account search preserves ownership context; unknown/stale/failed quota stays distinct; keyboard, mobile, long labels and large fleets are checked in the browser |
| 6 | One non-LLM provider authorization adapter | Provider supports the chosen flow; state/PKCE or device-flow checks, refresh races, revocation, reconnect and secret-redaction tests pass |

Batches 1 and 2 are implemented. Optional-service skips now persist separately from saved connections, and public guidance deprecates the bundled Infisical profile while preserving volumes and compatibility commands. The read-only v8 capability contract and bounded collection diagnostics are implemented. The owner's Infisical migration has verified runtime reads and stopped duplicate containers with volumes retained. The owner's gateway cutover is also runtime-verified, with duplicate service containers stopped and volumes retained. Shared map/details refinements and a new non-LLM authorization adapter remain pending. See [delivery tasks](61-reuse-first-delivery-tasks.md) for current evidence. No current deployment should be stopped merely to match the plan. Keep the pending project filter and outbound decision delivery visible; coordinate the project filter with shared view-filter semantics. Reservations and automatic actions retain their existing M3 policy boundary and are not prerequisites for this onboarding work.

## Repository organization

The inspected root contains README.md, AGENTS.md and project configuration/build files; there are no stray root documents to relocate. Generated ignored files are not source documentation. Keep the root small and keep the Next.js-managed AGENTS.md block intact.

Use [docs/README.md](README.md) as the current navigation page. Keep numbered records stable to preserve existing links. Label superseded entry points and add a current reading order rather than renaming the entire historical set. Keep operator instructions in runbooks, reusable reference assets in `docs/assets`, prompts in `docs/prompts`, and future dated verification reports in `docs/verification`. Never put private host state, credentials or local environment exports in public documentation.

If source reorganization becomes necessary, retain the current domain boundaries under `src/lib`: onboarding, vault backends, providers/collectors and connectors. Keep provider connection capabilities separate from rendering and deployment instructions. Extract shared account/resource detail components only when implementing batch 5; avoid a broad folder move as part of a planning update.
