import { catalog } from "@/lib/entitlements/catalog";
import { usageBand, type UsageBand } from "@/lib/identity/tiers";

export interface ResourceUsage { key: string; label: string; used: number; limit: number; unit: string; pct: number; band: UsageBand }
interface UsageInput { provider: string; specs?: Record<string, string | number | boolean | null> }

const catalogLimit = (id: string) => {
  const entry = catalog.find(item => item.id === id);
  if (!entry) throw new Error(`Missing catalog entry ${id}`);
  return entry.limit;
};

/** Oracle Always Free pools: A1 compute is shared by every A1 instance in a tenancy, block storage by every volume. A1 limits come from the entitlements catalog. */
export const ociFreePool = { ocpus: catalogLimit("oci.a1.ocpu"), memoryGb: catalogLimit("oci.a1.memory_gb"), storageGb: 200 } as const;

const usage = (key: string, label: string, used: number, limit: number, unit: string): ResourceUsage => ({ key, label, used, limit, unit, pct: Math.min(100, Math.round((used / limit) * 100)), band: usageBand(used, limit) });
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** What one resource takes from its free pool. This is allocation (size configured), not live load: the providers' listing calls do not report consumption. */
export function resourceUsage(resource: UsageInput): ResourceUsage[] {
  const specs = resource.specs ?? {};
  if (resource.provider !== "oracle") return [];
  const out: ResourceUsage[] = [];
  if (specs.capacityKind === "shared_pool") {
    const ocpus = number(specs.ocpus), memory = number(specs.memoryGb);
    if (ocpus !== undefined) out.push(usage("ocpus", "OCPUs of the free pool", ocpus, ociFreePool.ocpus, "OCPU"));
    if (memory !== undefined) out.push(usage("memory", "Memory of the free pool", memory, ociFreePool.memoryGb, "GB"));
  }
  const size = number(specs.sizeGb);
  if (size !== undefined && (specs.product === "volume" || specs.product === "bootvolume")) out.push(usage("storage", "Block storage of the free pool", size, ociFreePool.storageGb, "GB"));
  return out;
}
