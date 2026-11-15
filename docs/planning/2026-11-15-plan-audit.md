# Plan and documentation audit, 2026-11-15

## Baseline and outcome

Public main `b7e032b`, after PR #12. The working planning branch starts at that
commit and contains documentation changes only. Repository metadata confirms that
public and historical private repositories are independent, not a transfer or
fork pair. Public main's seven required check names and strict/linear/conversation
requirements were checked through GitHub's protection API. No settings were changed.

The highest-impact defect was contradictory work status. R0-R10 are implemented,
but several current entry points still called R7, R10, project filtering, MCP,
PostgreSQL limiting and scheduled connectors pending. Implementing that prose
would duplicate features and risk changing settled contracts. The revised reading
order starts at docs/62 and directs new contributions to the public repository.

This report is an audit of the existing product plan, not new authorization for
automation, execution or credential access. [The execution plan](../62-next-two-weeks.md)
contains the sequenced task briefs, acceptance cases and explicit start gates.

## Consequential corrections checked against source

| Old claim | Verdict and correction | Evidence |
| --- | --- | --- |
| R7 and non-LLM authorization still pending | Contradicted; implemented | Public PRs #7-#9; `src/lib/fleet/filters.ts`, `src/lib/projects/fleet-scope.ts`, `src/lib/gitops/github-authorization.ts`; R7/R10 evidence in docs/61 |
| Project hooks use Redis | Contradicted; PostgreSQL in non-local production | `src/lib/projects/hook-auth.ts`, `src/lib/auth/rate-limit.ts`, `tests/rate-limit.integration.test.ts` |
| Connector rescans are manual only | Contradicted; schedules and scoped queue hook exist | `src/lib/connectors/schedule.ts`, `src/app/api/hooks/rescan/route.ts`, docs/58 |
| GitOps pull requires only an environment token | Incomplete; operator GitHub App authorization takes precedence | `src/app/api/gitops/sync/route.ts`, `tests/github-authorization.integration.test.ts` |
| MCP transport/tools missing, or exactly six/eight tools | Contradicted; nine tools with local stdio transport | `src/lib/mcp/tools.ts`, `src/mcp/server.ts`, `tests/mcp-server.test.ts` |
| All integrations gate credentialed onboarding | Contradicted; one verified secret backend suffices | `src/lib/onboarding/model.ts`, `tests/builtin-vault.test.ts`, docs/45 |
| Fetch prompt can submit inventory supplements | Unsupported as an implemented contract | Prompt builder returns manual JSON; `src/lib/observations/report.ts` accepts registered-resource reports, not arbitrary inventory creation |
| Project link status means reserved capacity | Contradicted as an execution promise | `src/lib/projects/store.ts`, `src/lib/projects/recommend.ts`: recommendation only, `allocated:false`; no outbound delivery worker |
| GitHub App implies GitHub inventory support | Contradicted | `supportsInventory` allows Cloudflare, Upstash, Supabase, Neon and Oracle; App authorization belongs to GitOps reads |
| Green local tests mean authenticated deployed app accepted | Unsupported | Existing LUNA and fixture records explicitly limit coverage; N2 closes that evidence gap |

No provider pricing, quota entitlement, comparative market positioning or service
terms were newly confirmed. Their existing verification flags remain authoritative.
Do not promote catalog values from reported/unverified to verified based on this audit.

## Documentation inventory and owner

Each numbered record remains at its existing path. Current capability docs own
contracts; dated verification owns historical evidence. This table identifies the
role and treatment of every top-level documentation entry, including unchanged ones.

