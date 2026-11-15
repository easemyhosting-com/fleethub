# Resource advisor and replaceable integrations

Decision date: 2026-11-15. This is the current product direction. It supersedes
conflicting product priorities in docs/44, docs/60 and docs/62. Source and tests
still define implemented behavior. Target capabilities below are not release claims.
Existing security, credential, data-retention and release gates remain in force.

## Product purpose

FleetHub helps an operator answer: what resources do my authorized accounts have,
what is used, what remains, which services depend on them, and which resource is
suitable for a new need? Free allowances are the focus; paid resources and expired
trials remain visible so advice does not conceal costs or dependencies.

The core journey is account -> provider/project -> resource -> allowance and usage
-> service relationships -> explained placement advice. An account can represent a
personal, work or client scope only where the operator has permission to manage it.

FleetHub collates information. It is not an AI router, storage gateway, credential
pool, quota multiplier or infrastructure executor. A unified view does not make
separate services interchangeable or combine their quotas into one usable allowance.

## Minimum useful installation

FleetHub owns its web application, worker and PostgreSQL data. Keep PostgreSQL as
the supported database; this decision adds no second database engine. An operator
can register accounts and manual resources without any external integration or AI.
Credentialed collection additionally needs a configured encryption key and verified
built-in secret backend, or another verified supported backend. Authentication,
TLS for remote access and secure secret storage are not optional safety measures.

Do not require an external vault, AI provider, router, private network vendor,
GitOps controller or observability stack to get inventory value. A missing,
skipped or failed optional connection affects only capabilities that consume it.

## Integration contract

Each adapter declares its version, supported operations, authorization scopes,
collection coverage, quota scope, response limits and freshness. Separate inventory,
usage, health, inference and administration capabilities; passing one proves none
of the others. Support manual records when an official collection API is absent.
Manual records retain provenance and do not imply verified live capacity.

Use documented APIs with least-privilege, operator-supplied credentials, bounded
responses, pagination, backoff and per-provider request budgets. No provider dashboard
scraping, credential-file harvesting or bypass of official authorization flows.
Connections use explicit approved origins, verified TLS and redirect restrictions;
private-network support needs deliberate SSRF protections, not unrestricted URLs.

Replacing a connection must preserve account/resource IDs, history and service links.
Keep credentials backend-specific and migrate them only through an explicit
copy/verify/switch process with rollback. Disconnect must preserve inventory and
mark observations stale; it must not delete upstream resources or persistent volumes.
Adapters are reviewed code, not arbitrary remotely installed plugins.

### Optional AI

The default is no AI service. Deterministic filters, comparisons and placement
explanations must remain useful without a model. Existing external agents can use
the read-only MCP interface without FleetHub operating an inference service.

The target optional AI connection accepts an operator-selected endpoint, protocol,
model and credential reference. Treat OpenAI-compatible Chat Completions, Responses
and Anthropic-compatible Messages as separate capabilities, not one compatibility
checkbox. Test only implemented contracts; a model list is not proof of inference,
quota telemetry, tool support or upstream availability. No billable inference probe
without explicit consent. Generic endpoint support is not implemented yet.

CLIProxyAPI is one possible external adapter. Other proxies, direct authorized APIs
and local model servers should fit the same capability boundaries. Gateway management
and quota telemetry are separate optional adapters, never prerequisites for inference.
FleetHub does not own provider login, token refresh, model routing or failover.
Protocol compatibility does not establish permission to use subscription credentials.

No inventory leaves FleetHub for AI by default. An optional assistant needs explicit
opt-in, a visible destination and minimum redacted context; never send credentials.
Model output cannot override eligibility, billing or protection rules or execute actions.

### Simple alternatives and packaging

| Capability | Default / simple path | Optional external path |
| --- | --- | --- |
| Account and resource ledger | Manual records in PostgreSQL | Official provider inventory adapters |
| Credential storage | Built-in encrypted store with externally held master key | Verified secret-backend adapter |
| Capacity advice | Deterministic requirements and evidence checks | Opt-in AI explanation using approved context |
| Agent access | Existing read-only MCP integration | User's own compatible agent client |
| Model inference | None required | Direct API, existing proxy or local model server |
| Health / service links | Provider state and explicit service relationships | Supported probes, reporters and observability adapters |
| Remote access | Operator-managed secure ingress | Optional private-network integration |

A local model server such as Ollama is a possible no-subscription inference option,
not a requirement or a zero-cost promise. Hardware, model licenses and supported
API subsets still matter. Do not build a new router to replace an existing router.

Target distribution: external services have their own installation and lifecycle.
FleetHub provides connection guidance and optional separate recipes, not a maintained
bundled AI gateway. Existing CLIProxy and legacy integration Compose profiles still
exist. Retire them in a compatibility change with a connection-only replacement,
backup/restore and rollback instructions, stable volume ownership and no automatic
stop, removal or deletion. This decision does not change running services.

