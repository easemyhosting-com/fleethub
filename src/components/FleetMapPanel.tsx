"use client";

import { useEffect, useMemo, useState } from "react";
import type { FleetSnapshot } from "@/lib/inventory/model";
import { layoutGroups } from "@/lib/fleetmap/layout";
import { buildTiles, groupTiles, noFilters, stateStyle, summarize, type Filters, type GroupBy, type SizeBy, type Tile, type TileState } from "@/lib/fleetmap/model";
import { lifecycleLabels, roleLabels, roles } from "@/lib/fleet/vocabulary";

interface Props { fleet: FleetSnapshot; selectedId: string | null; onSelectResource: (id: string) => void; filtered?: boolean }

const groupOptions: { value: GroupBy; label: string }[] = [{ value: "provider", label: "Provider" }, { value: "account", label: "Account" }, { value: "role", label: "Role" }, { value: "category", label: "Kind" }, { value: "region", label: "Region" }];
const select = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200";
const unique = (values: string[]) => [...new Set(values)].sort();

function useWidth() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    if (!element) return;
    setWidth(element.clientWidth || 900);
    const observer = new ResizeObserver(entries => { for (const entry of entries) setWidth(Math.max(320, Math.floor(entry.contentRect.width))); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref: setElement, width };
}

export function FleetMapPanel({ fleet, selectedId, onSelectResource, filtered }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [sizeBy, setSizeBy] = useState<SizeBy>("capacity");
  const [view, setView] = useState<"map" | "table">("map");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const { ref, width } = useWidth();
  const tiles = useMemo(() => buildTiles(fleet.resources, fleet.accounts, groupBy, sizeBy, filters), [fleet, groupBy, sizeBy, filters]);
  const counts = summarize(tiles);
  const height = width < 640 ? 420 : 560;
  const placed = useMemo(() => layoutGroups(groupTiles(tiles), { x: 0, y: 0, w: width, h: height }), [tiles, width, height]);
  const setFilter = (key: keyof Filters, value: string | boolean) => setFilters(current => ({ ...current, [key]: value }));

  return <section className="space-y-4" aria-label="Fleet map">
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs text-zinc-400">Group by <select aria-label="Group by" className={select} value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)}>{groupOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="text-xs text-zinc-400">Size by <select aria-label="Size by" className={select} value={sizeBy} onChange={event => setSizeBy(event.target.value as SizeBy)}><option value="capacity">Capacity</option><option value="equal">Equal</option></select></label>
      <div className="ml-auto flex gap-1" role="group" aria-label="View">{(["map", "table"] as const).map(item => <button key={item} type="button" onClick={() => setView(item)} aria-pressed={view === item} className={`rounded border px-3 py-1 text-xs ${view === item ? "border-cyan-600 bg-cyan-950 text-cyan-200" : "border-zinc-700 text-zinc-300"}`}>{item === "map" ? "Map" : "Table"}</button>)}</div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filter by kind" className={select} value={filters.category} onChange={event => setFilter("category", event.target.value)}><option value="">All kinds</option>{unique(fleet.resources.map(item => item.category)).map(value => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Filter by account" className={select} value={filters.accountId} onChange={event => setFilter("accountId", event.target.value)}><option value="">All accounts</option>{fleet.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select>
      <select aria-label="Filter by state" className={select} value={filters.state} onChange={event => setFilter("state", event.target.value)}><option value="">Any state</option>{(Object.keys(stateStyle) as TileState[]).map(value => <option key={value} value={value}>{stateStyle[value].label}</option>)}</select>
      <select aria-label="Filter by role" className={select} value={filters.role} onChange={event => setFilter("role", event.target.value)}><option value="">Any role</option>{roles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select>
      {Object.values(filters).some(Boolean) && <button type="button" onClick={() => setFilters(noFilters)} className="text-xs text-cyan-300 hover:underline">Clear map filters</button>}
    </div>
    <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend and counts">{(Object.keys(stateStyle) as TileState[]).map(state => <li key={state} className={`rounded border px-2 py-1 ${stateStyle[state].className}`}><span aria-hidden="true">{stateStyle[state].symbol}</span> {stateStyle[state].label}: <strong>{counts[state]}</strong></li>)}<li className="px-2 py-1 text-zinc-500">Faded = data is stale · lock = protected</li></ul>

    {tiles.length === 0 ? <p className="rounded-xl border border-zinc-800 p-6 text-sm text-zinc-400">{!filtered && fleet.resources.length === 0 ? "No resources yet. Connect a provider account to see its resources here." : "No resources match these filters."}</p>
    : view === "map" ? <div ref={ref} className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950" style={{ height }}>
      {placed.map(group => <div key={group.key}>
        <div className="absolute truncate bg-zinc-800/80 px-2 text-[11px] font-semibold uppercase leading-[22px] tracking-wide text-zinc-200" style={{ left: group.rect.x + 1, top: group.rect.y + 1, width: Math.max(0, group.rect.w - 2) }}>{group.label}</div>
        {group.tiles.map(tile => <TileButton key={tile.id} tile={tile.item} rect={tile} selected={selectedId === tile.id} onSelect={() => onSelectResource(tile.id)} />)}
      </div>)}
    </div> : <div ref={ref} className="overflow-x-auto rounded-xl border border-zinc-800"><table className="w-full text-left text-xs"><thead className="bg-zinc-900 text-zinc-400"><tr>{["State", "Name", "Provider", "Account", "Kind", "Role", "Lifecycle", "Capacity", "Region"].map(heading => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
      <tbody>{tiles.map(tile => <tr key={tile.id} className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-900" onClick={() => onSelectResource(tile.id)}><td className="px-3 py-2"><span aria-hidden="true">{stateStyle[tile.state].symbol}</span> {stateStyle[tile.state].label}{tile.stale ? " (stale)" : ""}</td><td className="px-3 py-2 text-zinc-100"><button type="button" className="w-36 text-left [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:w-56" onClick={() => onSelectResource(tile.id)}>{tile.resource.name}</button></td><td className="px-3 py-2">{tile.resource.provider}</td><td className="px-3 py-2">{tile.account?.label ?? "-"}</td><td className="px-3 py-2">{tile.resource.category}</td><td className="px-3 py-2">{roleLabels[tile.resource.profile.role as keyof typeof roleLabels] ?? tile.resource.profile.role}</td><td className="px-3 py-2">{lifecycleLabels[tile.resource.profile.lifecycle as keyof typeof lifecycleLabels] ?? tile.resource.profile.lifecycle}</td><td className="px-3 py-2">{tile.capacityText || "-"}</td><td className="px-3 py-2">{tile.resource.region ?? "-"}</td></tr>)}</tbody></table></div>}
  </section>;
}

function TileButton({ tile, rect, selected, onSelect }: { tile: Tile; rect: { x: number; y: number; w: number; h: number }; selected: boolean; onSelect: () => void }) {
  const style = stateStyle[tile.state];
  const roomy = rect.w > 110 && rect.h > 58, tiny = rect.w < 64 || rect.h < 34;
  return <button type="button" onClick={onSelect} aria-label={`${tile.resource.name}, ${style.label}${tile.stale ? ", stale" : ""}, ${tile.resource.provider}`} title={`${tile.resource.name}\n${style.label}${tile.stale ? " (stale data)" : ""}\n${tile.account?.label ?? ""}${tile.capacityText ? `\n${tile.capacityText}` : ""}`}
    className={`absolute overflow-hidden rounded border p-1 text-left text-[11px] leading-tight transition hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-cyan-400 ${style.className} ${tile.stale ? "opacity-60" : ""} ${selected ? "ring-2 ring-cyan-300" : ""}`}
    style={{ left: rect.x + 1, top: rect.y + 1, width: Math.max(0, rect.w - 2), height: Math.max(0, rect.h - 2) }}>
    <span className="flex items-start justify-between gap-1"><span className="truncate font-medium">{tiny ? "" : tile.resource.name}</span><span aria-hidden="true">{tile.resource.isProtected ? "🔒" : ""}{style.symbol}</span></span>
    {roomy && <span className="mt-0.5 block truncate opacity-80">{tile.account?.label ?? tile.resource.provider}{tile.capacityText ? ` · ${tile.capacityText}` : ""}</span>}
    {roomy && rect.h > 80 && <span className="mt-0.5 block truncate opacity-70">{style.label} · {roleLabels[tile.resource.profile.role as keyof typeof roleLabels] ?? ""}</span>}
  </button>;
}
