# Resource advisor and replaceable integrations

Decision date: 2026-11-15, clarified for personal/local use. This is the current product direction. It supersedes
conflicting product priorities in docs/44, docs/60 and docs/62. Source and tests
still define implemented behavior. Target capabilities below are not release claims.
Existing security, credential, data-retention and release gates remain in force.

## Product purpose

FleetHub is built first for an individual running it locally for their own use.
It helps an operator answer: what resources do my authorized accounts have,
what is used, what remains, which services depend on them, and which resource is
suitable for a new need? Free allowances are the focus; paid resources and expired
trials remain visible so advice does not conceal costs or dependencies.

The core journey is account -> provider/project -> resource -> allowance and usage
-> service relationships -> explained placement advice. An account can represent a
personal or family scope where the account holder has authorized access. Work and
client scopes can also be recorded with permission. Recording several owners does
not require a team SaaS product or shared credentials. The user decides where to
place a workload; FleetHub supplies facts, comparisons and optional suggestions.

FleetHub collates information. It is not an AI router, storage gateway, credential
pool, quota multiplier or infrastructure executor. A unified view does not make
separate services interchangeable or combine their quotas into one usable allowance.

## Related app accounts and credential consumers

The primary focus remains compute, storage, object storage and CDN. A secondary
use case records supporting app/SaaS accounts such as Linear without pretending
they provide cloud capacity or requiring a live integration for every service.

Example target relationship: person/contact -> Linear account -> workspace, with a
credential reference linked to the FleetHub project/app that consumes it. Account
owner, credential issuer and consuming service are distinct roles. A user may have
several accounts/workspaces and several keys; one key may have multiple consumers.

Show non-secret metadata: account/workspace label, purpose, granted scopes, environment,
expiry/revocation status when known, and which project/service/app uses the credential.
Store actual API keys only through an encrypted backend; never in graph attributes,
project descriptions, GitHub docs, Linear issues, logs or handoffs. Prefer separate
least-privilege keys per consumer where supported. Unknown validity stays unknown;
removing a local reference is not proof the upstream key has been revoked.

Start with manual account/workspace/consumer relationships. A dedicated Linear
collector, arbitrary-key storage flow and automatic key rotation are not implemented
or prerequisites. Reuse the account, credential-reference and project-link concepts
where they fit; verify schema gaps before building a parallel account system.

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
Model output cannot override user constraints, billing or protection rules or execute actions.

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

Recommendations compare workload requirements and the operator's own constraints.
Include region, protocol, security/privacy needs, expected growth, operational limits,
reset/expiry, egress and cost exposure. Explain matches, exclusions and unknowns with
source timestamps. A result is advice, not an allocation, reservation or guarantee.
Missing usage or unverified limits must remain visible; they do not prevent viewing
or comparing an account. Distinguish known technical mismatch from missing evidence.
The user makes the final decision. No provider-policy approval is required to browse,
compare or request suggestions, and no automatic failover is performed.

Each resource should show which services use it and why that relationship is believed:
manual declaration, observed telemetry or inferred configuration. Preserve source,
confidence and freshness; absence of an observed link does not prove a resource unused.
Do not infer permission to share a resource from possession of its API credential.

## Personal-use boundary

FleetHub organizes information about accounts the operator owns or has permission
to view, including family members' accounts. Keep account ownership visible instead
of treating every login as the same owner. The operator is responsible for the use
of each account and decides what is permissible for the intended workload.

Do not build a company-specific terms database, compliance engine, mandatory policy
review queue, terms-expiry gate or legal eligibility score. Unknown provider policy
must not block setup, inventory, comparison or suggestions. Optional account notes
can capture the user's own restrictions without a compulsory approval workflow.
Optional provider terms links are reference material only; no acknowledgement or
policy verification is required to use inventory, comparisons or suggestions.
Capacity scope and shared allowances still matter for accurate arithmetic; they are
inventory facts, not a legal judgement about whether the user may use an account.

Keep a short acceptable-use statement: FleetHub provides visibility and advice,
does not grant provider permissions, and does not guarantee free capacity or cost.
Do not build automated signup, access-control bypass, credential harvesting or
features intended to evade limits. Existing authentication, secret protection,
request budgets and resource protection remain engineering requirements.

## First-use priorities

Focus on compute, storage, object storage and CDN for personal projects. These are
comparison categories, not claims that all providers support every capability.

| Category | Questions FleetHub should answer |
| --- | --- |
| Compute | Which machines/services are available? CPU, RAM, architecture, region, power/health state, declared and observed load, remaining allowance, and existing workloads |
| Storage | Which disks, volumes and file stores have usable space? Capacity, used/free evidence, attachments, access method, performance constraints and backup role |
| Object storage | Which buckets/products fit? Storage, object/API compatibility, request and egress allowances, region, access/retention settings and consuming services |
| CDN | Which zones/distributions serve which origins and services? Hostnames, cache/health status, bandwidth/request usage where available, configuration limits and cost exposure |

Do not add unlike storage types together as interchangeable capacity. CDN cache
capacity is not durable object storage. Show unsupported or unknown measurements
honestly, and allow manual values with source/date when live collection is absent.
For a new project, compare relevant candidates across authorized accounts, explain
tradeoffs and dependencies, and leave selection and deployment to the user.

## Current implementation and next work

Existing: manual inventory; direct read-only collectors for Cloudflare, Upstash,
Supabase, Neon and OCI; entitlement records; project/resource links; partial usage
observations; separate host-fit checks; recommendation-only plans; built-in encrypted
secrets and optional Infisical. CLIProxy inspection is optional and has no quota reader.

