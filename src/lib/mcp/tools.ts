import { z } from "zod";
import { hostEnrollmentInput } from "@/lib/enrollment/plan";
import { needInput, projectSlug } from "@/lib/projects/schemas";
import { accountIdSchema, resourceCategorySchema } from "@/lib/inventory/model";

const noArguments = z.strictObject({});
export const resourceFilter = z.strictObject({ accountId: accountIdSchema.optional(), project: projectSlug.optional(), category: resourceCategorySchema.optional(), includeMissing: z.boolean().default(false) });
export const freeCapacityInput = z.strictObject({ kind: needInput.shape.kind, providers: z.array(z.string().trim().min(1).max(40)).max(10).optional() });
export const footprintInput = z.strictObject({ project: projectSlug.optional() });
export const hostCapacityInput = z.strictObject({ cpu: z.string().regex(/^\d+(\.\d+)?m?$/).optional(), memory: z.string().regex(/^\d+(\.\d+)?(Ki|Mi|Gi)?$/).optional() });
export const toolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const tools = [
  { name: "get_fleet_context", description: "Read registered fleet metadata, setup readiness, policies, unknowns and connection guidance. No probes or credential values.", schema: noArguments },
  { name: "plan_host_enrollment", description: "Create a non-executable host enrollment proposal from public information. No SSH, credentials or approval grants.", schema: hostEnrollmentInput },
  { name: "list_resources", description: "Read the same stored resource snapshot with account and project filters as the dashboard. Includes freshness and protection. Missing resources are excluded by default.", schema: resourceFilter },
  { name: "get_fleet_capacity", description: "Count stored inventory by category and freshness. Unmeasured CPU, memory, storage and quota capacity remain unknown.", schema: noArguments },
  { name: "get_quotas", description: "Report whether measured quota observations are available. Registered resources and catalog limits do not establish remaining quota.", schema: noArguments },
  { name: "find_free_capacity", description: "Rank free-tier resources of a kind (compute, storage, database, serverless, llm, network) for new work. Recommendation only: nothing is reserved or changed, and capacity fit is unverified. To declare a need so FleetHub records it, a project posts to /api/hooks/needs.", schema: freeCapacityInput },
  { name: "get_host_capacity", description: "Per compute host: declared CPU and memory requests of the projects placed on it against the host size, after a reserve. Optional cpu (e.g. 500m) and memory (e.g. 256Mi) also report whether a new workload fits on each host. Declared requests only: actual load is not measured.", schema: hostCapacityInput },
  { name: "get_project_footprint", description: "Read what each project has (links with source and evidence), needs, latest usage reports and whether it is reporting or stale, plus resources no project uses. Project-reported usage is unverified.", schema: footprintInput },
  { name: "get_llm_endpoints", description: "Read the configured CLIProxy endpoint and setup verification status. Does not imply upstream availability or measured quota.", schema: noArguments },
] as const;

export const declarations = tools.map(({ schema, ...tool }) => ({ ...tool, inputSchema: z.toJSONSchema(schema, { io: "input" }), annotations: toolAnnotations }));
