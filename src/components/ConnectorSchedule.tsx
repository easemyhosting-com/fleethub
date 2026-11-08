"use client";
import { useState } from "react";
import { scanIntervalChoices } from "@/lib/connectors/schedule-rules";
import { intervalLabel, scheduleNote } from "@/lib/connectors/view";

const button = "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50";
const field = "mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";
type Props = { id: string; kind: string; scanIntervalMinutes: number; scanRequested: boolean; hasRescanKey: boolean; unregistered: string[]; onChanged: () => Promise<void> | void };

/** Automatic scans and the Flux rescan webhook for one connector. The rescan key is shown once and never stored in plain text. */
export function ConnectorSchedule({ id, kind, scanIntervalMinutes, scanRequested, hasRescanKey, unregistered, onChanged }: Props) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [key, setKey] = useState<string | null>(null);
  async function patch(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/connectors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      const result = await response.json().catch(() => ({})) as { rescanKey?: string; error?: string };
      if (!response.ok) throw new Error(result.error || `Update failed (${response.status}).`);
      if (result.rescanKey) setKey(result.rescanKey);
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
    finally { setBusy(false); }
  }
  const hookUrl = typeof window === "undefined" ? "/api/hooks/rescan" : `${window.location.origin}/api/hooks/rescan`;
  return <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
    <label className="block text-xs text-zinc-300">Automatic scan
      <select disabled={busy} value={scanIntervalMinutes} onChange={e => void patch({ scanIntervalMinutes: Number(e.target.value) })} className={`${field} ml-2`}>
        {scanIntervalChoices.map(value => <option key={value} value={value}>{intervalLabel(value)}</option>)}
      </select>
    </label>
    <p className="text-[11px] leading-relaxed text-zinc-500">{scheduleNote(kind)}{scanRequested ? " A rescan was requested and will run shortly." : ""}</p>
    {unregistered.length > 0 && <p className="text-[11px] leading-relaxed text-amber-200">Found but not registered: {unregistered.join(", ")}. Use “Scan (dry run)” to review them.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void patch({ rescanKey: "rotate" })} className={button}>{hasRescanKey ? "Replace rescan key" : "Create rescan key"}</button>
      {hasRescanKey && <button type="button" disabled={busy} onClick={() => { setKey(null); void patch({ rescanKey: "revoke" }); }} className={button}>Revoke key</button>}
    </div>
    {key && <div className="space-y-1 rounded-lg border border-emerald-900 bg-emerald-950/20 p-2 text-[11px] text-zinc-300">
      <p className="text-emerald-200">Copy this key now; it is not shown again.</p>
      <code className="block break-all text-zinc-100">{key}</code>
      <p>Flux: a <code>generic</code> Provider with <code>address: {hookUrl}</code> and a <code>secretRef</code> whose Secret holds <code>headers: {"{"}Authorization: Bearer &lt;key&gt;{"}"}</code>, plus an Alert on your Kustomizations. Any POST with this bearer key works too.</p>
    </div>}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
  </div>;
}