Current project recommendations rank basic category/provider/billing/state and
sharing signals. They do not yet join workload requirements to allowance headroom,
measured usage or host fit. They explicitly report unverified fit. The complete
capacity-comparison model and generic AI connection described here are target work.
The pure arithmetic module separates declared allocation budgets from measured pool
headroom. Measured headroom requires fresh observations for every supplied member
and an explicit complete-inventory assertion. Callers must derive freshness from
source timestamps and verify membership for the account/provider/product scope.
Conflicting duplicate resource records, incomplete inventory and ambiguous pools
leave measured headroom unknown. Instantaneous storage and compute baselines are
supported; time-window request accounting and narrower regional scopes are not.
The object-storage helper checks explicitly recorded API support when requested.
Its fit label describes capacity/API evidence only; entitlement, access/retention,
request and egress evidence still require integration before complete suitability
advice. This helper is not yet connected to production project recommendations.

A provider-specific policy engine is explicitly out of scope.

| Order | Scope | Acceptance |
| --- | --- | --- |
| 1 | Prove the existing core journey | Disposable authenticated install with manual inventory and built-in secrets; skip external integrations; inventory and agent reads still work |
| 2 | Define capacity and usage evidence | Scope/units/freshness model and shared-allowance fixtures; no double counting; unknown stays unknown; no terms-review gate |
| 3 | Deliver the first personal comparison slice | Start with object storage using two supported adapters/manual sources; requirements, use, remaining evidence and service links; no deployment. Follow with compute, disk/file storage and CDN |
| 4 | Decouple optional integrations | Generic capability contract, isolated failure checks and endpoint safety tests; separate metadata from inference; tested compatibility retirement for bundled profiles |
| 5 | Extend coverage from demand | Add usage collectors and products through documented APIs; never count catalog entries as implemented collectors |

Outbound delivery, new provider breadth, an actuator and runner automation do not
displace this order. Existing safety defects still take priority. Runtime changes
and retirement of profiles need their own reviewed implementation and release gates.

Prepared means a documented contract. Customer-usable additionally means implemented,
tested with disposable evidence, documented limitations and safe upgrade behavior.
Track future slices as small issues using the repository's existing workflow; this
decision creates no remote issues and authorizes no deployment or migration.


## Documentation and project management

Linear is the intended home for user journeys, epics, stories, priorities, dependencies,
acceptance criteria and work status. Tracker onboarding is a separate task; no Linear
project or issue is implied to exist by this decision. Avoid parallel GitHub issue
backlogs and dated sprint plans after migration. Existing historical plans are inputs,
not an instruction to re-create already implemented work as new tickets.

GitHub retains only durable public product/architecture decisions, setup and operations,
security, contribution guidance and supported API/integration contracts alongside code,
tests and release notes. Link tracker items to relevant code/docs instead of copying
whole documents into issues. Keep implementation docs correct as work ships.

Private handoffs, audit findings, raw verification output, migration mappings and
operator-specific notes live in durable storage outside the repository, never in
system temporary directories. They must not contain secret values. Keep a current
handoff/index so future sessions can find them. Before removing an existing repo doc,
classify its stable contract content, preserve anything needed, import work items,
verify tracker links, and record the mapping. No automatic bulk deletion or archival.

## Manual object-storage comparison API

`POST /api/capacity/object-storage` accepts bounded manual snapshots from an
operator session or admin API credential. It reads no database inventory and makes
no provider calls or writes. Read-only and project-scoped credentials cannot submit
snapshots. Responses use `Cache-Control: no-store`. Maximum request body is 64 KiB,
with 20 pools, 100 resources and 50 recorded consumers per resource.

The JSON body has `need`, `pools` and `resources`:

- `need`: `estimatedBytes` and optional `preferredRegion`, `requiredApi`
  (`s3_compatible`, `oci_native`, or `any`).
- Each pool: `poolId`, `accountId`, `provider`, `product`, `allowanceBytes`,
  `inventoryComplete`, and `evidence`.
- Each resource: `resourceId`, `name`, `poolId`, nullable `region`, `observedBytes`
  and `declaredBytes`, `evidence`, optional `supportedApis`, `consumers` containing
  project/service labels, and nullable `egressNote` and `requestNote`.
- Each evidence record: `source` and nullable ISO `measuredAt` with timezone.
  Numeric amounts are nonnegative safe integers in bytes. Unknown fields, duplicate
  IDs, missing pool references and ambiguous account/provider/product pools reject.

Two or more manual sources can be compared in one request by supplying separate
pools and their members. Pool allowance must describe an instantaneous storage
entitlement; monthly byte-hours, request quotas and regional sub-pools are unsupported.
`inventoryComplete` is an operator assertion that all pool members are included.
Missing members must be represented or the assertion left false. Manual evidence
is not independently verified against a provider. Source labels must contain metadata
only, never credentials.

Results retain source timestamps, allowance freshness, usage freshness, measured
headroom, declared budgets, distinct consumers and explicit unknowns. Stale allowance
or member usage prevents a positive capacity verdict; separate accounts stay separate.
API mismatch is an exclusion even if usage is unknown. Egress/request notes are
operator notes, not validated price or quota calculations. Region is a preference,
not a hard placement constraint. `fits`/`tight` describe capacity and the requested
API only; they do not establish complete suitability or a guaranteed free balance.
`allocated` is always false. The operator chooses placement outside this endpoint.

The Limits panel links to `/compare/object-storage`, a form comparing two manual
single-bucket scopes. It requires the operator to affirm that each bucket is the
only member before showing measured headroom. Multi-bucket pools use the API.
Saved inventory integration and live usage adapters are not implemented by this slice.
