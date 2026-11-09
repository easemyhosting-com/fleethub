# Projects, needs, usage and GitOps (roadmap and design, 2026-11-05)

Status: proposal; build order steps 2 and 3 (schema, webhook inbox) built 2026-11-05, see [docs/53](53-project-hooks.md); GitOps ingestion and inference (read side) built the same day, see [docs/54](54-gitops-and-inference.md). Written after a full review of the open items (docs/40, 42, 43, 44, 51). Defaults below are assumptions; change them by editing this file, not by answering questions.

## What the owner asked for

1. After connecting each provider account, get a **prompt** that fetches everything about that provider, so the data shows up in FleetHub.
2. Every project of the owner is **aware of which resources exist**, and free resources are used deliberately. FleetHub keeps track of everything.
3. **Webhooks** so applications can say what they **need**, and, once allocated, what they **use**. The two directions must not depend on each other.
4. FleetHub must also **infer on its own** which project uses what, and why.
5. FleetHub works **with a GitOps repo**.

## Where we are (verified in the repo, not assumed)

| Area | State |
| --- | --- |
| Collectors | Cloudflare, Upstash, Supabase, Neon, Oracle (read-only). None yet for GitHub, Turso, Google Drive, Modal, Kaggle (catalog entries only). |
| Inventory, plans, profiles | Built: resources, plan per account, billable flag, role/lifecycle/backup profile, Fleet Map, filter bar, email tree. |
| Observations | `POST /api/observations`: signed, idempotent facts about a resource (state, metrics, services) from an agent. Resource-centric, not project-centric. |
| MCP and agent context | `get_fleet_context`, `list_resources`, `get_fleet_capacity`, `get_quotas`. Read-only. No `find_free_capacity`, no claims. |
| Capacity design | Leases, completion webhook, policies, actuator are designed, not built (M3). |
| Missing | The concept of a **project**, needs, allocations, per-project usage, inference, GitOps link, a webhook inbox for project-originated events. |

## Pending items, consolidated and ordered

Quick wins first (each shippable alone):

1. Remember ignored OCI profiles on config upload.
2. Gates that offer the fix instead of only stating the problem.
3. Per-provider "connect and fetch" prompt (below), because more accounts are about to be connected.
4. Collectors for the remaining catalog providers, GitHub first (it is also the bridge to GitOps).
5. Usage meters beyond Cloudflare and OCI allocation (Upstash hours, Supabase and Neon limits, Workers AI neurons).
6. Health and freshness (M2): probes, heartbeat, staleness shown on every tile.

Then the new product layer (this document): projects, needs, usage reports, inference, GitOps.

Then M3 as designed: audit UI, policies, kill switch, leases, actuator. Leases are the same object as an "allocation" here; do not build two.

Security and hygiene (carry over): audit trail UI, account-scoped agent keys, nonce CSP, DPoP, external notifications for expiry, Tailscale CLI upgrade, Node 26 LTS review.

## 1. Connect-and-fetch prompt (per provider)

After an account is connected and its first scan runs, the dialog shows a **"Fetch everything" prompt** specific to that provider. It is generated from a template per provider, filled with non-secret facts (account label, scope id, region, which resource kinds the collector already lists, which are still missing). The owner pastes it into any LLM agent that has the provider's CLI or MCP configured; the agent returns facts through the existing signed `POST /api/observations` path (extended with `kind: inventory_supplement` for resources the built-in collector cannot see).

Rules: the prompt never contains a secret, tells the agent to use its own already-authenticated tooling, asks for read-only calls only, and ends with the exact JSON shape to post back. Templates live in `src/lib/providers/prompts/<provider>.ts`, each with a test that asserts no credential-looking strings and that the JSON example validates against the schema.

Until the in-app version ships, I (the assistant) produce this prompt on request right after you connect an account.

## 2. Projects

New table `projects`: `id`, `slug`, `name`, `repo_url` (optional), `owner_identity_id`, `environment` (prod/staging/dev), `criticality`, `notes`. A project is a **consumer**. Resources and accounts stay as they are.

New table `project_resource_links`: `project_id`, `resource_id`, `purpose` (free text, short: "primary database", "CI runner"), `source` (`declared` | `inferred` | `gitops`), `confidence` (0 to 1, only for inferred), `first_seen`, `last_seen`, `status` (`requested` | `allocated` | `in_use` | `stale` | `released`).

The three `source` values are kept apart on purpose: declared by the project, inferred by FleetHub, read from GitOps. The UI shows each and flags **disagreement** ("declared: uses D1 `a`; observed: nothing for 30 days").

## 3. Webhooks: needs and usage, independent of each other

Two inbound endpoints, two different secrets, no ordering requirement:

- `POST /api/hooks/needs` — a project says what it needs: kind (compute, database, storage, llm, ci), size hints, duration, placement preferences, why. FleetHub answers with a **recommendation** (which free resource fits and why, or "nothing free; here is the cheapest paid option") and, when policy allows, creates a **lease/allocation** (docs/42). Recommend-only until M3.
- `POST /api/hooks/usage` — a project reports what it actually uses: resource, amount, period, optional metrics. Accepted even if no need was ever declared (this is how undeclared use shows up). A usage report for something never allocated creates an `inferred`/`declared` link flagged **unallocated**.

