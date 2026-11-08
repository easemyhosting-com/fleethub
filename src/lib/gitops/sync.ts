import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { inferLinks, type KnownResource } from "./infer";
import { parseRepo, type GitopsFile, type ParsedRepo } from "./parse";

export class UnknownProject extends Error {}
export interface SyncSummary { gitops: number; inferred: number; suggested: number; rejectedSkipped: number; markedStale: number; skipped: Array<{ path: string; reason: string }> }

/**
 * Parses manifests for one project and reconciles its `gitops` and `inferred` links. Declared links (source `declared`, from usage reports) are never touched.
 * Owner decisions are remembered: a rejected resource is not suggested again; a confirmed one is kept at full confidence.
 * Links not seen this run are marked `stale`, not deleted, so history and disagreement stay visible.
 */
export async function syncProjectFromFiles(projectId: string, files: GitopsFile[]): Promise<SyncSummary> {
  const [project] = await queryClient`SELECT id, slug FROM projects WHERE id = ${projectId} AND archived_at IS NULL`;
  if (!project) throw new UnknownProject();
  return syncProjectFromParsed(projectId, parseRepo(files, String(project.slug)), parsed => parsed.skipped.slice(0, 50));
}

/** Same reconcile for facts that did not come from files (live connectors): hosts become Ingress-like workloads so zone inference applies. */
export async function syncProjectFromParsed(projectId: string, parsed: ParsedRepo, skippedOf: (parsed: ParsedRepo) => SyncSummary["skipped"] = () => []): Promise<SyncSummary> {
  const [project] = await queryClient`SELECT id, slug FROM projects WHERE id = ${projectId} AND archived_at IS NULL`;
  if (!project) throw new UnknownProject();
  const resources: KnownResource[] = (await queryClient`
    SELECT r.id, r.name, r.native_id, r.provider, r.category FROM resources r LEFT JOIN provider_accounts a ON a.id = r.account_id
    WHERE r.retired_at IS NULL AND r.state <> 'missing' AND (a.id IS NULL OR a.archived_at IS NULL) LIMIT 2000`)
    .map(row => ({ id: String(row.id), name: String(row.name), nativeId: row.native_id as string | null, provider: String(row.provider), category: String(row.category) }));
  const decisions = new Map((await queryClient`SELECT resource_id, decision FROM project_link_decisions WHERE project_id = ${projectId}`).map(row => [String(row.resource_id), String(row.decision)]));
  const summary: SyncSummary = { gitops: 0, inferred: 0, suggested: 0, rejectedSkipped: 0, markedStale: 0, skipped: skippedOf(parsed) };
  const seen: Array<{ resourceId: string; source: string }> = [];
  for (const link of inferLinks(parsed, resources, { slug: String(project.slug) })) {
    const decision = decisions.get(link.resourceId);
    if (decision === "reject" && link.source === "inferred") { summary.rejectedSkipped += 1; continue; }
    const confirmed = decision === "confirm";
    const status = link.source === "gitops" || confirmed ? "in_use" : "suggested";
    await queryClient`
      INSERT INTO project_resource_links (id, project_id, resource_id, purpose, source, confidence, status, evidence)
      VALUES (${`plink-${randomUUID()}`}, ${projectId}, ${link.resourceId}, ${link.purpose}, ${link.source}, ${confirmed ? 1 : link.confidence}, ${status}, ${link.evidence})
      ON CONFLICT (project_id, resource_id, source) DO UPDATE SET purpose = EXCLUDED.purpose, confidence = EXCLUDED.confidence, status = EXCLUDED.status, evidence = EXCLUDED.evidence, last_seen = NOW()`;
    seen.push({ resourceId: link.resourceId, source: link.source });
    if (link.source === "gitops") summary.gitops += 1; else { summary.inferred += 1; if (status === "suggested") summary.suggested += 1; }
  }
  const keep = seen.map(item => `${item.resourceId}|${item.source}`);
  const stale = await queryClient`
    UPDATE project_resource_links SET status = 'stale'
    WHERE project_id = ${projectId} AND source IN ('gitops','inferred') AND status <> 'stale' AND (resource_id || '|' || source) <> ALL(${keep})
    RETURNING id`;
  summary.markedStale = stale.length;
  return summary;
}

/** Owner's call on an inferred link: confirm keeps it at full confidence across syncs; reject removes it and is remembered; clear forgets the decision. */
export async function decideLink(projectId: string, resourceId: string, decision: "confirm" | "reject" | "clear", by: string): Promise<boolean> {
  const [link] = await queryClient`SELECT 1 FROM projects WHERE id = ${projectId}`;
  if (!link) return false;
  if (decision === "clear") { await queryClient`DELETE FROM project_link_decisions WHERE project_id = ${projectId} AND resource_id = ${resourceId}`; return true; }
  await queryClient`
    INSERT INTO project_link_decisions (project_id, resource_id, decision, decided_by) VALUES (${projectId}, ${resourceId}, ${decision}, ${by})
    ON CONFLICT (project_id, resource_id) DO UPDATE SET decision = EXCLUDED.decision, decided_by = EXCLUDED.decided_by, decided_at = NOW()`;
  if (decision === "reject") await queryClient`DELETE FROM project_resource_links WHERE project_id = ${projectId} AND resource_id = ${resourceId} AND source = 'inferred'`;
  else await queryClient`UPDATE project_resource_links SET status = 'in_use', confidence = 1 WHERE project_id = ${projectId} AND resource_id = ${resourceId} AND source = 'inferred'`;
  return true;
}
