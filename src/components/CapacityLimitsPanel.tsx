"use client";

import { useCallback, useEffect, useState } from "react";

type Entitlement = { id: string; provider: string; label: string; limit: number; unit: string; period: string; resetsRule: string | null; verification: "verified" | "reported" | "unverified"; verifiedAt: string | null; sourceUrl: string | null; note: string | null };
type Allowance = { id: string; entitlementId: string; scopeType: string; scopeId: string; limit: number; reason: string | null };
type Limits = { entitlements: Entitlement[]; allowances: Allowance[] };

const badge: Record<Entitlement["verification"], string> = {
  verified: "border-emerald-700 text-emerald-300",
  reported: "border-amber-700 text-amber-300",
  unverified: "border-zinc-600 text-zinc-400",
};
const per = (period: string) => (period === "day" ? "/ day" : period === "month" ? "/ month" : period === "pool" ? "pool" : "");

export function CapacityLimitsPanel() {
  const [data, setData] = useState<Limits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/capacity/limits", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load limits.");
      setData(await response.json() as Limits);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load limits."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send(body: unknown, done: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/capacity/limits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const parsed = await response.json() as { error?: string };
      if (!response.ok) throw new Error(parsed.error ?? "Request failed.");
      setNotice(done); setDraft({}); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  }

  if (!data) return <p className="text-sm text-zinc-400">{error ?? "Loading limits…"}</p>;
  const providers = [...new Set(data.entitlements.map(item => item.provider))];
  return <section className="space-y-5">
    <p className="text-xs text-zinc-400">What each plan offers, and what you allow FleetHub to plan with. Planning uses the smaller of the two. Unverified figures are shown but never counted as available. Edit a figure if it has changed; every change is recorded.</p>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {providers.map(provider => <div key={provider} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-3 text-sm font-semibold capitalize text-white">{provider}</h3>
      <div className="space-y-3">{data.entitlements.filter(item => item.provider === provider).map(item => {
        const allowance = data.allowances.find(row => row.entitlementId === item.id && row.scopeType === "global");
        return <div key={item.id} className="grid gap-2 border-t border-zinc-900 pt-3 text-xs md:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <p className="text-sm text-zinc-100">{item.label}: <strong>{item.limit.toLocaleString()}</strong> {item.unit} {per(item.period)}{item.resetsRule ? ` · resets ${item.resetsRule}` : ""}</p>
            <p className="flex flex-wrap items-center gap-2 text-zinc-400"><span className={`rounded border px-1.5 py-0.5 ${badge[item.verification]}`}>{item.verification}{item.verifiedAt ? ` ${item.verifiedAt}` : ""}</span>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">source</a>}{allowance && <span>Allowed: <strong className="text-zinc-200">{allowance.limit.toLocaleString()}</strong>{allowance.reason ? ` (${allowance.reason})` : ""}</span>}</p>
            {item.note && <p className="text-zinc-500">{item.note}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label={`Allowance for ${item.label}`} type="number" min={0} value={draft[item.id] ?? ""} onChange={event => setDraft(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Allow up to…" className="w-32 rounded bg-zinc-900 p-2" />
            <button type="button" disabled={busy || !(draft[item.id] ?? "").trim()} onClick={() => void send({ action: "set_allowance", entitlementId: item.id, scopeType: "global", limit: Number(draft[item.id]) }, "Allowance saved.")} className="rounded border border-cyan-700 px-2 py-2 text-cyan-300 disabled:opacity-40">Set allowance</button>
            {allowance && <button type="button" disabled={busy} onClick={() => void send({ action: "delete_allowance", id: allowance.id }, "Allowance removed.")} className="rounded border border-zinc-700 px-2 py-2 text-zinc-300 disabled:opacity-40">Clear</button>}
            <button type="button" disabled={busy || !(draft[item.id] ?? "").trim()} title="Correct the provider's figure itself" onClick={() => void send({ action: "set_entitlement", id: item.id, limit: Number(draft[item.id]), verification: "reported" }, "Figure updated and marked as reported.")} className="rounded border border-zinc-700 px-2 py-2 text-zinc-300 disabled:opacity-40">Correct figure</button>
          </div>
        </div>;
      })}</div>
    </div>)}
  </section>;
}