| File | Role and audit treatment |
| --- | --- |
| `README.md` | Install/product entry; corrected MCP count, added public contribution target and plan |
| `AGENTS.md` | Framework constraints; retained Next.js-managed block; no application code changed |
| `SECURITY.md` | Private reporting policy; retained, separate from operational vulnerability scanning |
| `docs/README.md` | Current navigation; added plan, repository workflow and this audit |
| `01-scope-and-guardrails.md` | Policy boundary; preserved; external provider terms need fresh verification before scope changes |
| `17-free-tier-catalog-schema.md` | Catalog/reset contract; preserved explicit billing-cycle estimate limitation |
| `23-self-onboarding.md` | Install/upgrade runbook; retains explicit profiles, HTTPS/HTTP opt-in, backup and empty-scan rules |
| `25-safe-orchestration-operating-model.md` | Historical research and deferred security gate; added current setup/MCP status warning |
| `26-agent-context-contract.md` | Context contract; corrected transport and global setup-gate drift; retained historical counts |
| `27-observation-writeback.md` | Strict unverified-report API; no resource-creation/import promise; retained |
| `34-low-write-local-docker.md` | Optional local operations recipe with dated measurements; not a runtime prerequisite |
| `35-connect-agents-to-mcp.md` | Current stdio setup and tool descriptions; added supported project filter |
| `38-hot-reload-config.md` | Runtime versus restart configuration boundary; retained |
| `39-credential-rotation.md` | Existing provider credential replacement/rotation contract; distinct from absent built-in master-key rotation |
| `44-product-scope-and-onboarding-tiers.md` | Approved historical M1-M4 themes; added current-plan pointer and shipped-baseline warning |
| `45-setup-tiers-and-builtin-secret-store.md` | Current backend contract; removed obsolete future-M1 list; master-key migration gaps remain explicit |
| `46-cloudflare-products-and-limits.md` | Inventory/entitlement contract; corrected general MCP absence without claiming measured quotas |
| `48-fleet-map-and-resource-profiles.md` | Map/profile contract; removed ambiguous default-view claim; identity Graph remains intact |
| `51-person-email-account-hierarchy.md` | Implemented hierarchy with old problem statement; explicitly labelled historical baseline |
| `52-projects-needs-usage-and-gitops.md` | Design record; added current status, removed dangling unpublished-doc references, clarified link versus lease |
| `53-project-hooks.md` | Current needs/usage API; corrected limiter, pending filter/inference and tool-count drift |
| `54-gitops-and-inference.md` | Read-side API; corrected App auth and separated live connector evidence from full drift detection |
| `56-live-connectors.md` | Connector contract; replaced obsolete manual-only claim with schedule/hook reference |
| `58-connector-schedules-and-rescan-hook.md` | Scheduling, recovery and process-local hook-limit boundary; retained browser coverage limits |
| `60-reuse-first-onboarding-and-ux-plan.md` | Approved decisions; corrected pending R7/R10/project filter and linked current plan |
| `61-reuse-first-delivery-tasks.md` | Completed R0-R10 and publication evidence; linked next work; optional reviewer install is not a new gate |
| `62-next-two-weeks.md` | New bounded execution sequence, task contracts, failure cases, smaller-model brief and deferrals |
| `63-repository-and-release-workflow.md` | New public ownership/history, contribution, CI/review and cleanup contract |
| `stack-review/2026-11-15.md` | Dated dependency patch evidence; its private-CI billing statement is historical, not current runner status |
| `prompts/testing-only-agent.md` | Delegated QA constraints; reused by N2, no production DB/credential substitution |
| `assets/*` | Existing read-only RBAC/socket-proxy examples; not automatically installed or broader permissions |

## Verification records

The eight dated records under `docs/verification` retain their original scope:
architecture second opinion, capabilities/diagnostics, CLIProxy reference review,
LUNA app test, public release, R8/R9, first reuse-first batch,
and security continuation. Public-release follow-ups remain within the same record.
The first-batch and security-continuation records now explicitly point to current
status because they contain obsolete pending-work lists. Others remain evidence,
not an ordered backlog. Test counts and live claims were not rewritten retroactively.

Historical release reports show seven required checks and CodeRabbit installed.
Current API inspection confirms those gates. Dependabot automatic security updates
are currently disabled; that is separate from dependency alerts and the existing
audit/lockfile CI. Greptile remains optional and uninstalled per existing evidence.
No new security-control settings or paid integrations were enabled.

## Scope proposal

ADD the public contribution workflow, current reading order, evidence baseline and
smaller-model task contracts. EXTEND existing authenticated acceptance coverage and
fix only defects it demonstrates. INTEGRATE outbound delivery only after a reviewed
N4 contract; the existing inbound hooks remain unchanged. DEFER new provider meters,
GitHub collector implementation, HTTP MCP/OAuth and M3/M4 execution. REJECT a new
datastore, broad UI rewrite or multi-tenant platform as part of this window.

The top near-term items are N0 documentation alignment, N1 exact-head release
verification, N2 authenticated disposable-data acceptance, N3 bounded defect fixes,
and N4 outbound contract design. N5 implementation depends on N4 acceptance; N6 is
a research fallback. Source paths, test starting points, dependency order and done
states are in docs/62 so this report does not become a duplicate task tracker.

## Evidence limits

Fable 5.2 was requested for an independent parallel audit but its provider rejected
the run due to rate limiting. It produced no usable report. The requested GLM Flash Free documentation review also failed before producing findings because its free usage limit was exhausted. This is the primary
agent's source-backed audit, not an independent second opinion. No fresh product
runtime, provider account, authenticated browser, migration, deployment or restore
was exercised. Required CI and actual review still govern this documentation PR.
