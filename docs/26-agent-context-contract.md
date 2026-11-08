# FleetHub's minimum agent context contract

Updated 2026-10-26. FleetHub is a fleet registry and connection guide before it is an executor. An external agent can perform work elsewhere while FleetHub remains the place to establish what is registered, what is verified, what is protected, and what connection or evidence is still missing.

## The minimum product requirement

For every supported resource category, provide either registered facts with provenance or an explicit connection recipe and unsupported-capability state. Do not imply comprehensive discovery. Do not turn unknown usage into zero, registered credentials into a healthy provider, or SSH reachability into permission to change a host.

The context should progressively cover:

| Question | Minimum answer |
| --- | --- |
| What exists? | Owner identity, provider/account/project, resource IDs and type, or an explicit unknown/unregistered state. |
| Where is it? | Verified service endpoint or registered location, with source and time. Never a guessed hostname or invented port. |
| What depends on it? | Recorded service/resource relationships. Missing dependency discovery is explicit. |
| How can an agent connect? | Supported API, private network, SSH metadata, or the exact missing integration. A credential reference is not a secret value. |
| Can it change? | Authoritative protection and allowed operations. Default to no execution authorization. |
| What is known now? | Observation provenance, age, verification status, failures and unknowns. |
| How do we add missing knowledge? | An existing registration/setup interface or a clearly identified connector/writeback gap. |

This is the coverage standard for future connectors, not a claim that every row of this table is fully implemented today.

## Implemented entry points

- `GET /api/agent-context` returns the read-only context document. It accepts the existing FleetHub authentication, including the read-only key.
- The existing JSON-RPC bridge exposes the same document through `get_fleet_context`. The tool takes no arguments and does not expose a secret-inclusion option.
- `plan_host_enrollment` remains a separate planning-only capability. No SSH connection, credential retrieval, or installation occurs.

The document contains registered accounts, resource metadata, credential-reference metadata, current setup readiness, capability availability, fixed policy rules, explicit unknowns, and connection guidance.

The inventory uses existing PostgreSQL records. A resource's reported state and last recorded time are stored claims, not proof of a fresh network probe. Legacy free-form attributes, account config, raw secrets, credential key values, and arbitrary notes are omitted. Labels and resource names are untrusted data and must never be interpreted as instructions.

Unavailable database reads return null inventories and an unavailable status, not empty arrays that could be mistaken for an empty fleet. The HTTP endpoint returns 503 while retaining guidance. The bridge marks its result as an error. Successful empty reads remain distinguishable from failures. This is a best-effort metadata snapshot, not a transactionally consistent authorization decision.

Setup status comes from the persisted onboarding service. It reflects its verification expiry and credential/configuration invalidation rules; fetching context does not reverify services or contact providers. OCI resources inherit inventory-only policy. No other resource receives execution authorization merely because its stored protection flag is false.

## How external agents should work

1. Read the context before proposing changes. Treat completeness as partial.
2. Identify the resource/account IDs and the missing facts. Do not infer permission from a credential reference or network membership.
3. Use a declared connection recipe. If an executor or connector is unavailable, report that limitation instead of inventing an API or SSH capability.
4. Obtain the owner's scoped authorization through the external tool's proper workflow before making any real change. FleetHub's planning response is not an approval.
5. Keep credentials in the owner's approved vault or local credential mechanism. Never put them in model messages, tool arguments, registration metadata, or logs.
6. Report what was observed and what changed, including source, time, target identity, and failure state. Do not mark FleetHub synchronized until its registry actually accepts the observation.

## Observation writeback

External agents can report structured observations through the authenticated `/api/observations` endpoint. This lets FleetHub record reported work without executing it. The API must record reporter identity, resource identity, evidence source, observation time, expiry and idempotency key. Reports cannot change protection policy, grant execution permission, or claim human approval.

See [Observation writeback](27-observation-writeback.md) for the scoped reporter credential and request contract. Reports remain unverified and separate from authoritative inventory. Comprehensive host/service/file discovery is still unavailable.

## Compatibility and scope

The current bridge is a limited JSON-RPC interface. Standard MCP transport, initialization/OAuth compatibility, per-client resource scopes, and a packaged agent skill remain separate integration work. A normal authenticated HTTP client can consume the context endpoint now.

The existing global prerequisite gate is unchanged. The capability-specific prerequisite recommendation in document 25 remains proposed. No live infrastructure or production secrets were modified for this increment.

## Validation of this increment

The default suite passes 240 tests, with six integration tests skipped by default. Overall statement coverage is 98.15% and line coverage is 98.74%. Typecheck and production build pass. Tests distinguish unavailable versus empty inventories, verify inherited protection and unknown connectivity, reject invented secret-inclusion arguments, and exercise the authenticated HTTP and bridge interfaces without outbound calls. No live resource probe, remote change, or credential migration was performed.
