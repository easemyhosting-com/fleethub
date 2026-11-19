# Cloud freebies catalog

FleetHub lists provider free-tier offerings at `/freebies` (linked from **Limits**). You can search them and filter by provider, category, limit type, home-region rule, verification status and "fits my fleet" tags. Filters are kept in the URL, so a filtered view can be shared.

This catalog is separate from the quota catalog in [17-free-tier-catalog-schema.md](../17-free-tier-catalog-schema.md). That one defines meters the quota engine tracks. This one is a browsable reference to what each provider gives away and what to watch out for. Neither one is measured usage or proof of what your account is entitled to.

## Providers

- [Oracle Cloud (OCI)](oci.md)

Planned, not yet verified: Cloudflare, GitHub, Grafana Cloud, Neon, Upstash, Supabase. Nothing is listed for a provider until its numbers have been checked against a primary source.

## Entry fields

Source of truth: `src/lib/catalog/freebies/schema.ts` (Zod, strict).

| Field | Meaning |
|---|---|
| `id` | `<provider>.<service-slug>`, unique |
| `provider`, `providerName` | Slug and display name |
| `service` | Provider's service name |
| `category` | compute, storage, database, networking, email, observability, security, messaging, serverless, devtools |
| `limit.type` | `capacity` (standing ceiling), `monthly`, `rate`, `count`, `unlimited` (no stated cap), `none` (no free allowance) |
| `limit.value`, `limit.unit` | Primary number and its unit, or null when none is stated |
| `limit.note` | The full allowance in words |
| `scope` | per tenancy, per account, per region, per resource |
| `homeRegionOnly` | true, false, or null when the provider doesn't say |
| `caveats[]` | `kind` (reclamation, egress, shared_quota, home_region, blocked_port, coupling, other), `text`, and optional `sharesWith` entry ids for shared pools |
| `sourceUrl`, `verifiedAt` | HTTPS primary source and the date (YYYY-MM-DD) it was read |
| `verification` | `verified` (provider docs), `marketing` (provider marketing page only), `unverified` (secondary source or the page couldn't be read) |
| `suggestedUses`, `fitTags` | Generic workload patterns, such as `offsite-backups` or `alert-email` |

## Adding a provider

1. Create `src/lib/catalog/freebies/<provider>.ts` that exports a `FreebieEntry[]`, and append it to `FREEBIES` in `index.ts`.
2. Give every number a primary-source URL and the date you read it. If you can't verify a number, mark the entry `unverified` or leave it out.
3. Keep it generic. Don't add account names, IDs, hostnames, IPs or anything else specific to your own fleet.
4. Run `npm run docs:freebies` to regenerate `docs/freebies/<provider>.md`, then `npm test`. A test fails if the docs drift from the data.