## Capacity and suitability evidence

Use capability-level products, not provider names alone. For an object-storage need,
compare supported object APIs, region, access model, object size, storage capacity,
request operations, egress, retention and lifecycle behavior. A provider's internal
storage or database capacity is not automatically a user-facing object-storage service.
Verify each product's current availability and the account's actual entitlement.

Keep separate: catalog allowance, account entitlement, measured usage, declared
allocations, reservations and estimated demand. Deduplicate shared allowance scopes
before roll-ups. Do not subtract allocations from usage when usage already includes
them. Only derive remaining capacity from compatible units, scope, period and fresh
observations; absent or stale measurements remain unknown. No cross-provider total
may be presented as a single deployable resource or a guaranteed free balance.

Recommendations apply eligibility and workload constraints before ranking. Include
region, protocol, security/privacy requirements, expected growth, operational limits,
reset/expiry, egress and cost exposure. Explain matches, exclusions and unknowns with
source timestamps. A result is a candidate, not an allocation, reservation or guarantee.
Keep unknown-policy and unknown-capacity entries visible for review, outside the
verified-suitable result set. No automatic failover around provider limits.

Each resource should show which services use it and why that relationship is believed:
manual declaration, observed telemetry or inferred configuration. Preserve source,
confidence and freshness; absence of an observed link does not prove a resource unused.
Do not infer permission to share a resource from possession of its API credential.

## Provider terms and account safety

Record policy at the provider/product/plan and relevant person, organization, billing
account, project or region scope. Policy facts need an official source, reviewed date,
reviewer and review-expiry rule. Distinguish confirmed restrictions, operator-specific
permission, unknown and stale policy. An acknowledgement is not provider permission.

Inventory may describe restricted resources, but recommendations must not present
prohibited use as suitable. Unknown or stale material policy needs review before a
verified-suitable recommendation. Terms can change; no ban-proof or legally certified
claim is possible. Provider enforcement decisions remain outside FleetHub's control.

Never create accounts, multiply free quotas through identities, rotate credentials
or networks to bypass limits, spoof official clients, scrape protected dashboards,
resell restricted credentials or generate traffic merely to avoid idle reclamation.
On quota exhaustion, advise waiting, reducing usage, permitted alternatives or a paid
plan. Do not rotate to another prohibited account or promise that owning it suffices.
Different authorized organizations are not automatically interchangeable capacity pools.

API protocol compatibility, an open-source license and a successful login are each
separate from provider permission. Learn interface boundaries from other projects;
do not inherit a proxy's supported authentication methods as FleetHub policy approval.
Consumer subscriptions, commercial APIs and approved native-agent use need distinct
reviews. Preserve official restrictions even when an intermediary can technically
forward a request. Do not label a whole provider prohibited when only a method is.

## Current implementation and next work

Existing: manual inventory; direct read-only collectors for Cloudflare, Upstash,
Supabase, Neon and OCI; entitlement records; project/resource links; partial usage
observations; separate host-fit checks; recommendation-only plans; built-in encrypted
secrets and optional Infisical. CLIProxy inspection is optional and has no quota reader.

Current project recommendations rank basic category/provider/billing/state and
sharing signals. They do not yet join workload requirements to allowance headroom,
measured usage or host fit. They explicitly report unverified fit. The complete
policy model and generic AI connection described here are target work.

| Order | Scope | Acceptance |
| --- | --- | --- |
| 1 | Prove the existing core journey | Disposable authenticated install with manual inventory and built-in secrets; skip external integrations; inventory and agent reads still work |
| 2 | Define capacity and policy evidence | Reviewed scope/units/freshness model and shared-quota fixtures; known restrictions exclude candidates; unknown stays unknown |
| 3 | Deliver one storage comparison slice | Supported object-storage products from at least two verified adapters/manual sources; requirements, use, remaining evidence, service links and exclusions; no deployment |
| 4 | Decouple optional integrations | Generic capability contract, isolated failure checks and endpoint safety tests; separate metadata from inference; tested compatibility retirement for bundled profiles |
| 5 | Extend coverage from demand | Add usage collectors and products with official API/terms evidence; never count catalog entries as implemented collectors |

Outbound delivery, new provider breadth, an actuator and runner automation do not
displace this order. Existing safety defects still take priority. Runtime changes
and retirement of profiles need their own reviewed implementation and release gates.

Prepared means a documented contract. Customer-usable additionally means implemented,
tested with disposable evidence, documented limitations and safe upgrade behavior.
Track future slices as small issues using the repository's existing workflow; this
decision creates no remote issues and authorizes no deployment or migration.
