"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FleetSnapshot } from "@/lib/inventory/model";
import { layoutGroups } from "@/lib/fleetmap/layout";
import { buildTiles, groupTiles, noFilters, stateStyle, summarize, type Filters, type GroupBy, type SizeBy, type Tile, type TileState } from "@/lib/fleetmap/model";
import { autoStopModes, backupClasses, criticalities, lifecycleLabels, lifecycles, roleLabels, roles } from "@/lib/fleet/vocabulary";

interface Props { fleet: FleetSnapshot; onReload: () => Promise<void> }

const groupOptions: { value: GroupBy; label: string }[] = [{ value: "provider", label: "Provider" }, { value: "account", label: "Account" }, { value: "role", label: "Role" }, { value: "category", label: "Kind" }, { value: "region", label: "Region" }];
const select = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200";
const unique = (values: string[]) => [...new Set(values)].sort();

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth || 900);
    const observer = new ResizeObserver(entries => { for (const entry of entries) setWidth(Math.max(320, Math.floor(entry.contentRect.width))); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function FleetMapPanel({ fleet, onReload }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [sizeBy, setSizeBy] = useState<SizeBy>("capacity");
  const [view, setView] = useState<"map" | "table">("map");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [usedBy, setUsedBy] = useState<Record<string, Array<{ slug: string; name: string; source: string; status: string }>>>({});
  useEffect(() => { let live = true; fetch("/api/projects/footprint", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(body => { if (live && body?.usedBy) setUsedBy(body.usedBy); }).catch(() => { /* Drawer remains usable without project metadata. */ }); return () => { live = false; }; }, []);
  const { ref, width } = useWidth();
  const tiles = useMemo(() => buildTiles(fleet.resources, fleet.accounts, groupBy, sizeBy, filters), [fleet, groupBy, sizeBy, filters]);
  const counts = summarize(tiles);
  const selectedResource = selectedId ? fleet.resources.find(resource => resource.id === selectedId) : undefined;
  const selected = selectedResource ? tiles.find(tile => tile.id === selectedId) ?? buildTiles([selectedResource], fleet.accounts, groupBy, sizeBy, noFilters)[0] : null;
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
      <select aria-label="Filter by provider" className={select} value={filters.provider} onChange={event => setFilter("provider", event.target.value)}><option value="">All providers</option>{unique(fleet.resources.map(item => item.provider)).map(value => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Filter by account" className={select} value={filters.accountId} onChange={event => setFilter("accountId", event.target.value)}><option value="">All accounts</option>{fleet.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select>
      <select aria-label="Filter by state" className={select} value={filters.state} onChange={event => setFilter("state", event.target.value)}><option value="">Any state</option>{(Object.keys(stateStyle) as TileState[]).map(value => <option key={value} value={value}>{stateStyle[value].label}</option>)}</select>
      <select aria-label="Filter by role" className={select} value={filters.role} onChange={event => setFilter("role", event.target.value)}><option value="">Any role</option>{roles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select>
      <label className="flex items-center gap-1 text-xs text-zinc-300"><input type="checkbox" checked={filters.attention} onChange={event => setFilter("attention", event.target.checked)} /> Needs attention</label>
      {Object.values(filters).some(Boolean) && <button type="button" onClick={() => setFilters(noFilters)} className="text-xs text-cyan-300 hover:underline">Clear filters</button>}
    </div>
    <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend and counts">{(Object.keys(stateStyle) as TileState[]).map(state => <li key={state} className={`rounded border px-2 py-1 ${stateStyle[state].className}`}><span aria-hidden="true">{stateStyle[state].symbol}</span> {stateStyle[state].label}: <strong>{counts[state]}</strong></li>)}<li className="px-2 py-1 text-zinc-500">Faded = data is stale · lock = protected</li></ul>

    {tiles.length === 0 ? <p className="rounded-xl border border-zinc-800 p-6 text-sm text-zinc-400">{fleet.resources.length === 0 ? "No resources yet. Connect a provider account to see its resources here." : "No resources match these filters."}</p>
    : view === "map" ? <div ref={ref} className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950" style={{ height }}>
      {placed.map(group => <div key={group.key}>
        <div className="absolute truncate bg-zinc-800/80 px-2 text-[11px] font-semibold uppercase leading-[22px] tracking-wide text-zinc-200" style={{ left: group.rect.x + 1, top: group.rect.y + 1, width: Math.max(0, group.rect.w - 2) }}>{group.label}</div>
        {group.tiles.map(tile => <TileButton key={tile.id} tile={tile.item} rect={tile} selected={selectedId === tile.id} onSelect={() => setSelectedId(tile.id)} />)}
      </div>)}
    </div> : <div ref={ref} className="overflow-x-auto rounded-xl border border-zinc-800"><table className="w-full text-left text-xs"><thead className="bg-zinc-900 text-zinc-400"><tr>{["State", "Name", "Provider", "Account", "Kind", "Role", "Lifecycle", "Capacity", "Region"].map(heading => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
      <tbody>{tiles.map(tile => <tr key={tile.id} className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-900" onClick={() => setSelectedId(tile.id)}><td className="px-3 py-2"><span aria-hidden="true">{stateStyle[tile.state].symbol}</span> {stateStyle[tile.state].label}{tile.stale ? " (stale)" : ""}</td><td className="px-3 py-2 text-zinc-100"><button type="button" className="text-left hover:underline" onClick={() => setSelectedId(tile.id)}>{tile.resource.name}</button></td><td className="px-3 py-2">{tile.resource.provider}</td><td className="px-3 py-2">{tile.account?.label ?? "-"}</td><td className="px-3 py-2">{tile.resource.category}</td><td className="px-3 py-2">{roleLabels[tile.resource.profile.role as keyof typeof roleLabels] ?? tile.resource.profile.role}</td><td className="px-3 py-2">{lifecycleLabels[tile.resource.profile.lifecycle as keyof typeof lifecycleLabels] ?? tile.resource.profile.lifecycle}</td><td className="px-3 py-2">{tile.capacityText || "-"}</td><td className="px-3 py-2">{tile.resource.region ?? "-"}</td></tr>)}</tbody></table></div>}
    {selected && <ResourceDrawer key={selected.id} tile={selected} usedBy={usedBy[selected.id] ?? []} onClose={() => setSelectedId(null)} onSaved={onReload} />}
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

function ResourceDrawer({ tile, usedBy, onClose, onSaved }: { tile: Tile; usedBy: Array<{ slug: string; name: string; source: string; status: string }>; onClose: () => void; onSaved: () => Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    closeRef.current?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  const resource = tile.resource;
  const [profile, setProfile] = useState({ role: resource.profile.role, lifecycle: resource.profile.lifecycle, backupClass: resource.profile.backupClass, criticality: resource.profile.criticality, autoStop: resource.profile.autoStop });
  const [labels, setLabels] = useState(Object.entries(resource.profile.labels).map(([key, value]) => `${key}=${value}`).join(", "));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const style = stateStyle[tile.state];

  async function save() {
    setBusy(true); setMessage(null);
    try {
      const pairs = labels.split(",").map(item => item.trim()).filter(Boolean).map(item => item.split("=").map(part => part.trim()));
      if (pairs.some(pair => pair.length !== 2 || !pair[0] || !pair[1])) throw new Error("Labels look like key=value, separated by commas.");
      const response = await fetch("/api/resources/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: resource.id, profile: { ...profile, labels: Object.fromEntries(pairs) } }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save.");
      setMessage({ kind: "ok", text: "Saved." }); await onSaved();
    } catch (cause) { setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "Could not save." }); }
    finally { setBusy(false); }
  }
  const field = "mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100";
  return <aside onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} aria-label={`Details for ${resource.name}`} className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0 break-words"><h3 className="text-base font-semibold text-white">{resource.name}</h3><p className="text-xs text-zinc-400">{resource.provider} · {tile.account?.label ?? "no account"} · {resource.category}</p></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close details" className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">Close</button></div>
    <p className={`mt-3 inline-block rounded border px-2 py-1 text-xs ${style.className}`}><span aria-hidden="true">{style.symbol}</span> {style.label}{resource.isProtected ? " · protected" : ""}{tile.stale ? " · stale data" : ""}</p>
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"><dt className="text-zinc-500">Provider state</dt><dd className="text-zinc-200">{resource.state}</dd><dt className="text-zinc-500">Region</dt><dd className="text-zinc-200">{resource.region ?? "-"}</dd><dt className="text-zinc-500">Last seen</dt><dd className="text-zinc-200">{resource.lastSeenAt ? new Date(resource.lastSeenAt).toLocaleString() : "Never"}</dd><dt className="text-zinc-500">Source</dt><dd className="text-zinc-200">{resource.inventorySource}</dd>{Object.entries(resource.specs).filter(([key]) => key !== "product").map(([key, value]) => <><dt key={`${key}-k`} className="text-zinc-500">{key}</dt><dd key={`${key}-v`} className="text-zinc-200">{String(value)}</dd></>)}</dl>
    {resource.sourceUrl && <a href={resource.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-cyan-300 hover:underline">Open in provider console</a>}
    <p className="mt-3 text-xs text-zinc-400"><span className="text-zinc-500">Used by:</span> {usedBy.length ? usedBy.map(item => `${item.name} (${item.source}, ${item.status})`).join(", ") : "No project links"}</p>
    <div className="mt-5 space-y-3 border-t border-zinc-800 pt-4 text-xs text-zinc-300">
      <h4 className="text-sm font-semibold text-white">What is this resource?{resource.profile.set ? "" : " (not labelled yet)"}</h4>
      <label className="block">Role<select className={field} value={profile.role} onChange={event => setProfile({ ...profile, role: event.target.value })}>{roles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
      <label className="block">Lifecycle<select className={field} value={profile.lifecycle} onChange={event => setProfile({ ...profile, lifecycle: event.target.value })}>{lifecycles.map(value => <option key={value} value={value}>{lifecycleLabels[value]}</option>)}</select></label>
      <label className="block">Backup<select className={field} value={profile.backupClass} onChange={event => setProfile({ ...profile, backupClass: event.target.value })}>{backupClasses.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block">Criticality<select className={field} value={profile.criticality} onChange={event => setProfile({ ...profile, criticality: event.target.value })}>{criticalities.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="block">Auto-stop<select className={field} value={profile.autoStop} onChange={event => setProfile({ ...profile, autoStop: event.target.value })}>{autoStopModes.map(value => <option key={value} value={value} disabled={resource.isProtected && (value === "approve" || value === "auto")}>{value}</option>)}</select></label>
      <p className="text-zinc-500">{resource.isProtected ? "Protected resources can only be off or recommend-only." : "Nothing acts on this setting yet; FleetHub only recommends."}</p>
      <label className="block">Labels (key=value, comma separated)<input className={field} value={labels} onChange={event => setLabels(event.target.value)} placeholder="site=main, owner=me" /></label>
      <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-cyan-500 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50">{busy ? "Saving…" : "Save labels"}</button>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-rose-300" : "text-emerald-300"}>{message.text}</p>}
    </div>
  </aside>;
}
