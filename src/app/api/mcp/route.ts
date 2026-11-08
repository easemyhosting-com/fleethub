import { NextResponse } from "next/server";
import { z } from "zod";
import { hostEnrollmentInput, planHostEnrollment } from "@/lib/enrollment/plan";
import { declarations, footprintInput, freeCapacityInput, hostCapacityInput, resourceFilter, tools } from "@/lib/mcp/tools";
import { readFootprints, readOrphans } from "@/lib/projects/footprint";
import { recommendFor } from "@/lib/projects/recommend";
import { fit, parseAsk, reserve } from "@/lib/capacity/host";
import { readHostCapacities } from "@/lib/capacity/read";
import { getAgentContext } from "@/lib/agent-context/context";
import { readSnapshot } from "@/lib/inventory/snapshot";
import { resourceCategorySchema } from "@/lib/inventory/model";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { getSetupState } from "@/lib/onboarding/service";
import { configSchemas } from "@/lib/onboarding/model";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
const envelopeSchema = z.object({ jsonrpc: z.literal("2.0").optional(), id: z.union([z.string().max(128), z.number().finite(), z.null()]).optional(), method: z.string().max(128), params: z.unknown().optional() });
const callSchema = z.strictObject({ name: z.string().max(128), arguments: z.unknown().optional() });
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function failure(id: string | number | null, code: number, message: string, status: number) { return json({ jsonrpc: "2.0", id, error: { code, message } }, status); }
function result(id: string | number | null, value: unknown, isError = false) { return json({ jsonrpc: "2.0", id, result: { isError, content: [{ type: "text", text: JSON.stringify(value) }] } }); }

export async function GET(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: false });
  if (!access.authorized) return createUnauthorizedResponse(access);
  return json({ name: "fleethub-mcp", version: "1.0.0", transport: "legacy-jsonrpc", standardMcpTransport: false, executionEnabled: false, capabilities: { tools: declarations } });
}

export async function POST(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: false });
  if (!access.authorized) return createUnauthorizedResponse(access);
  const body = await readJsonWithLimit<unknown>(req);
  if (!body.ok) return failure(null, -32700, "Invalid or oversized JSON request", body.status);
  const envelope = envelopeSchema.safeParse(body.data);
  if (!envelope.success) return failure(null, -32600, "Invalid request envelope", 400);
  const { method, params } = envelope.data;
  const id = envelope.data.id ?? null;
  if (method === "server/discover") return json({ jsonrpc: "2.0", id, result: { serverInfo: { name: "fleethub-mcp", version: "1.0.0" }, transport: "legacy-jsonrpc", standardMcpTransport: false, capabilities: { tools: { listChanged: false } }, executionEnabled: false } });
  if (method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: declarations } });
  if (method !== "tools/call") return failure(id, -32601, "Unsupported method", 400);
  const call = callSchema.safeParse(params);
  if (!call.success) return failure(id, -32602, "Invalid tool request", 400);
  const { name, arguments: args = {} } = call.data;
  if (["dispatch_workload", "get_dispatch_targets"].includes(name)) return failure(id, -32601, "Execution is disabled. No approved execution workers are registered.", 403);
  const tool = tools.find(item => item.name === name);
  if (!tool) return failure(id, -32601, "Unknown tool", 404);
  if (!tool.schema.safeParse(args).success) return failure(id, -32602, "Invalid tool arguments", 400);
  try {
    if (name === "get_fleet_context") {
      const context = await getAgentContext();
      return result(id, context, context.inventory.status === "unavailable");
    }
    if (name === "plan_host_enrollment") return result(id, planHostEnrollment(hostEnrollmentInput.parse(args)));
    if (name === "get_quotas") return result(id, { status: "unavailable", observations: [], message: "Quota usage and account entitlements have not been collected. Inventory counts and catalog limits are not remaining capacity." });
    if (name === "get_llm_endpoints") {
      const setup = await getSetupState();
      const step = setup.steps.find(item => item.id === "cliproxy");
      const config = configSchemas.cliproxy.safeParse(step?.config);
      return result(id, { setupStatus: step?.status ?? "unconfigured", apiUrl: config.success ? config.data.apiUrl : null, consoleUrl: config.success ? config.data.consoleUrl : null, verifiedAt: step?.verifiedAt ?? null, upstreamAvailability: "unknown", quota: "unknown" });
    }
    if (!(await bootstrapDatabase()).success) throw new Error("storage unavailable");
    if (name === "find_free_capacity") {
      const input = freeCapacityInput.parse(args);
      return result(id, await recommendFor({ kind: input.kind, purpose: "agent query", spec: { providers: input.providers } }, ""));
    }
    if (name === "get_host_capacity") {
      const input = hostCapacityInput.parse(args);
      const ask = input.cpu || input.memory ? parseAsk(input.cpu ?? null, input.memory ?? null) : null;
      const hosts = await readHostCapacities();
      return result(id, { hosts, fits: ask ? hosts.map(host => fit(host, ask)) : undefined, reserve, basis: "declared_requests", measured: false });
    }
    if (name === "get_project_footprint") {
      const input = footprintInput.parse(args);
      const [projects, orphans] = await Promise.all([readFootprints(input.project), input.project ? Promise.resolve([]) : readOrphans()]);
      return result(id, { projects, orphans, authoritative: false });
    }
    if (name === "list_resources") {
      const filter = resourceFilter.parse(args);
      const snapshot = await readSnapshot({ accountId: filter.accountId });
      return result(id, snapshot.resources.filter(resource => (filter.includeMissing || resource.presence === "present") && (!filter.category || resource.category === filter.category)));
    }
    const snapshot = await readSnapshot();
    const present = snapshot.resources.filter(resource => resource.presence === "present");
    return result(id, {
      timestamp: snapshot.timestamp, provenance: "stored_provider_and_manual_inventory",
      registeredResources: present.length,
      currentProviderResources: present.filter(resource => resource.freshness === "current").length,
      protectedResources: present.filter(resource => resource.isProtected).length,
      byCategory: Object.fromEntries(resourceCategorySchema.options.map(category => [category, present.filter(resource => resource.category === category).length])),
      availableCpu: null, availableMemoryBytes: null, availableStorageBytes: null,
      executionEnabled: false, message: "Counts describe inventory. Available capacity has not been measured.",
    });
  } catch {
    return result(id, { status: "unavailable", message: "Fleet data is unavailable. Retry after checking storage and setup." }, true);
  }
}
