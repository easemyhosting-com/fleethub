import { readProjectMeasurements } from "@/lib/projects/measurements";
import { queryClient } from "@/lib/db/client";
import { hostCapacity, measurementFreshness, type HostAddress, type HostCapacity, type MeasuredUsage, type PlacementInput } from "./host";
import { addressKind, ambiguousHostKeys, hostKey } from "./addresses";

/** Every compute resource with what its placed projects declare. Archived projects and stale placements are excluded. */
export async function readHostCapacities(): Promise<HostCapacity[]> {
  const hosts = await queryClient`
    SELECT r.id, r.name, r.state, r.region, r.attributes FROM resources r LEFT JOIN provider_accounts a ON a.id = r.account_id
    WHERE r.category = 'compute' AND r.retired_at IS NULL AND r.state <> 'missing' AND (a.id IS NULL OR a.archived_at IS NULL) ORDER BY r.name`;
  const placements = await queryClient`
    SELECT pl.host_resource_id, pl.runtime, pl.declared, p.id AS project_id, p.slug, p.name, p.kind
    FROM project_placements pl JOIN projects p ON p.id = pl.project_id
    WHERE pl.status = 'placed' AND p.archived_at IS NULL AND pl.host_resource_id IS NOT NULL`;
  const byHost = new Map<string, PlacementInput[]>();
  for (const row of placements) {
    const list = byHost.get(String(row.host_resource_id)) ?? [];
    list.push({ projectId: String(row.project_id), slug: String(row.slug), name: String(row.name), kind: String(row.kind), runtime: String(row.runtime), declared: row.declared as PlacementInput["declared"] });
    byHost.set(String(row.host_resource_id), list);
  }
  const projectMeasurements = await readProjectMeasurements([...new Set(placements.map(row => String(row.project_id)))]);
  const measurements = await queryClient`SELECT instance, host_key, node_name, cpu_cores, cpu_busy_cores, mem_total_mi, mem_used_mi, measured_at FROM host_measurements ORDER BY measured_at DESC`;
  const addressRows = await queryClient`SELECT host_key, address, kind, source FROM host_addresses`;
  const connectors = await queryClient`SELECT host_name, config FROM connectors`;
  const measuredByHost = new Map<string, MeasuredUsage>(), addressesByHost = new Map<string, Map<string, HostAddress>>();
  const addAddress = (key: string, entry: HostAddress) => { const map = addressesByHost.get(key) ?? new Map<string, HostAddress>(); if (!map.has(entry.address)) map.set(entry.address, entry); addressesByHost.set(key, map); };
  const now = new Date();
  for (const row of measurements) { const key = String(row.host_key), at = new Date(row.measured_at as string), freshness = measurementFreshness(at, now); if (freshness !== "expired" && !measuredByHost.has(key)) measuredByHost.set(key, { instance: String(row.instance), cpuCores: row.cpu_cores as number | null, cpuBusyCores: row.cpu_busy_cores as number | null, memTotalMi: row.mem_total_mi as number | null, memUsedMi: row.mem_used_mi as number | null, measuredAt: at.toISOString(), stale: freshness === "stale" }); }
  for (const row of addressRows) addAddress(String(row.host_key), { address: String(row.address), kind: row.kind as HostAddress["kind"], source: String(row.source) });
  for (const row of connectors) { try { const host = new URL(String((row.config as { url?: string }).url)).hostname, kind = addressKind(host); if (kind) addAddress(hostKey(String(row.host_name)), { address: host, kind, source: "connector" }); } catch { /* a connector without a usable URL has no address to show */ } }
  const ambiguous = ambiguousHostKeys(hosts.map(row => String(row.name)));
  return hosts.map(row => {
    const specs = (row.attributes as { specs?: Record<string, unknown> })?.specs ?? (row.attributes as Record<string, unknown>) ?? {};
    const key = hostKey(String(row.name)), joinable = !ambiguous.has(key);
    const capacity = hostCapacity({
      id: String(row.id), name: String(row.name), state: String(row.state), region: row.region as string | null,
      specs: { ocpus: typeof specs.ocpus === "number" ? specs.ocpus : undefined, memoryGb: typeof specs.memoryGb === "number" ? specs.memoryGb : undefined, shape: typeof specs.shape === "string" ? specs.shape : undefined },
    }, byHost.get(String(row.id)) ?? []);
    return { ...capacity, projects: capacity.projects.map(project => ({ ...project, measuredUsage: projectMeasurements.filter(m => m.projectId === project.projectId && (m.resourceId === String(row.id) || (m.resourceId === null && joinable && hostKey(m.hostRef.replace(/^host:/, "")) === key))) })), measuredUsage: joinable ? measuredByHost.get(key) ?? null : null, addresses: joinable ? [...(addressesByHost.get(key)?.values() ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.address.localeCompare(b.address)) : [] };
  });
}
