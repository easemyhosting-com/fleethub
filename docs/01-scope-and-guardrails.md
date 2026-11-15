# Scope and personal-use boundaries

FleetHub is a local, self-hosted inventory and decision aid, built first for personal
use. It brings together compute, storage, object storage and CDN resources from
accounts the operator owns or has permission to view, including family accounts.
See the [current product direction](64-resource-advisor-and-integration-boundaries.md).

The operator decides which resource to use for a task or project and is responsible
for its permitted use. FleetHub supplies inventory, usage, capacity evidence,
relationships and comparisons. It does not grant provider permissions or guarantee
free capacity, zero costs or availability.

## Product boundaries

- Keep the actual account owner and service/resource relationships visible.
- Preserve allowance scope, units and periods so shared limits are not double counted.
- Distinguish observed usage, manual estimates, catalog limits and unknown data.
- Do not require company-specific terms review or legal eligibility approval for
  setup, inventory, comparisons or suggestions. A provider-policy engine is out of scope.
- Allow optional user notes and constraints without making them onboarding gates.
- Keep AI providers, proxies, external vaults and network vendors optional and replaceable.
- FleetHub is an information and advice tool. It does not route workloads or AI
  traffic, provision resources, create accounts or perform automatic failover.

## Engineering boundaries

- Access only accounts and resources the operator is authorized to inspect.
- Use documented APIs, narrow credentials, bounded requests and polite polling.
- Do not harvest credential files, bypass authentication or add signup/limit-evasion features.
- Protect secrets, authenticate access and preserve resource-protection controls.
- Missing optional integrations must not block unrelated inventory capabilities.
- New integrations and migration steps must preserve stored inventory and user data.

These boundaries do not replace the repository's security instructions or authorize
runtime changes. Current implementation and proposed work are distinguished in docs/64.
