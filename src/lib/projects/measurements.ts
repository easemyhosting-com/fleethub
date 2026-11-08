import { z } from "zod";
import { queryClient } from "@/lib/db/client";
import { measurementFreshness } from "@/lib/capacity/host";

const metrics = z.object({
  source: z.literal("prometheus"), kind: z.enum(["namespace", "compose", "containers"]),
  cpuCores: z.number().finite().nonnegative().optional(), memMi: z.number().finite().nonnegative().optional(),
  scopes: z.array(z.string()).optional(), containers: z.array(z.string()).optional(),
});
export interface ProjectMeasurement {
  projectId: string; resourceId: string | null; hostRef: string; kind: "namespace" | "compose" | "containers";
  cpuCores: number | null; memMi: number | null; measuredAt: string; stale: boolean; scopes: string[]; containers: string[];
}

/** Read only source-marked, host-attributed reports. Legacy namespace totals mixed clusters and must not appear as current measurements. */
export async function readProjectMeasurements(projectIds: string[]): Promise<ProjectMeasurement[]> {
  if (!projectIds.length) return [];
  const rows = await queryClient`
    SELECT DISTINCT ON (project_id, resource_ref, metrics->>'kind') project_id, resource_id, resource_ref, metrics, received_at
    FROM project_usage_reports WHERE project_id = ANY(${projectIds}) AND metrics->>'source' = 'prometheus'
      AND received_at >= NOW() - INTERVAL '24 hours'
    ORDER BY project_id, resource_ref, metrics->>'kind', received_at DESC, id DESC`;
  return rows.flatMap(row => {
    const parsed = metrics.safeParse(row.metrics), at = new Date(row.received_at);
    if (!parsed.success || !Number.isFinite(at.getTime()) || measurementFreshness(at) === "expired") return [];
    return [{ projectId: String(row.project_id), resourceId: row.resource_id == null ? null : String(row.resource_id), hostRef: String(row.resource_ref), kind: parsed.data.kind,
      cpuCores: parsed.data.cpuCores ?? null, memMi: parsed.data.memMi ?? null, measuredAt: at.toISOString(),
      stale: measurementFreshness(at) === "stale", scopes: parsed.data.scopes ?? [], containers: parsed.data.containers ?? [] }];
  });
}
