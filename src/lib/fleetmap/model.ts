import type { FleetAccount, FleetResource } from "@/lib/inventory/model";
import { roleLabels, type Role } from "@/lib/fleet/vocabulary";

export type GroupBy = "provider" | "account" | "role" | "category" | "region";
export type SizeBy = "capacity" | "equal";
export type TileState = "running" | "changing" | "stopped" | "unknown" | "missing";

export type Tile = {
  id: string; weight: number; resource: FleetResource; account: FleetAccount | undefined;
  state: TileState; stale: boolean; groupKey: string; groupLabel: string; capacityText: string;
};

/** How a resource looks on the map. Colour is never the only signal: each state has a symbol and a word (see stateStyle). */
export const stateStyle: Record<TileState, { label: string; symbol: string; className: string }> = {
  running: { label: "Running", symbol: "●", className: "bg-emerald-900/70 border-emerald-600 text-emerald-100" },
  changing: { label: "Changing", symbol: "◐", className: "bg-sky-900/70 border-sky-600 text-sky-100" },
  stopped: { label: "Stopped", symbol: "■", className: "bg-zinc-800 border-zinc-500 text-zinc-200" },
  unknown: { label: "Unknown", symbol: "?", className: "bg-zinc-900 border-zinc-600 border-dashed text-zinc-400" },
  missing: { label: "Missing", symbol: "✕", className: "bg-rose-950/70 border-rose-700 text-rose-200" },
};

export function tileState(resource: FleetResource): TileState {
  if (resource.presence === "missing") return "missing";
  if (resource.state === "online") return "running";
  if (resource.state === "offline") return "stopped";
  if (resource.state === "busy") return "changing";
  return "unknown";
}

/** A weight that reflects how much capacity a resource represents, so a 2 OCPU VM is larger than a bucket. Unknown size gets a small floor, never zero. */
export function capacityWeight(resource: FleetResource): number {
  const s = resource.specs;
  const ocpus = typeof s.ocpus === "number" ? s.ocpus : 0;
  const memory = typeof s.memoryGb === "number" ? s.memoryGb : 0;
  const size = typeof s.sizeGb === "number" ? s.sizeGb : 0;
  if (ocpus || memory) return Math.max(2, ocpus * 4 + memory / 2);
  if (size) return Math.max(1, Math.sqrt(size));
  return 1;
}

export function capacityText(resource: FleetResource): string {
  const s = resource.specs;
  const parts: string[] = [];
  if (typeof s.ocpus === "number") parts.push(`${s.ocpus} OCPU`);
  if (typeof s.memoryGb === "number") parts.push(`${s.memoryGb} GB`);
  if (typeof s.sizeGb === "number") parts.push(`${s.sizeGb} GB disk`);
  if (typeof s.arch === "string") parts.push(s.arch);
  return parts.join(" · ");
}

function groupOf(resource: FleetResource, account: FleetAccount | undefined, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "provider": return { key: resource.provider, label: resource.provider };
    case "account": return { key: resource.accountId ?? "none", label: account?.label ?? "No account" };
    case "role": return { key: resource.profile.role, label: roleLabels[resource.profile.role as Role] ?? resource.profile.role };
    case "category": return { key: resource.category, label: resource.category };
    case "region": return { key: resource.region ?? "none", label: resource.region ?? "No region" };
  }
}

export type Filters = { category: string; provider: string; accountId: string; state: string; role: string; attention: boolean };
export const noFilters: Filters = { category: "", provider: "", accountId: "", state: "", role: "", attention: false };

export function buildTiles(resources: readonly FleetResource[], accounts: readonly FleetAccount[], by: GroupBy, size: SizeBy, filters: Filters): Tile[] {
  const accountById = new Map(accounts.map(account => [account.id, account]));
  return resources.flatMap(resource => {
    const account = resource.accountId ? accountById.get(resource.accountId) : undefined;
    const state = tileState(resource);
    const stale = resource.freshness === "stale";
    if (filters.category && resource.category !== filters.category) return [];
    if (filters.provider && resource.provider !== filters.provider) return [];
    if (filters.accountId && resource.accountId !== filters.accountId) return [];
    if (filters.state && state !== filters.state) return [];
    if (filters.role && resource.profile.role !== filters.role) return [];
    if (filters.attention && !(state === "missing" || state === "unknown" || stale)) return [];
    const group = groupOf(resource, account, by);
    return [{ id: resource.id, weight: size === "equal" ? 1 : capacityWeight(resource), resource, account, state, stale, groupKey: group.key, groupLabel: group.label, capacityText: capacityText(resource) }];
  });
}

export function groupTiles(tiles: readonly Tile[]) {
  const groups = new Map<string, { key: string; label: string; items: Tile[] }>();
  for (const tile of tiles) {
    const group = groups.get(tile.groupKey) ?? { key: tile.groupKey, label: tile.groupLabel, items: [] };
    group.items.push(tile); groups.set(tile.groupKey, group);
  }
  return [...groups.values()];
}

export function summarize(tiles: readonly Tile[]): Record<TileState, number> {
  const counts: Record<TileState, number> = { running: 0, changing: 0, stopped: 0, unknown: 0, missing: 0 };
  for (const tile of tiles) counts[tile.state] += 1;
  return counts;
}
