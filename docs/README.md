# FleetHub documentation

## Start here

- [Current product direction](64-resource-advisor-and-integration-boundaries.md): resource comparisons, evidence-backed advice, replaceable integrations and personal-use boundaries.

- [Historical execution plan](62-next-two-weeks.md): input for Linear onboarding; not a second live backlog. Current priorities are in docs/64 until tracker onboarding is verified.
- [Repository and release workflow](63-repository-and-release-workflow.md): canonical public repository, history boundary and merge gates.

- [Self-onboarding runbook](23-self-onboarding.md): installation commands and connection checks. Connect existing Infisical and CLIProxyAPI instances, or install either locally through its own optional Compose profile.
- [Setup tiers and the built-in store](45-setup-tiers-and-builtin-secret-store.md): independent setup connections and credential-backend behavior.
- [Reuse-first onboarding and UX plan](60-reuse-first-onboarding-and-ux-plan.md): current integration decisions, credential ownership, the database decision and delivery batches.
- [Delivery tasks](61-reuse-first-delivery-tasks.md): ordered work items and their verification status.

## Product and interface

- [Scope and guardrails](01-scope-and-guardrails.md): what FleetHub will and will not do, including personal-use and security boundaries.
- [Product scope and onboarding tiers](44-product-scope-and-onboarding-tiers.md)
- [Fleet Map and resource profiles](48-fleet-map-and-resource-profiles.md)
- [Person, email and account hierarchy](51-person-email-account-hierarchy.md)
- [Projects, needs and usage](52-projects-needs-usage-and-gitops.md), [project hooks](53-project-hooks.md) and [GitOps inference](54-gitops-and-inference.md)
- [Free-tier catalog schema and contribution rules](17-free-tier-catalog-schema.md)
- [Cloudflare products and limits](46-cloudflare-products-and-limits.md)

## Credentials, connectors and agents

- [Credential replacement and rotation](39-credential-rotation.md)
- [Live connectors](56-live-connectors.md) and [connector schedules](58-connector-schedules-and-rescan-hook.md)
- [Safe assisted orchestration](25-safe-orchestration-operating-model.md), [agent context contract](26-agent-context-contract.md) and [external-agent observations](27-observation-writeback.md)
- [Connecting agents over MCP](35-connect-agents-to-mcp.md)

## Operations

- [Documentation audit](planning/2026-11-15-plan-audit.md): inventory, drift corrections and evidence limits.

- [Low-write local Docker](34-low-write-local-docker.md) and [hot-reloaded configuration](38-hot-reload-config.md)
- [Read-only Kubernetes RBAC](assets/fleethub-readonly-rbac.yaml) and [Docker socket proxy](assets/docker-socket-proxy.compose.yml) examples
- Dated verification records live under [verification](verification/); the [testing-only agent brief](prompts/testing-only-agent.md) governs delegated test passes.

Numbered files are stable records, so numbering has gaps where earlier internal planning notes were not published. A higher number alone does not prove a feature shipped; check each document's status.

Never put private host state, credentials or local environment exports in documentation. Use placeholders such as `example.com` and documentation IP ranges.

- [Resource collection and evidence coverage](65-resource-coverage-matrix.md): implemented collectors, manual evidence, catalog-only references and unsupported measurements.

- [Offline master-key rotation](66-offline-master-key-rotation.md): transactional maintenance, separate key files and interruption recovery.

- [Backend selection and credential migration](67-backend-selection-and-migration-design.md): design for an explicit per-credential backend choice and verified, reversible migration between stores.

- [Gateway connection-only transition](68-gateway-connection-only-transition.md): unverified runbook for moving off the bundled CLIProxy and Infisical profiles with backups, rollback and owner-confirmed retirement.
