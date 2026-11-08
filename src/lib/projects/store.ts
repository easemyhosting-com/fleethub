import { createHash, randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import type { z } from "zod";
import type { createProjectInput, NeedInput, updateProjectInput, UsageInput } from "./schemas";
import { recommendFor } from "./recommend";

export class SlugTaken extends Error {}
export class ReportConflict extends Error {}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function createProject(input: z.infer<typeof createProjectInput>, identityId: string | null) {
  const id = `prj-${randomUUID()}`;
  const rows = await queryClient`
    INSERT INTO projects (id, slug, name, repo_url, owner_identity_id, environment, criticality, notes)
    VALUES (${id}, ${input.slug}, ${input.name}, ${input.repoUrl ?? null}, ${identityId}, ${input.environment}, ${input.criticality}, ${input.notes ?? null})
    ON CONFLICT (slug) DO NOTHING RETURNING id`;
  if (!rows.length) throw new SlugTaken();
  return { id, slug: input.slug };
}

export async function listProjects() {
  const rows = await queryClient`
    SELECT p.id, p.slug, p.name, p.repo_url, p.environment, p.criticality, p.created_at, p.archived_at,
      (SELECT COUNT(*)::int FROM project_resource_links l WHERE l.project_id = p.id) AS links,
      (SELECT COUNT(*)::int FROM project_needs n WHERE n.project_id = p.id) AS needs,
      (SELECT MAX(received_at) FROM project_usage_reports u WHERE u.project_id = p.id) AS last_usage_at,
      (SELECT COUNT(*)::int FROM project_keys k WHERE k.project_id = p.id AND k.revoked_at IS NULL AND k.expires_at > NOW()) AS active_keys
    FROM projects p ORDER BY p.created_at DESC LIMIT 200`;
  return rows.map(row => ({
    id: String(row.id), slug: String(row.slug), name: String(row.name), repoUrl: row.repo_url as string | null, environment: String(row.environment), criticality: String(row.criticality),
    createdAt: new Date(row.created_at).toISOString(), archived: row.archived_at !== null, links: Number(row.links), needs: Number(row.needs), activeKeys: Number(row.active_keys),
    lastUsageAt: row.last_usage_at ? new Date(row.last_usage_at).toISOString() : null,
  }));
}

/** Records a need and answers with a recommendation. A retry with the same key returns the original answer; the same key with a different body conflicts. */
export async function recordNeed(projectId: string, key: string, input: NeedInput) {
  const payloadHash = hash(input);
  const [existing] = await queryClient`SELECT id, payload_hash, recommendation FROM project_needs WHERE project_id = ${projectId} AND idempotency_key = ${key}`;
  if (existing) {
    if (existing.payload_hash !== payloadHash) throw new ReportConflict();
    return { id: String(existing.id), duplicate: true, recommendation: existing.recommendation };
  }
  const recommendation = await recommendFor(input, projectId);
  const id = `need-${randomUUID()}`;
  const inserted = await queryClient`
    INSERT INTO project_needs (id, project_id, idempotency_key, payload_hash, kind, purpose, spec, status, recommendation)
    VALUES (${id}, ${projectId}, ${key}, ${payloadHash}, ${input.kind}, ${input.purpose}, ${JSON.stringify(input.spec)}, ${recommendation.decision === "candidates" ? "recommended" : "unmet"}, ${JSON.stringify(recommendation)})
    ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING id`;
  if (!inserted.length) return recordNeed(projectId, key, input);
  return { id, duplicate: false, recommendation };
}

/**
 * Records usage independently of any need. If the reference names a registered resource, a `declared` link is kept fresh;
 * otherwise the report is kept with resource_id null so undeclared or unknown usage is still visible.
 */
export async function recordUsage(projectId: string, key: string, input: UsageInput) {
  const payloadHash = hash(input);
  const [existing] = await queryClient`SELECT id, payload_hash, resource_id FROM project_usage_reports WHERE project_id = ${projectId} AND idempotency_key = ${key}`;
  if (existing) {
    if (existing.payload_hash !== payloadHash) throw new ReportConflict();
    return { id: String(existing.id), duplicate: true, matched: existing.resource_id !== null };
  }
  const [resource] = await queryClient`SELECT id FROM resources WHERE id = ${input.resource} OR native_id = ${input.resource} LIMIT 2`;
  const id = `use-${randomUUID()}`;
  const inserted = await queryClient`
    INSERT INTO project_usage_reports (id, project_id, idempotency_key, payload_hash, resource_id, resource_ref, amount, unit, period_start, period_end, metrics)
    VALUES (${id}, ${projectId}, ${key}, ${payloadHash}, ${resource?.id ?? null}, ${input.resource}, ${input.amount ?? null}, ${input.unit ?? null}, ${input.periodStart}, ${input.periodEnd}, ${JSON.stringify(input.metrics)})
    ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING id`;
  if (!inserted.length) return recordUsage(projectId, key, input);
  if (resource) {
    await queryClient`
      INSERT INTO project_resource_links (id, project_id, resource_id, source, status, evidence)
      VALUES (${`plink-${randomUUID()}`}, ${projectId}, ${resource.id}, 'declared', 'in_use', 'usage report')
      ON CONFLICT (project_id, resource_id, source) DO UPDATE SET last_seen = NOW(), status = 'in_use'`;
  }
  return { id, duplicate: false, matched: Boolean(resource) };
}

/** A manual kind sticks: later discovery runs keep it. `auto` clears the lock and restores what discovery last decided. */
export async function updateProject(input: z.infer<typeof updateProjectInput>): Promise<boolean> {
  const manual = input.kind === undefined ? null : input.kind !== "auto";
  const rows = await queryClient`
    UPDATE projects SET
      kind = CASE WHEN ${input.kind ?? null}::text IS NULL THEN kind WHEN ${input.kind ?? null}::text = 'auto' THEN COALESCE(kind_auto, kind) ELSE ${input.kind ?? null}::text END,
      kind_manual = CASE WHEN ${manual}::boolean IS NULL THEN kind_manual ELSE ${manual}::boolean END,
      name = COALESCE(${input.name ?? null}::text, name)
    WHERE id = ${input.projectId} AND archived_at IS NULL RETURNING id`;
  return rows.length > 0;
}
