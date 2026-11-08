# 17 — Free-Tier Catalog: Schema & Contribution Rules

> **Status:** Spec v1 · 2026-10-24
> **Purpose:** Define `fleethub-catalog`, a machine-readable, community-maintained dataset of provider free tiers: limits, reset windows, how usage can be observed, and the provider's multi-account policy. It is the single source of truth that FleetDeck's quota clock, alert rules and MCP server read from.
> **Why it exists:** limits and reset semantics are **data, not code**, and a good public catalog is the most shareable artifact this project can produce.

---

## 1. Design rules

1. **One file per provider** (`providers/<id>.yaml`). A provider adds entries; it never needs TypeScript.
2. **Every number has a source and a date.** `source_url` + `verified_at` are mandatory on every meter. CI rejects entries whose `verified_at` is older than 180 days (warning at 90).
3. **Reset windows are declarative.** Six window kinds cover every provider we know (§3.1). No per-provider strategy classes.
4. **Observability is explicit.** Each meter says *how* FleetHub can know current usage: `api`, `derived`, `manual`, or `none` (§4). The UI must show this.
5. **Policy is first-class.** Each provider records its multi-account stance with a quoted clause and URL (§5). The UI warns on it; the catalog never advises how to get around it.
6. **No credentials, no account data.** The catalog is public, static and safe to vendor into any project.

## 2. File layout

```
fleethub-catalog/
├─ schema/catalog.schema.json        # JSON Schema (generated from the Zod source of truth)
├─ providers/
│  ├─ cloudflare.yaml
│  ├─ github.yaml
│  ├─ neon.yaml
│  └─ …
├─ CONTRIBUTING.md                   # "every number needs a URL and a date"
└─ .github/workflows/validate.yml    # schema validation + staleness check + link check
```

Published as: the raw YAML, a bundled `catalog.json` (GitHub release asset), and an npm package `@fleethub/catalog` with types.

## 3. Schema

```yaml
# providers/<id>.yaml
id: cloudflare                       # stable slug, matches IProviderPlugin.id
name: Cloudflare
homepage: https://www.cloudflare.com
pricing_url: https://www.cloudflare.com/plans/developer-platform/

policy:
  multi_account: unspecified         # prohibited | restricted | allowed | unspecified
  org_alternative: true              # provider supports orgs/teams/multiple projects under one identity
  clause: null                       # exact quote (<= 50 words) when prohibited/restricted
  clause_url: null
  verified_at: 2026-10-24

offerings:
  - id: workers                      # unique within provider
    kind: serverless                 # compute | gpu | serverless | storage | database | kv | queue | network | ci | llm
    plan: free                       # free | always_free | credits | trial
    meters:
      - id: requests
        unit: requests               # requests | tokens | commands | hours | gpu_hours | ocpu_hours | gb_month | gb | minutes | usd | ops
        limit: 100000
        scope: account               # account | project | database | instance | identity
        window: { kind: daily, tz: UTC }
        on_exceed: error             # error | throttle | pause | bill | suspend | unknown
        observe:
          method: api                # api | derived | manual | none
          endpoint: "GraphQL Analytics API (workersInvocationsAdaptive)"
          token_scope: "Account Analytics:Read"
        source_url: https://developers.cloudflare.com/workers/platform/limits/
        verified_at: 2026-10-24
        notes: null
```

### 3.1 Window kinds (the only "quota strategies")

| `window.kind` | Fields | Example | Next reset |
|---|---|---|---|
| `daily` | `tz` (default `UTC`) | Cloudflare Workers requests | next 00:00 in `tz` |
| `calendar_month` | `tz` | most monthly allowances | first instant of next month in `tz` |
| `billing_cycle` | `anchor: account` | GitHub Actions minutes, Modal credits | account-specific anchor intended; current engine falls back to the first day of the next month at 00:00 UTC |
| `session_duration` | `maxHours` | notebook session caps | per session; the cap bounds one continuous session, not a consumption total |
| `rolling` | `days` | Kaggle weekly GPU hours | continuous, with no reset instant; "available" = limit − usage in the trailing `days` |
| `none` | — | storage caps, instance-shape caps | never; it's a capacity ceiling, not a consumption window |

The quota engine provides two core pure functions, `getNextResetDate(window, now?)` and `evaluateQuota(limit, used, window, now?)`, each with unit tests. The latter returns `projectedOverage` with the current usage and reset details. If a provider can't be described with one of these, add a window kind in a reviewed PR. Don't add an escape hatch.

Account-specific billing-cycle reset dates are not implemented. The engine accepts no account anchor date; `getNextResetDate` returns the next calendar month's first day at 00:00 UTC for `billing_cycle`, and `evaluateQuota` uses that fallback for valid inputs. Treat it as an estimate, not the account's verified billing reset.

