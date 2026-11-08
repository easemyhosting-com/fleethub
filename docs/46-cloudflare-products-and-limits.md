# Cloudflare products and the limits store (M1)

Second slice of M1 from [product scope](44-product-scope-and-onboarding-tiers.md).

## Cloudflare listings

A Cloudflare scan now lists, besides zones: **Workers scripts**, **KV namespaces**, **D1 databases** and **R2 buckets**, all with the same account-scoped token and the same read-only calls (`/accounts/{id}/workers/scripts`, `/storage/kv/namespaces`, `/d1/database`, `/r2/buckets`).

- Categories: Workers serverless, KV and R2 storage, D1 database, zones network. Native IDs are prefixed (`worker:`, `kv:`, `d1:`, `r2:`) so names cannot collide; zone IDs are unchanged. Each fact carries a `product` tag stored in the resource's attributes.
- **Serverless state**: these products have no stopped state, so they are shown `online` with provider state `deployed` or `present`. That means "exists", not "healthy"; health comes in M2.
- **Honest coverage**: if the token cannot read a product (HTTP 401/403), that product is **not covered** for the scan; the scan still succeeds. The scan reports `covered` products and retirement only applies to covered products, so a token that loses a permission never makes existing Workers or buckets disappear. Any other error (rate limit, 5xx, malformed response, duplicate IDs, runaway pagination) still fails the whole scan and keeps the previous snapshot. Zones remain mandatory.
- **Token permissions** for full coverage: read access to Zone, Workers Scripts, Workers KV Storage, D1 and R2 for that account. Existing zone-only tokens keep working and simply cover zones.
- Usage (requests, neurons, rows, storage) is **not** collected yet; that is the M2 GraphQL work.

## Limits and allowances

New tables `entitlements` (what a plan offers), `allowances` (what the owner permits FleetHub to use) and `capacity_events` (audit). The catalog lives in `src/lib/entitlements/catalog.ts` and is loaded once per process; rows the owner edited are never overwritten by a newer catalog.

- Each figure has a **verification**: `verified` (read from the provider's page, with a date and source), `reported` (stated by the owner, such as Oracle's reduced A1 allowance of 2 OCPU and 12 GB per tenancy), or `unverified` (third-party summary or memory). Unverified figures are displayed but are never counted as available (`effectiveLimit` returns `usable: false`).
- Seeded: Workers AI 10,000 neurons/day (verified from Cloudflare's pricing page), Upstash Box 5 CPU-hours/month and 10 concurrent boxes (verified from Upstash's pricing page), OCI Ampere A1 (reported), and Workers, KV, R2 and D1 figures (unverified, to be checked).
- Allowances are global or per account; planning uses the smaller of entitlement and allowance.
- UI: **Limits & allowances** in the sidebar shows every figure with its status and source, lets an operator set or clear an allowance, and correct a figure (which marks it `reported`). API: `GET/POST /api/capacity/limits` (operator-only writes, audited, strict validation).
- Not built yet: agent-proposed changes that wait for approval, YAML export/import, and the MCP read tools; they come with the capacity tools in M2.

## Verification

Unit tests for the collectors (all four products, cursor pagination, denied products left uncovered, other errors fail, duplicate IDs), the catalog invariants and effective limits, and the route (authorization, validation, actor, error mapping). PostgreSQL integration tests cover covered-product retirement and the limits store, including that edited rows survive a catalog reload. Not verified against a live Cloudflare account: the response shapes follow Cloudflare's documentation as summarised in research, and the real token's coverage is unknown until the next scan.
