# Product scope and onboarding tiers (proposal)

Status: approved by the owner on 2026-10-28; first slice (setup tiers and built-in secret store) implemented, see [docs/45](45-setup-tiers-and-builtin-secret-store.md). FleetHub is being built as an open-source project, so the default install must not assume any particular stack (Tailscale, Flux, k3s, CLIProxy).

> Updated direction: [reuse-first onboarding and UX plan](60-reuse-first-onboarding-and-ux-plan.md). Existing-service connection comes first, local installation is explicit and independent, and both the identity mind map and Fleet Map are preserved. Historical “today” descriptions below predate the implemented setup tiers.

## Product statement

FleetHub is a **ledger and advisor for free-tier cloud capacity**: it records what you own across providers, what each plan allows, what is used, whether it is up and healthy, and it answers "where can this work run right now?" for people and LLM agents. Acting on resources (starting, stopping, provisioning) comes after trust in the data.

## Principle: core, connectors, and recipes

- **Core** (every install needs it): operator account and sessions, a place for provider credentials, provider accounts and resources, the entitlements/allowances store, health, the Fleet Map, read-only API and MCP.
- **Connectors** (optional modules behind interfaces, each with its own setup card): providers (Cloudflare, OCI, Upstash, Supabase, Neon, GitHub), health sources (HTTP/TCP probe, heartbeat, Flux/Kubernetes), secret backends, LLM gateway, private-access helper.
- **Recipes** (owner-specific, shipped as docs or blueprints, never onboarding gates): Tailscale on the VMs, Flux on k3s, GitHub CI runners.

A feature moves from recipe to connector only when two unrelated users would need it.

## Onboarding today versus proposed

Today the wizard requires Tailscale, then Infisical, then CLIProxy before any credentialed provider can be stored. That is the owner's stack and too heavy for a new open-source user.

Proposed: a **checklist with tiers**, each item showing verified, skipped or not applicable, none blocking except the secret store:

1. **Required: operator account.**
2. **Required to store provider credentials: one secret backend.** Offer (a) a **built-in encrypted store** (envelope encryption with a master key supplied by the environment; zero extra services; default for new installs) and (b) **Infisical** as the advanced backend. The credential write path in docs/39 already goes through a vault interface, so this is a second implementation of `read/write/remove`, not a rewrite.
3. **Recommended: private access.** Tailscale, or any HTTPS reverse proxy; the wizard checks that the app is not exposed on plain HTTP beyond localhost and explains options. Verification is advice, not a gate.
4. **Optional modules:** LLM gateway (CLIProxy) for LLM features; GitHub; Flux/Kubernetes health source; runner and blueprints (later).

Provider onboarding then asks only provider-specific fields plus the resource vocabulary and policy defaults from the Fleet Map design.

## Service-level checks without Flux

Health must work for a user with a single VPS and no Kubernetes. The default sources are provider state, HTTP/TCP probes and an optional heartbeat or reporter. Flux and Kubernetes are one **health source plugin** behind the same interface: read-only kubeconfig, Kustomization and HelmRelease readiness mapped to the same `healthy/degraded/down` states. It is not an onboarding step and not in the first release; the owner can enable it later as a connector.

## Recommended scope by release

| Release | Theme | In scope | Explicitly out |
| --- | --- | --- | --- |
| M1 See everything | Inventory, limits, map | Cloudflare full resource listing; OCI read-only collector (instances, shapes, power state, volumes, buckets, databases); entitlements and allowances store (editable, audited); resource vocabulary and onboarding fields; Fleet Map with filters and click-through; tiered setup checklist and built-in secret store | Any start/stop, backups, runners, Flux, GitHub |
| M2 Trust it | Health and freshness | Health checks (provider state, probes, heartbeat); freshness and staleness display; relationships (primary/backup); capacity read API and MCP tools; usage meters (Cloudflare analytics, Upstash hours) | Restore points and recommendations, actuator |
| M3 Act safely | Controlled actions | Audit trail UI, policies (recommend first), kill switch, reservations/leases and completion webhook, actuator for approve/auto on low-risk resources (for example ephemeral sandboxes or stopped standby instances); OCI always-on VMs stay `off` | Provisioning, SSH runner |
| M4 Prepare machines | Blueprints | GitHub provider, runner service with versioned blueprints (CI runner first), optional OpenTofu; Flux health source plugin | Multi-user teams, native mobile app |
| Later | | Backup freshness and restore recommendations, more providers, DPoP token binding, account-scoped agent keys, PWA polish, notifications | |

## Keep out of scope for now

- SSH or any remote command execution (until M4, and only through reviewed blueprints).
- Auto-start/stop of anything (until M3), and never for protected or always-on resources by default.
- OpenTofu/Terraform and Flux as dependencies (optional later).
- Backup and restore automation (record intent only).
- Hosting FleetHub as a multi-tenant service; the target is one operator or a small trusted team.
- Rebuilding what Steampipe or similar tools already provide for broad cloud inventory.

## Risks and mitigations

- **Stale limits:** providers change free tiers (Oracle cut the A1 pool in 2026). Limits live in a versioned, editable store with a verified date and a source; anything unverified is flagged and excluded from "available" answers.
- **Over-trusting data:** every number carries source and age; unknown is never zero.
- **Scope creep into an orchestrator:** the actuator stays narrow and policy-gated; provisioning is a separate runner.
- **Onboarding drop-off:** a new user can see value after the operator account, the built-in secret store and one provider.

## Original approval request, resolved

Approved on 2026-10-28, with reuse-first connection choices clarified on 2026-11-08: (1) a built-in encrypted secret store as the default with Infisical optional, (2) Tailscale, CLIProxy and Flux becoming optional modules instead of wizard gates, and (3) the M1-M4 order. Your own install keeps working as it is; the change affects what a new user must do.
