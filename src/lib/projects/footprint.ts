import { readProjectMeasurements, type ProjectMeasurement } from "./measurements";
import { queryClient } from "@/lib/db/client";

const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
const staleAfterMs = 7 * 86_400_000;

export interface ProjectFootprint {
  id: string; slug: string; name: string; kind: string; kindManual: boolean; placements: Array<{ host: string; runtime: string; hostResourceId: string | null; evidence: string; status: string; declared: Record<string, number | null> }>; environment: string; criticality: string; repoUrl: string | null;
  links: Array<{ resourceId: string; name: string; provider: string; category: string; billing: string; source: string; confidence: number | null; status: string; purpose: string | null; evidence: string | null; lastSeen: string }>;
  needs: Array<{ id: string; kind: string; purpose: string; status: string; topCandidate: string | null; createdAt: string }>;
  usage: Array<{ resourceRef: string; resourceId: string | null; matched: boolean; amount: number | null; unit: string | null; periodEnd: string; receivedAt: string }>;
  keys: Array<{ id: string; hint: string; expiresAt: string; status: "active" | "expired" | "revoked" }>;
  measuredUsage: ProjectMeasurement[];
  usageState: "reporting" | "stale" | "never";
  lastUsageAt: string | null;
  unallocatedUsage: number;
  billableLinks: number;
}

/** Everything the dashboard and agents need about each project. A project that stops reporting is `stale`, never zero. */
export async function readFootprints(projectSlug?: string): Promise<ProjectFootprint[]> {
  const projects = await queryClient`SELECT * FROM projects WHERE archived_at IS NULL AND (${projectSlug ?? null}::text IS NULL OR slug = ${projectSlug ?? null}) ORDER BY name LIMIT 200`;
  if (!projects.length) return [];
  const ids = projects.map(row => String(row.id));
  const [links, needs, usage, keys, placements, measured] = await Promise.all([
    queryClient`SELECT l.project_id, l.resource_id, l.source, l.confidence, l.status, l.purpose, l.evidence, l.last_seen, r.name, r.provider, r.category, COALESCE(r.attributes->>'billing', 'unknown') AS billing
      FROM project_resource_links l JOIN resources r ON r.id = l.resource_id WHERE l.project_id = ANY(${ids}) ORDER BY l.last_seen DESC`,
    queryClient`SELECT id, project_id, kind, purpose, status, recommendation, created_at FROM project_needs WHERE project_id = ANY(${ids}) ORDER BY created_at DESC`,
    queryClient`SELECT project_id, resource_id, resource_ref, amount, unit, period_end, received_at FROM project_usage_reports WHERE project_id = ANY(${ids}) ORDER BY received_at DESC`,
    queryClient`SELECT id, project_id, key_hint, expires_at, revoked_at FROM project_keys WHERE project_id = ANY(${ids}) ORDER BY created_at DESC`,
    queryClient`SELECT project_id, host_name, host_resource_id, runtime, evidence, status, declared FROM project_placements WHERE project_id = ANY(${ids}) ORDER BY host_name`,
    readProjectMeasurements(ids),
  ]);
  return projects.map(project => {
    const own = (rows: ReadonlyArray<Record<string, any>>) => rows.filter(row => row.project_id === project.id);
    const usageRows = own(usage);
    const last = usageRows[0]?.received_at ?? null;
    const projectLinks = own(links).map(row => ({ resourceId: String(row.resource_id), name: String(row.name), provider: String(row.provider), category: String(row.category), billing: String(row.billing), source: String(row.source), confidence: row.confidence as number | null, status: String(row.status), purpose: row.purpose as string | null, evidence: row.evidence as string | null, lastSeen: iso(row.last_seen)! }));
    return {
      id: String(project.id), slug: String(project.slug), name: String(project.name), kind: String(project.kind), kindManual: Boolean(project.kind_manual),
      placements: own(placements).map(row => ({ host: String(row.host_name), runtime: String(row.runtime), hostResourceId: row.host_resource_id as string | null, evidence: String(row.evidence), status: String(row.status), declared: row.declared as Record<string, number | null> })), environment: String(project.environment), criticality: String(project.criticality), repoUrl: project.repo_url as string | null,
      links: projectLinks,
      needs: own(needs).slice(0, 10).map(row => ({ id: String(row.id), kind: String(row.kind), purpose: String(row.purpose), status: String(row.status), topCandidate: (row.recommendation as { candidates?: Array<{ name: string }> })?.candidates?.[0]?.name ?? null, createdAt: iso(row.created_at)! })),
      usage: usageRows.slice(0, 20).map(row => ({ resourceRef: String(row.resource_ref), resourceId: row.resource_id as string | null, matched: row.resource_id !== null, amount: row.amount as number | null, unit: row.unit as string | null, periodEnd: iso(row.period_end)!, receivedAt: iso(row.received_at)! })),
      measuredUsage: measured.filter(row => row.projectId === String(project.id)),
      keys: own(keys).map(row => ({ id: String(row.id), hint: String(row.key_hint), expiresAt: iso(row.expires_at)!, status: row.revoked_at ? "revoked" as const : new Date(row.expires_at).getTime() <= Date.now() ? "expired" as const : "active" as const })),
      usageState: last === null ? "never" as const : Date.now() - new Date(last).getTime() > staleAfterMs ? "stale" as const : "reporting" as const,
      lastUsageAt: iso(last),
      unallocatedUsage: usageRows.filter(row => row.resource_id === null).length,
      billableLinks: projectLinks.filter(link => link.billing === "billable").length,
    };
  });
}

/** Resources that no project links to: the list to reuse from. Missing and archived-account resources are left out. */
export async function readOrphans(limit = 100) {
  const rows = await queryClient`
    SELECT r.id, r.name, r.provider, r.category, r.state, r.is_protected, COALESCE(r.attributes->>'billing', 'unknown') AS billing, COALESCE(p.role, 'general') AS role
    FROM resources r LEFT JOIN resource_profiles p ON p.resource_id = r.id LEFT JOIN provider_accounts a ON a.id = r.account_id
    WHERE r.retired_at IS NULL AND r.state <> 'missing' AND (a.id IS NULL OR a.archived_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM project_resource_links l WHERE l.resource_id = r.id)
    ORDER BY r.provider, r.name LIMIT ${limit}`;
  return rows.map(row => ({ resourceId: String(row.id), name: String(row.name), provider: String(row.provider), category: String(row.category), state: String(row.state), protected: Boolean(row.is_protected), billing: String(row.billing), role: String(row.role) }));
}

/** Resource id to the projects using it, for the "Used by" line in the resource drawer. */
export async function readUsedBy() {
  const rows = await queryClient`SELECT l.resource_id, p.slug, p.name, l.source, l.status FROM project_resource_links l JOIN projects p ON p.id = l.project_id WHERE p.archived_at IS NULL`;
  const out: Record<string, Array<{ slug: string; name: string; source: string; status: string }>> = {};
  for (const row of rows) (out[String(row.resource_id)] ??= []).push({ slug: String(row.slug), name: String(row.name), source: String(row.source), status: String(row.status) });
  return out;
}
