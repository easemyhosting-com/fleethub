import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { catalog, catalogVersion, type Verification } from "./catalog";

export class LimitsError extends Error {
  constructor(readonly code: "not_found" | "invalid") { super(code === "not_found" ? "Limit not found" : "Invalid limit change"); }
}

let seeded = false;

/** Loads the catalog into the database once per process; rows the owner edited are left alone. */
export async function ensureCatalog(): Promise<void> {
  if (seeded) return;
  for (const entry of catalog) {
    await queryClient`
      INSERT INTO entitlements (id, provider, product, metric, label, limit_value, unit, period, resets_rule, verification, verified_at, source_url, note, catalog_version)
      VALUES (${entry.id}, ${entry.provider}, ${entry.product}, ${entry.metric}, ${entry.label}, ${entry.limit}, ${entry.unit}, ${entry.period}, ${entry.resetsRule ?? null},
        ${entry.verification}, ${entry.verifiedAt ?? null}, ${entry.sourceUrl ?? null}, ${entry.note ?? null}, ${catalogVersion})
      ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, product = EXCLUDED.product, metric = EXCLUDED.metric, label = EXCLUDED.label,
        limit_value = EXCLUDED.limit_value, unit = EXCLUDED.unit, period = EXCLUDED.period, resets_rule = EXCLUDED.resets_rule, verification = EXCLUDED.verification,
        verified_at = EXCLUDED.verified_at, source_url = EXCLUDED.source_url, note = EXCLUDED.note, catalog_version = EXCLUDED.catalog_version, updated_at = NOW()
      WHERE entitlements.edited = false AND entitlements.catalog_version < EXCLUDED.catalog_version`;
  }
  seeded = true;
}
export function resetCatalogSeedForTests() { seeded = false; }

async function record(subject: string, action: string, actor: string, detail: Record<string, unknown>) {
  await queryClient`INSERT INTO capacity_events (subject, action, actor, detail) VALUES (${subject}, ${action}, ${actor}, ${JSON.stringify(detail)}::jsonb)`;
}

export type AllowanceScope = { scopeType: "global" | "account"; scopeId: string };

/** What FleetHub may plan with: the smaller of what the plan offers and what the owner allows. Unverified entitlements never count as available. */
export function effectiveLimit(entitlement: { limit: number; verification: Verification }, allowance?: number | null): { limit: number | null; usable: boolean } {
  const base = entitlement.limit;
  const limit = allowance === undefined || allowance === null ? base : Math.min(base, allowance);
  return { limit, usable: entitlement.verification !== "unverified" };
}

export async function listLimits() {
  await ensureCatalog();
  const entitlements = await queryClient`
    SELECT id, provider, product, metric, label, limit_value AS "limit", unit, period, resets_rule AS "resetsRule", verification,
      verified_at::text AS "verifiedAt", source_url AS "sourceUrl", note, edited
    FROM entitlements ORDER BY provider, product, metric`;
  const allowances = await queryClient`
    SELECT id, entitlement_id AS "entitlementId", scope_type AS "scopeType", scope_id AS "scopeId", limit_value AS "limit", reason, updated_by AS "updatedBy", updated_at AS "updatedAt"
    FROM allowances ORDER BY entitlement_id, scope_type, scope_id`;
  const events = await queryClient`SELECT subject, action, actor, detail, created_at AS "at" FROM capacity_events ORDER BY id DESC LIMIT 20`;
  return { entitlements, allowances, events };
}

export async function setEntitlement(id: string, change: { limit?: number; verification?: Verification; note?: string | null; sourceUrl?: string | null; verifiedAt?: string | null }, actor: string) {
  await ensureCatalog();
  const result = await queryClient`
    UPDATE entitlements SET
      limit_value = COALESCE(${change.limit ?? null}, limit_value),
      verification = COALESCE(${change.verification ?? null}, verification),
      note = CASE WHEN ${change.note !== undefined} THEN ${change.note ?? null} ELSE note END,
      source_url = CASE WHEN ${change.sourceUrl !== undefined} THEN ${change.sourceUrl ?? null} ELSE source_url END,
      verified_at = CASE WHEN ${change.verifiedAt !== undefined} THEN ${change.verifiedAt ?? null}::date WHEN ${change.verification === "verified"} THEN CURRENT_DATE ELSE verified_at END,
      edited = true, updated_at = NOW()
    WHERE id = ${id} RETURNING id`;
  if (!result.length) throw new LimitsError("not_found");
  await record(id, "entitlement_edited", actor, { ...change });
}

export async function setAllowance(input: { entitlementId: string; scopeType: "global" | "account"; scopeId?: string; limit: number; reason?: string }, actor: string) {
  await ensureCatalog();
  const scopeId = input.scopeType === "global" ? "" : (input.scopeId ?? "");
  if (input.scopeType === "account" && !scopeId) throw new LimitsError("invalid");
  const exists = await queryClient`SELECT 1 FROM entitlements WHERE id = ${input.entitlementId}`;
  if (!exists.length) throw new LimitsError("not_found");
  await queryClient`
    INSERT INTO allowances (id, entitlement_id, scope_type, scope_id, limit_value, reason, updated_by)
    VALUES (${`alw-${randomUUID()}`}, ${input.entitlementId}, ${input.scopeType}, ${scopeId}, ${input.limit}, ${input.reason ?? null}, ${actor})
    ON CONFLICT (entitlement_id, scope_type, scope_id) DO UPDATE SET limit_value = EXCLUDED.limit_value, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
  await record(input.entitlementId, "allowance_set", actor, { scopeType: input.scopeType, scopeId, limit: input.limit, reason: input.reason ?? null });
}

export async function deleteAllowance(id: string, actor: string) {
  const removed = await queryClient`DELETE FROM allowances WHERE id = ${id} RETURNING entitlement_id`;
  if (!removed.length) throw new LimitsError("not_found");
  await record(removed[0].entitlement_id, "allowance_removed", actor, { id });
}
