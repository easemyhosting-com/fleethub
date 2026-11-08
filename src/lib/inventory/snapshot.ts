import { queryClient } from "@/lib/db/client";
import { resourceBilling, publicResourceAttributes, publicResourceSpecs, publicResourceTags } from "@/lib/providers/config-security";
import type { FleetFilter } from "@/lib/fleet/filters";
import { defaultProfile } from "@/lib/fleet/vocabulary";
import { fleetSnapshotSchema, supportedInventoryProviders, CollectionError, type FleetSnapshot } from "./model";

export async function readSnapshot(filters: { accountId?: string; ownerEmail?: string } & FleetFilter = {}): Promise<FleetSnapshot> {
  const now = new Date();
  const accounts = await queryClient`
    SELECT a.id, a.kind, a.label, a.identity_id, a.owner_email, a.login_email, a.health, a.enabled, a.archived_at, a.plan,
      a.is_protected, a.secret_ref_id, a.credential_expires_at, c.state AS collection_state, c.last_attempt_at,
      c.last_success_at, c.next_attempt_at, c.error_code,
      (SELECT COUNT(*)::int FROM resources r WHERE r.account_id = a.id AND r.inventory_source = 'provider' AND r.retired_at IS NULL) AS resource_count
    FROM provider_accounts a LEFT JOIN account_collections c ON c.account_id = a.id
    WHERE (${filters.accountId ?? null}::text IS NULL OR a.id = ${filters.accountId ?? null})
      AND (${filters.ownerEmail ?? null}::text IS NULL OR a.owner_email = ${filters.ownerEmail ?? null})
      AND (${filters.person ?? null}::text IS NULL OR a.identity_id = ${filters.person ?? null})
      AND (${filters.email ?? null}::text IS NULL OR LOWER(TRIM(a.owner_email)) = LOWER(TRIM(${filters.email ?? null})))
      AND (${filters.provider ?? null}::text IS NULL OR a.kind = ${filters.provider ?? null})
      AND (${filters.plan ?? null}::text IS NULL OR COALESCE(a.plan, 'unknown') = ${filters.plan ?? null})
    ORDER BY a.label, a.id
  `;
  const resources = await queryClient`
    SELECT r.id, r.account_id, r.account_email, r.provider, r.name, r.category, r.state,
      r.is_protected, a.is_protected AS account_protected, a.kind AS account_kind,
      r.tags, r.attributes, r.last_seen_at, r.native_id, r.region, r.source_url,
      r.inventory_source, r.retired_at, c.last_success_at, c.state AS collection_state,
      p.role AS profile_role, p.lifecycle AS profile_lifecycle, p.backup_class AS profile_backup, p.criticality AS profile_criticality,
      p.auto_stop AS profile_auto_stop, p.labels AS profile_labels, p.notes AS profile_notes, (p.resource_id IS NOT NULL) AS profile_set
    FROM resources r LEFT JOIN provider_accounts a ON a.id = r.account_id
      LEFT JOIN resource_profiles p ON p.resource_id = r.id
      LEFT JOIN account_collections c ON c.account_id = r.account_id
    WHERE (${filters.accountId ?? null}::text IS NULL OR r.account_id = ${filters.accountId ?? null})
      AND (${filters.ownerEmail ?? null}::text IS NULL OR a.owner_email = ${filters.ownerEmail ?? null})
      AND (${filters.person ?? null}::text IS NULL OR a.identity_id = ${filters.person ?? null})
      AND (${filters.email ?? null}::text IS NULL OR LOWER(TRIM(a.owner_email)) = LOWER(TRIM(${filters.email ?? null})))
      AND (${filters.provider ?? null}::text IS NULL OR a.kind = ${filters.provider ?? null})
      AND (${filters.plan ?? null}::text IS NULL OR COALESCE(a.plan, 'unknown') = ${filters.plan ?? null})
    ORDER BY r.is_protected DESC, r.name, r.id
  `;
  const gateways = await queryClient`
    SELECT id, name, kind, tailscale_ip AS "tailscaleIp", port, state, latency_ms AS "latencyMs"
    FROM network_gateways ORDER BY name
  `;
  const worker = await queryClient`SELECT last_seen_at FROM inventory_worker WHERE id = 1`;
  const mappedAccounts = accounts.map(a => {
    const success = a.last_success_at ? new Date(a.last_success_at) : null;
    const freshUntil = success ? new Date(success.getTime() + 15 * 60_000) : null;
    let state = a.collection_state ?? (!supportedInventoryProviders.includes(a.kind) ? "unsupported" : a.secret_ref_id ? "stale" : "needs_credentials");
    if (state === "ready" && (!freshUntil || freshUntil <= now)) state = "stale";
    if (state === "error" && success) state = "stale";
    return {
      id: a.id, kind: a.kind, label: a.label, identityId: a.identity_id ?? null, ownerEmail: a.owner_email, loginEmail: a.login_email, credentialExpiresAt: a.credential_expires_at ? new Date(a.credential_expires_at).toISOString() : null,
      health: a.health, enabled: a.enabled, archived: a.archived_at !== null, plan: a.plan ?? "unknown", isProtected: a.is_protected || a.kind === "oracle",
      collection: {
        state,
        lastAttemptAt: a.last_attempt_at ? new Date(a.last_attempt_at).toISOString() : null,
        lastSuccessAt: success?.toISOString() ?? null,
        freshUntil: freshUntil?.toISOString() ?? null,
        nextAttemptAt: a.next_attempt_at ? new Date(a.next_attempt_at).toISOString() : null,
        errorCode: a.error_code ?? null,
        message: a.error_code ? new CollectionError(a.error_code).message :
          state === "ready" ? "Inventory is current" :
          state === "queued" ? "Inventory is queued" :
          state === "running" ? "Inventory is running" :
          state === "needs_credentials" ? "Add management API credentials to collect inventory" :
          state === "stale" ? "Inventory needs refresh" :
          state === "error" ? "Collection failed; previous snapshot retained" : "Automatic collection unavailable",
        resourceCount: a.resource_count,
      },
    };
  });
  const mappedResources = resources.map(r => {
    const lastSuccess = r.last_success_at ? new Date(r.last_success_at) : null;
    const freshness = r.inventory_source === "manual" ? "unverified" :
      lastSuccess && lastSuccess.getTime() + 15 * 60_000 > now.getTime() && !r.retired_at &&
      r.collection_state !== "error" ? "current" : "stale";
    return {
      id: r.id, accountId: r.account_id, accountEmail: r.account_email, provider: r.provider,
      name: r.name, category: r.category, state: r.state,
      isProtected: r.is_protected || r.account_protected || r.account_kind === "oracle" || r.provider === "oracle",
      tags: publicResourceTags(r.tags), attributes: publicResourceAttributes(r.attributes), specs: publicResourceSpecs(r.attributes), billing: resourceBilling(r.attributes),
      profile: { set: Boolean(r.profile_set), role: r.profile_role ?? defaultProfile.role, lifecycle: r.profile_lifecycle ?? defaultProfile.lifecycle, backupClass: r.profile_backup ?? defaultProfile.backupClass, criticality: r.profile_criticality ?? defaultProfile.criticality, autoStop: r.profile_auto_stop ?? defaultProfile.autoStop, labels: r.profile_labels ?? {}, notes: r.profile_notes ?? null },
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      nativeId: r.native_id, region: r.region, sourceUrl: r.source_url,
      inventorySource: r.inventory_source, presence: r.retired_at ? "missing" : "present", freshness,
    };
  });
  const seen = worker[0]?.last_seen_at ? new Date(worker[0].last_seen_at) : null;
  return fleetSnapshotSchema.parse({
    status: "online", timestamp: now.toISOString(), accounts: mappedAccounts, resources: mappedResources,
    gateways, worker: { status: seen && now.getTime() - seen.getTime() < 60_000 ? "online" : "offline", lastSeenAt: seen?.toISOString() ?? null },
  });
}
