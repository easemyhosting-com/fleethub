import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { discover, filesForProject, type Discovery } from "./discover";
import type { ParsedRepo } from "./parse";
import type { GitopsFile } from "./parse";
import { syncProjectFromFiles, syncProjectFromParsed } from "./sync";

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export interface ApplySummary { created: number; updated: number; placements: number; unresolvedHosts: string[]; links: { gitops: number; inferred: number; suggested: number }; projects: string[] }

/** Dry run: what would be registered. Writes nothing. */
export const propose = (files: GitopsFile[]): Discovery => discover(files);

/**
 * Registers the selected proposed projects idempotently (by slug) with their placements and evidence-based links.
 * Existing project names are never overwritten; placements no longer seen become stale; nothing is deleted.
 */
export async function applyDiscovery(files: GitopsFile[], select: string[], sourceRef: string): Promise<ApplySummary> {
  return applyProposal(discover(files), select, sourceRef, files);
}

/** Registers any proposal, from files or from a live connector. With files, link inference reads each project's manifests; without, it uses the proposal's own hostnames and images. */
export async function applyProposal(proposal: Discovery, select: string[], sourceRef: string, files?: GitopsFile[], options: { refreshOnly?: boolean } = {}): Promise<ApplySummary> {
  const chosen = proposal.projects.filter(project => select.includes("*") || select.includes(project.slug));
  const hosts = await queryClient`SELECT id, name FROM resources WHERE category = 'compute' AND retired_at IS NULL`;
  const hostByName = new Map(hosts.map(row => [norm(String(row.name)), String(row.id)]));
  const summary: ApplySummary = { created: 0, updated: 0, placements: 0, unresolvedHosts: [], links: { gitops: 0, inferred: 0, suggested: 0 }, projects: [] };
  for (const project of chosen) {
    const id = `prj-${randomUUID()}`;
    const [row] = options.refreshOnly ? await queryClient`
      UPDATE projects SET kind = CASE WHEN kind_manual THEN kind ELSE ${project.kind} END,
        kind_auto = ${project.kind}, source = ${project.source}, source_ref = ${sourceRef}
      WHERE slug = ${project.slug} AND archived_at IS NULL RETURNING id, false AS inserted`
      : await queryClient`
      INSERT INTO projects (id, slug, name, environment, kind, kind_auto, source, source_ref)
      VALUES (${id}, ${project.slug}, ${project.name}, 'prod', ${project.kind}, ${project.kind}, ${project.source}, ${sourceRef})
      ON CONFLICT (slug) DO UPDATE SET kind = CASE WHEN projects.kind_manual THEN projects.kind ELSE EXCLUDED.kind END, kind_auto = EXCLUDED.kind_auto, source = EXCLUDED.source, source_ref = EXCLUDED.source_ref, archived_at = NULL
      RETURNING id, (xmax = 0) AS inserted`;
    if (!row) continue;
    if (row.inserted) summary.created += 1; else summary.updated += 1;
    const projectId = String(row.id);
    summary.projects.push(project.slug);
    const seenHosts: string[] = [];
    for (const placement of project.placements) {
      const hostResource = hostByName.get(norm(placement.host)) ?? null;
      if (!hostResource && !summary.unresolvedHosts.includes(placement.host)) summary.unresolvedHosts.push(placement.host);
      seenHosts.push(placement.host);
      await queryClient`
        INSERT INTO project_placements (id, project_id, host_name, host_resource_id, runtime, source, evidence, declared, scope)
        VALUES (${`plc-${randomUUID()}`}, ${projectId}, ${placement.host}, ${hostResource}, ${placement.runtime}, ${project.source}, ${placement.evidence}, ${JSON.stringify(placement.declared)}, ${placement.scope ?? null})
        ON CONFLICT (project_id, host_name) DO UPDATE SET host_resource_id = EXCLUDED.host_resource_id, runtime = EXCLUDED.runtime, evidence = EXCLUDED.evidence, declared = EXCLUDED.declared, scope = EXCLUDED.scope, status = 'placed', last_seen = NOW()`;
      summary.placements += 1;
    }
    // A connector sees only one host or cluster; it cannot retire placements elsewhere.
    if (!options.refreshOnly) await queryClient`UPDATE project_placements SET status = 'stale' WHERE project_id = ${projectId} AND status <> 'stale' AND host_name <> ALL(${seenHosts})`;
    const projectFiles = files ? filesForProject(files, project) : [];
    const parsed: ParsedRepo = { workloads: project.domains.length ? [{ kind: "Ingress", name: project.slug, namespace: null, hosts: project.domains, images: project.images, uses: [], file: sourceRef }] : [], declarations: [], skipped: [] };
    const synced = options.refreshOnly ? null : projectFiles.length ? await syncProjectFromFiles(projectId, projectFiles) : parsed.workloads.length ? await syncProjectFromParsed(projectId, parsed) : null;
    if (synced) { summary.links.gitops += synced.gitops; summary.links.inferred += synced.inferred; summary.links.suggested += synced.suggested; }
  }
  return summary;
}
