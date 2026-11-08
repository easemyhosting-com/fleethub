import { queryClient } from "@/lib/db/client";
import { resourceBilling } from "@/lib/providers/config-security";
import type { NeedInput } from "./schemas";

export interface Candidate { resourceId: string; name: string; provider: string; category: string; state: string; protected: boolean; usedByProjects: number; reasons: string[] }
export interface Recommendation { decision: "candidates" | "none_free"; candidates: Candidate[]; note: string; allocated: false }

/**
 * Recommend-only: ranks free-tier resources of the requested kind. Capacity (CPU, memory, headroom) is not measured for most providers,
 * so every candidate says "fit unverified" rather than claiming it fits. Nothing is reserved, started or changed.
 */
export async function recommendFor(need: NeedInput, projectId: string): Promise<Recommendation> {
  const rows = await queryClient`
    SELECT r.id, r.name, r.provider, r.category, r.state, r.is_protected, r.attributes, COALESCE(p.role, 'general') AS role,
      (SELECT COUNT(DISTINCT l.project_id)::int FROM project_resource_links l WHERE l.resource_id = r.id AND l.project_id <> ${projectId} AND l.status IN ('allocated','in_use')) AS others
    FROM resources r
    LEFT JOIN resource_profiles p ON p.resource_id = r.id
    LEFT JOIN provider_accounts a ON a.id = r.account_id
    WHERE r.retired_at IS NULL AND r.category = ${need.kind} AND r.state <> 'missing' AND (a.id IS NULL OR a.archived_at IS NULL)
    LIMIT 200`;
  const wanted = need.spec.providers?.map(provider => provider.toLowerCase());
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const billing = resourceBilling(row.attributes);
    if (billing === "billable") continue;
    if (wanted && !wanted.includes(String(row.provider).toLowerCase())) continue;
    const reasons = [billing === "free_tier" ? "free-tier" : "billing unknown: confirm it is free before using", "fit unverified: capacity is not measured for this resource"];
    if (row.state === "online") reasons.push("online");
    if (row.role === "unused") reasons.push("role: unused");
    if (Number(row.others) > 0) reasons.push(`shared with ${row.others} other project${row.others === 1 ? "" : "s"}`);
    if (row.is_protected) reasons.push("protected: FleetHub will never stop it");
    candidates.push({ resourceId: String(row.id), name: String(row.name), provider: String(row.provider), category: String(row.category), state: String(row.state), protected: Boolean(row.is_protected), usedByProjects: Number(row.others), reasons });
  }
  const score = (item: Candidate) => (item.reasons[0] === "free-tier" ? 4 : 0) + (item.state === "online" ? 2 : 0) + (item.reasons.includes("role: unused") ? 3 : 0) - item.usedByProjects;
  candidates.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const top = candidates.slice(0, 3);
  return top.length
    ? { decision: "candidates", candidates: top, note: "Recommendation only. Nothing is reserved or changed; confirm in FleetHub.", allocated: false }
    : { decision: "none_free", candidates: [], note: "No free-tier resource of this kind is registered. Connect an account for it or relax the provider filter.", allocated: false };
}