### 3.2 Observability levels (displayed as a badge on every meter)

| `observe.method` | Meaning | UI badge | Quota-clock math |
|---|---|---|---|
| `api` | An official API returns current usage | none (default) | exact |
| `derived` | Computed from other API data (e.g. instance uptime × OCPU) | `≈ estimated` | shown with `~` prefix |
| `manual` | User enters usage; FleetHub reminds them to update | `✎ manual · 3d old` | greyed after 7 days without an update |
| `none` | No reliable way to know | `? unknown` | excluded from totals, listed separately |

**Totals rule:** aggregate headers (e.g. "Compute hours left this month") sum only `api` and `derived` meters and state how many `manual` or `none` meters were excluded. Never mix confidence levels without saying so.

### 3.3 Zod source of truth (excerpt)

```ts
export const Window = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), tz: z.string().default("UTC") }),
  z.object({ kind: z.literal("calendar_month"), tz: z.string().default("UTC") }),
  z.object({ kind: z.literal("billing_cycle"), anchor: z.literal("account") }),
  z.object({ kind: z.literal("rolling"), days: z.number().int().positive() }),
  z.object({ kind: z.literal("session_duration"), maxHours: z.number().positive() }),
  z.object({ kind: z.literal("none") }),
]);

export const Meter = z.object({
  id: z.string(),
  unit: z.enum(["requests","tokens","commands","hours","gpu_hours","ocpu_hours","gb_month","gb","minutes","usd","ops"]),
  limit: z.number().nonnegative(),
  scope: z.enum(["account","project","database","instance","identity"]),
  window: Window,
  on_exceed: z.enum(["error","throttle","pause","bill","suspend","unknown"]),
  observe: z.object({
    method: z.enum(["api","derived","manual","none"]),
    endpoint: z.string().optional(),
    token_scope: z.string().optional(),
  }),
  source_url: z.string().url(),
  verified_at: z.coerce.date(),
  notes: z.string().nullable().optional(),
});

export const Policy = z.object({
  multi_account: z.enum(["prohibited","restricted","allowed","unspecified"]),
  org_alternative: z.boolean(),
  clause: z.string().max(400).nullable(),
  clause_url: z.string().url().nullable(),
  verified_at: z.coerce.date(),
}).refine(p => p.multi_account === "unspecified" || p.multi_account === "allowed" || (p.clause && p.clause_url),
  { message: "prohibited/restricted policies must quote the clause and link it" });
```

## 4. How FleetDeck uses the catalog

- **Meter templates:** when a user registers an account, FleetDeck creates `quota_meters` rows from that provider's catalog entry (limit, window, unit). Users can override `limit` (e.g. a paid plan), and the override is stored, never written back.
- **Collectors:** a plugin only has to return `{ meter_id, value, observed_at }` for meters with `observe.method: api | derived`. Everything else (percentages, burn rate, reset countdown, alert state) is computed centrally from catalog data.
- **Policy warnings:** if one owner identity has more than one account at a provider whose `policy.multi_account` is `prohibited` or `restricted`, the Account view shows a non-dismissable banner with the quoted clause and link. FleetDeck still works; it just doesn't pretend the risk isn't there.
- **MCP / capacity API:** responses include `observe.method` and `verified_at` per meter so agents can discount stale or manual numbers.

## 5. Policy field: what goes in and what stays out

**In:** the provider's own words (short quote), the URL, the date, and whether an org/team/project structure exists as the legitimate way to separate workloads.

**Out:** any advice on avoiding detection, linking or not linking accounts, using separate cards, phones or IPs, or anything else that helps someone get around a provider's limits. PRs that add this content are closed. This is a hard project rule (see items 8 and 9 of `01-scope-and-guardrails.md`).

## 6. Launch scope

**LLM providers:** the catalog records **provider-level** entries only: policy (personal-use / evaluation-only / production clauses, one-account rules) and headline per-account limits. **Per-model limits and model lists are not duplicated here.** They come from the gateway on your own gateway installation, whose catalog is its maintainer's work and partly a paid feed.

Ship the catalog **before** the dashboard, with these providers fully specified (meters and policy):
Cloudflare (Workers, R2), GitHub (Actions, Codespaces, Packages), Neon, Supabase, Upstash (Redis, QStash), Turso, Backblaze B2, Google Drive, Oracle Always Free, GCP free tier, Kaggle, Colab, Modal, Hugging Face Spaces, Tailscale.

Each launch entry must be verified against the provider's current pricing and limits page the week it ships.