Neither endpoint requires the other. A project may only declare needs, only report usage, or both. FleetHub never blocks a usage report because the need was missing, and never assumes an allocation means usage.

Security (same pattern as the observations route): per-project secret generated once and stored hashed; HMAC over timestamp plus body; five-minute window; idempotency key; per-source rate limit; strict schemas with unknown keys rejected; a payload can name a resource or amount but can never carry a command; nothing in it is executed. Outbound: a `needs.decided` and `allocation.changed` webhook to a project-supplied HTTPS URL, signed the same way, so projects learn the answer without polling.

Agents get matching MCP tools: `find_free_capacity`, `declare_need`, `list_project_usage`, `get_project_footprint`.

## 4. FleetHub infers on its own

Inference never depends on project cooperation. Sources, strongest first:

1. **GitOps repo** (section 5): manifests name workloads, namespaces, hosts and resources. Highest confidence.
2. **Provider metadata**: resource names, tags and labels, Cloudflare Workers routes and bindings (a Worker bound to a D1 or KV tells you who uses it), DNS records pointing at an origin, GitHub repo and Actions usage, OCI display names and freeform tags.
3. **Name and tag matching** against project slugs (weak, low confidence, always labelled "guess").
4. **Observed traffic or usage** where a provider exposes it (analytics per Worker, per database).

Every inferred link stores its **evidence** (which fact, where from, when) so the "why" is answerable: "linked to project X because Worker `x-api` is bound to KV `x-cache` (Cloudflare, read 2026-11-05)". Low-confidence links are shown as suggestions; the owner confirms or rejects once, and the choice is remembered. Unlinked resources are listed as **orphans**, which is the main list for deciding what is free to reuse or stop.

## 5. GitOps collaboration

Principle: **the GitOps repo is the source of truth for desired state; FleetHub is the source of truth for what exists and what is free.** FleetHub reads the repo and proposes changes; it does not push to it.

- **Read** (first): a GitHub connector (read-only fine-grained token) clones or lists a configured repo and path, parses Flux `Kustomization`, `HelmRelease`, `Deployment`/`Ingress` metadata and an optional `fleethub.yaml` per app, and produces `gitops` links (project to resource) plus drift ("manifest says 2 replicas on node A; node A is stopped").
- **Declare** (optional, recommended): each app directory may carry `fleethub.yaml` with the project slug, needs, and the webhook secret reference name. This lets a project declare needs without writing any HTTP client.
- **Propose** (later, M4): when FleetHub allocates a resource, it opens a **pull request** against the GitOps repo (for example binding a project to a database or runner) with the reasoning in the description. A human merges; Flux applies. FleetHub never has write access to the cluster for this path and never merges its own PRs.
- Flux health (Kustomization/HelmRelease readiness) enters as a health source plugin (docs/44), read-only kubeconfig.

## 6. Dashboard: project footprint

Add a **Projects** tab. One row per project: what it has (allocations and links), what it uses (latest usage, gauge against the free allowance), source badges (declared / observed / GitOps), disagreements, and cost exposure (any billable resource). A resource drawer gains "Used by". An **Orphans and idle** view lists resources with no project and low usage: candidates to reuse. The filter bar gains a Project filter, and the Fleet Map can group by project.

The fleet Project filter uses `?project=<slug>` and shares the current tab through `view`. It includes allocated or in-use links from project reports and GitOps. Inferred links also require a current owner confirmation. Archived projects, archived accounts, and missing resources are excluded. `GET /api/fleet`, `GET /api/inventory`, and `GET /api/identities` accept the project slug. The Projects view reads the selected project's usage and requests confirmed links from `GET /api/projects/footprint?project=<slug>&confirmedOnly=true`.

## Build order

1. Quick wins 1 to 3 above, plus the in-app fetch prompt for the five existing providers.
2. Schema and API: `projects`, `project_resource_links`, `needs`, `usage_reports`; strict schemas; tests on a disposable DB.
3. Webhook inbox: `/api/hooks/needs` and `/api/hooks/usage`, per-project secrets, signature and replay tests, outbound decision webhook.
4. Projects tab and "Used by" in the drawer; disagreement and orphan views.
5. GitHub connector (read-only) then GitOps parser and `fleethub.yaml`; inference engine with evidence.
6. MCP tools for agents.
7. M3 leases and policies, reusing the allocation object. Then PR-proposal back to the GitOps repo (M4).

## Assumptions to correct by editing

- Projects are owned by a person (identity) and live inside the single-operator model; no teams yet.
- Recommend-only until M3; nothing starts, stops or provisions because of a webhook.
- GitOps repo is on GitHub, uses Flux layout, and FleetHub gets read-only access.
- Usage reports are trusted only as far as the project's secret; observed facts from providers outrank them when they disagree, and both are kept.
- A project that stops reporting is shown as **stale**, never silently as zero.
