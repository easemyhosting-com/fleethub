"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { FleetAccountFacts } from "./FleetAccountFacts";
import { z } from "zod";
import { autoStopModes, backupClasses, criticalities, lifecycleLabels, lifecycles, roleLabels, roles } from "@/lib/fleet/vocabulary";
import { stateStyle, tileState } from "@/lib/fleetmap/model";
import type { FleetAccount, FleetResource } from "@/lib/inventory/model";

const footprintSchema = z.object({
  usedBy: z.record(z.string(), z.array(z.object({ name: z.string(), source: z.string(), status: z.string() }))),
});

type ProjectLink = z.infer<typeof footprintSchema>["usedBy"][string][number];

export function FleetResourceDetails({ resource, account, onClose, onSaved }: {
  resource: FleetResource;
  account: FleetAccount | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [projectLinks, setProjectLinks] = useState<ProjectLink[] | null>(null);
  const [linksUnavailable, setLinksUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/projects/footprint", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Project links unavailable");
        const body: unknown = await response.json();
        const parsed = footprintSchema.parse(body);
        if (!controller.signal.aborted) setProjectLinks(parsed.usedBy[resource.id] ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setLinksUnavailable(true); });
    return () => controller.abort();
  }, [resource.id]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    closeRef.current?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  const [profile, setProfile] = useState({ role: resource.profile.role, lifecycle: resource.profile.lifecycle, backupClass: resource.profile.backupClass, criticality: resource.profile.criticality, autoStop: resource.profile.autoStop });
  const [labels, setLabels] = useState(Object.entries(resource.profile.labels).map(([key, value]) => `${key}=${value}`).join(", "));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const style = stateStyle[tileState(resource)];

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
    <div className="flex items-start justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><h3 className="text-base font-semibold text-white">{resource.name}</h3><p className="text-xs text-zinc-400">{resource.provider} · {account?.label ?? "no account"} · {resource.category}</p></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close details" className="min-h-11 shrink-0 rounded border border-zinc-700 px-3 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">Close</button></div>
    <p className={`mt-3 inline-block rounded border px-2 py-1 text-xs ${style.className}`}><span aria-hidden="true">{style.symbol}</span> {style.label}{resource.isProtected ? " · protected" : ""}{resource.freshness === "stale" ? " · stale data" : ""}</p>
    <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] [overflow-wrap:anywhere] gap-x-4 gap-y-1 text-xs"><dt className="text-zinc-400">Provider state</dt><dd className="text-zinc-200">{resource.state}</dd><dt className="text-zinc-400">Region</dt><dd className="text-zinc-200">{resource.region ?? "-"}</dd><dt className="text-zinc-400">Last seen</dt><dd className="text-zinc-200">{resource.lastSeenAt ? new Date(resource.lastSeenAt).toLocaleString() : "Never"}</dd><dt className="text-zinc-400">Source</dt><dd className="text-zinc-200">{resource.inventorySource}</dd>{Object.entries(resource.specs).filter(([key]) => key !== "product").map(([key, value]) => <Fragment key={key}><dt className="text-zinc-400">{key}</dt><dd className="text-zinc-200">{String(value)}</dd></Fragment>)}</dl>
    {resource.sourceUrl && <a href={resource.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-cyan-300 hover:underline">Open in provider console</a>}
    <p className="mt-3 text-xs text-zinc-400 [overflow-wrap:anywhere]"><span className="text-zinc-400">Used by:</span> {projectLinks ? projectLinks.map(item => `${item.name} (${item.source}, ${item.status})`).join(", ") || "No project links" : linksUnavailable ? "Project links unavailable" : "Checking project links…"}</p>
    {account && <section aria-label="Provider account" className="mt-5 space-y-2 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-semibold text-white">Provider account</h4>
      <FleetAccountFacts account={account} />
    </section>}
    <div className="mt-5 space-y-3 border-t border-zinc-800 pt-4 text-xs text-zinc-300">
      <h4 className="text-sm font-semibold text-white">What is this resource?{resource.profile.set ? "" : " (not labelled yet)"}</h4>
      <label className="block">Role<select className={field} value={profile.role} onChange={event => setProfile({ ...profile, role: event.target.value })}>{roles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
      <label className="block">Lifecycle<select className={field} value={profile.lifecycle} onChange={event => setProfile({ ...profile, lifecycle: event.target.value })}>{lifecycles.map(value => <option key={value} value={value}>{lifecycleLabels[value]}</option>)}</select></label>
      <label className="block">Backup<select className={field} value={profile.backupClass} onChange={event => setProfile({ ...profile, backupClass: event.target.value })}>{backupClasses.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block">Criticality<select className={field} value={profile.criticality} onChange={event => setProfile({ ...profile, criticality: event.target.value })}>{criticalities.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="block">Auto-stop<select className={field} value={profile.autoStop} onChange={event => setProfile({ ...profile, autoStop: event.target.value })}>{autoStopModes.map(value => <option key={value} value={value} disabled={resource.isProtected && (value === "approve" || value === "auto")}>{value}</option>)}</select></label>
      <p className="text-zinc-400">{resource.isProtected ? "Protected resources can only be off or recommend-only." : "Nothing acts on this setting yet; FleetHub only recommends."}</p>
      <label className="block">Labels (key=value, comma separated)<input className={field} value={labels} onChange={event => setLabels(event.target.value)} placeholder="site=main, owner=me" /></label>
      <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-cyan-500 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50">{busy ? "Saving…" : "Save labels"}</button>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-rose-300" : "text-emerald-300"}>{message.text}</p>}
    </div>
  </aside>;
}
