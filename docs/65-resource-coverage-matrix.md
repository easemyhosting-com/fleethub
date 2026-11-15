# Resource collection and evidence coverage

This matrix describes implemented source contracts, not the contents of a connected
account or current vendor pricing. A collector exists only where code performs the
read and tests exercise its response mapping. Successful collection still depends on
account permissions, region, pagination and product access. Consult the account's
latest collection coverage and errors before treating a product as fully discovered.

## Classification

- **Live collector**: an implemented direct provider inventory adapter. This does
  not by itself mean that usage, free space or remaining allowance is measured.
- **Manual ledger**: an operator can record the resource or supply a manual snapshot.
  Values and ownership are declarations with their own source and date.
- **Catalog-only**: a plan/allowance reference exists without a matching product
  inventory or usage collector. It is not proof of account entitlement.
- **Unsupported**: no dedicated collection/evidence contract for this capability.
  This describes FleetHub, not whether the provider offers such a service.

## Implemented inventory versus capacity evidence

| Provider / capability | Inventory classification | Measured-use classification | Boundary |
| --- | --- | --- | --- |
| OCI compute instances | Live collector | Unsupported by inventory adapter; separate host metrics connection supported | Instance shape/state/region/specs; declared placements and fresh host metrics support compute advice |
| OCI block volumes | Live collector | Manual ledger | Declared size is collected; filesystem used/free space is not |
| OCI boot volumes | Live collector | Manual ledger | Boot disk capacity is not object-storage capacity |
| OCI object-storage buckets | Live collector | Manual ledger | Bucket names/region; no scoped byte/request/egress usage reader |
| OCI autonomous databases | Live collector | Manual ledger | Database size/CPU metadata is not deployable disk or object-storage space |
| Cloudflare R2 buckets | Live collector | Manual ledger | Bucket discovery does not establish account usage or free allowance |
| Cloudflare KV namespaces | Live collector | Catalog-only limits; no live storage-use reader | Key/value storage is not a generic S3 bucket or attached disk |
| Cloudflare D1 databases | Live collector | Catalog-only limits; no live row/storage-use reader | Database rows and storage cannot be pooled with buckets |
| Cloudflare Workers | Live collector, serverless category | Catalog-only request limits | A deployed Worker is not a general compute host with known CPU/RAM headroom |
| Cloudflare zones / CDN-related inventory | Live collector | Unsupported bandwidth/cache/request usage | Zone state and links do not establish CDN delivery capacity, origin dependencies or free egress |
| Upstash Redis databases | Live collector | Manual ledger | Database discovery/billing evidence only; not a disk or object-storage reader |
| Upstash Box compute | Catalog-only | Catalog-only | Box catalog entries are not an implemented Box collector |
| Supabase projects | Live collector, database category | Manual ledger | Project discovery does not collect Storage buckets, object usage or remaining project allowance |
| Neon projects | Live collector, database category | Manual ledger | Project discovery does not measure disk/free space or compute headroom |
| Other provider compute/disk/object storage/CDN | Manual ledger where an existing inventory category fits | Manual ledger | No additional direct provider adapter is implied by a catalog, account label or registered credential |
| Generic filesystem free space, CDN cache capacity or delivery budget | Unsupported dedicated evidence adapters | Unsupported | Do not infer zero usage or interchangeable capacity |

OCI optional product calls report their individual coverage; access failures are not
empty inventories. Cloudflare product coverage similarly depends on token scopes.
Account ownership remains visible through provider accounts and identities. A family
account is included only when the operator has authorized access. Collector success
and possession of a credential are not permission to share a resource.

## What comparisons can establish

Compute advice uses declared host budgets and independently checks recent whole-host
CPU/RAM observations. Unknown or stale evidence remains unverified. Architecture and
region constraints precede ranking. It neither reserves nor starts a workload.

The manual object-storage form compares two single-bucket account/product pools.
The API accepts all members of shared pools. Both preserve usage and allowance
source timestamps; complete membership is an explicit operator assertion. This
interface is **manual ledger**, not a new live R2 or OCI usage collector.

Disk/file storage and CDN candidates retain unverified fit. The missing contract is
compatible used/free measurements, complete scope membership, timestamped account
entitlement, period/reset boundaries, and workload-specific access/request/egress
requirements. A catalog number cannot fill these gaps. Expose missing evidence
rather than computing a synthetic free balance.

Never sum disk volumes, KV stores, database storage, durable objects and CDN caches
as interchangeable space. Account pools and provider scopes remain separate.

## Source and test evidence

- [Provider collectors](../src/lib/inventory/collectors.ts) and
  [OCI collector](../src/lib/inventory/oci.ts) define actual product discovery.
- [Inventory model](../src/lib/inventory/model.ts) and
  [collection service](../src/lib/inventory/service.ts) preserve per-account facts.
- [Allowance catalog](../src/lib/entitlements/catalog.ts) defines references and
  verification status, independently of collection.
- [Host capacity reads](../src/lib/capacity/read.ts),
  [compute advice](../src/lib/projects/compute-advice.ts), and
  [manual object-storage comparison](../src/lib/capacity/object-storage.ts) define
  the available comparison evidence.
- Collector fixtures and disposable PostgreSQL project tests live in
  [tests](../tests). Passing fixtures prove mappings, not live provider acceptance.

See [resource advisor boundaries](64-resource-advisor-and-integration-boundaries.md)
for the product contract. This document records capability coverage; Linear owns
priorities, implementation work and acceptance status.
